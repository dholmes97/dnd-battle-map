import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.BATTLE_MAP_BASE_URL;
if (!baseUrl) {
  throw new Error(
    "Set BATTLE_MAP_BASE_URL to a running local battle-map server (for example http://[::1]:3000).",
  );
}

const code = "EMBER-KEEP";
const endpoint = (action) =>
  `${baseUrl}/api/encounters/${code}/${action}`;

async function request(action, options = {}) {
  const response = await fetch(endpoint(action), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  return { response, body };
}

function participantBody(participant, extra = {}) {
  return JSON.stringify({
    participantId: participant.id,
    sessionSecret: participant.sessionSecret,
    ...extra,
  });
}

async function join(name) {
  const result = await request("join", {
    method: "POST",
    body: JSON.stringify({ participantName: name }),
  });
  assert.equal(result.response.status, 200);
  assert.match(result.body.participantId, /^[a-f0-9-]{36}$/);
  assert.match(result.body.sessionSecret, /^[a-f0-9-]{36}$/);
  return {
    ...result,
    participant: {
      id: result.body.participantId,
      name,
      sessionSecret: result.body.sessionSecret,
    },
  };
}

async function waitForSseState(since, predicate, timeoutMs = 4_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${endpoint("events")}?since=${since}`, {
    signal: controller.signal,
    headers: { accept: "text/event-stream" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream\b/i);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = frame
          .split("\n")
          .find((line) => line.startsWith("event:"))
          ?.slice(6)
          .trim();
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (event === "state" && data) {
          const state = JSON.parse(data);
          if (predicate(state)) return state;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
    throw new Error("SSE stream closed before the expected state arrived.");
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await reader.cancel().catch(() => {});
  }
}

test("two clients share an authoritative locked token move", async () => {
  const aliceJoin = await join("Alice API");
  const bobJoin = await join("Bob API");
  const alice = aliceJoin.participant;
  const bob = bobJoin.participant;
  assert.equal(aliceJoin.body.state.encounter.code, code);
  assert.deepEqual(aliceJoin.body.state.grid, bobJoin.body.state.grid);
  assert.equal(aliceJoin.body.state.token.id, bobJoin.body.state.token.id);

  const initial = bobJoin.body.state;
  const destination = {
    x: (initial.token.x + 1) % initial.grid.width,
    y: initial.token.y,
  };

  const observedMove = waitForSseState(
    initial.encounter.version,
    (state) =>
      state.token.x === destination.x &&
      state.token.y === destination.y &&
      state.token.lock === null,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));

  const lock = await request("lock", {
    method: "POST",
    body: participantBody(alice),
  });
  assert.equal(lock.response.status, 200);
  assert.equal(lock.body.acquired, true);
  assert.equal(lock.body.state.token.lock.ownerId, alice.id);
  assert.ok(lock.body.state.token.lock.expiresAt > Date.now());
  assert.ok(lock.body.state.token.lock.expiresAt <= Date.now() + 12_500);

  const conflict = await request("lock", {
    method: "POST",
    body: participantBody(bob),
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.acquired, false);
  assert.equal(conflict.body.state.token.lock.ownerId, alice.id);

  const spoofedMove = await request("move", {
    method: "POST",
    body: JSON.stringify({
      participantId: alice.id,
      sessionSecret: bob.sessionSecret,
      ...destination,
    }),
  });
  assert.equal(spoofedMove.response.status, 401);

  const unauthorizedMove = await request("move", {
    method: "POST",
    body: participantBody(bob, destination),
  });
  assert.equal(unauthorizedMove.response.status, 409);

  const moveStartedAt = performance.now();
  const move = await request("move", {
    method: "POST",
    body: participantBody(alice, destination),
  });
  assert.equal(move.response.status, 200);
  assert.equal(move.body.moved, true);
  assert.equal(move.body.state.token.x, destination.x);
  assert.equal(move.body.state.token.y, destination.y);
  assert.equal(move.body.state.token.lock, null);

  const received = await observedMove;
  const propagationMs = performance.now() - moveStartedAt;
  assert.equal(received.token.x, destination.x);
  assert.equal(received.token.y, destination.y);
  assert.ok(propagationMs < 2_000, `SSE propagation took ${propagationMs.toFixed(0)}ms`);

  const confirmed = await request("state", { method: "GET" });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.body.token.x, destination.x);
  assert.equal(confirmed.body.token.y, destination.y);
  assert.equal(confirmed.body.token.lock, null);

  console.log(`SSE propagation: ${propagationMs.toFixed(0)}ms`);
  console.log(`Confirmed destination: ${destination.x},${destination.y}`);
});
