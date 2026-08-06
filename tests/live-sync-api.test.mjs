import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.BATTLE_MAP_BASE_URL;
if (!baseUrl) {
  throw new Error(
    "Set BATTLE_MAP_BASE_URL to a running battle-map server (for example http://[::1]:3000).",
  );
}

const code = "EMBER-KEEP";
const endpoint = (action) => `${baseUrl}/api/encounters/${code}/${action}`;

async function request(action, options = {}) {
  const response = await fetch(endpoint(action), {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  const body = await response.json();
  return { response, body };
}

function participantBody(participant, tokenId, extra = {}) {
  return JSON.stringify({
    participantId: participant.id,
    sessionSecret: participant.sessionSecret,
    tokenId,
    ...extra,
  });
}

function sessionBody(participant) {
  return JSON.stringify({
    participantId: participant.id,
    sessionSecret: participant.sessionSecret,
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
    state: result.body.state,
    participant: {
      id: result.body.participantId,
      name,
      sessionSecret: result.body.sessionSecret,
    },
  };
}

async function waitForPolledState(since, predicate, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let lastVersion = since;
  try {
    while (true) {
      const response = await fetch(`${endpoint("events")}?since=${lastVersion}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (response.status === 204) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      assert.equal(response.status, 200);
      const state = await response.json();
      lastVersion = state.encounter.version;
      if (predicate(state)) return state;
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function destinationFor(token, grid, xDelta, yDelta) {
  return {
    x: Number((token.x < grid.width / 2 ? token.x + xDelta : token.x - xDelta).toFixed(3)),
    y: Number((token.y < grid.height / 2 ? token.y + yDelta : token.y - yDelta).toFixed(3)),
  };
}

test("three clients claim and independently move authoritative tokens", async () => {
  const [aliceJoin, bobJoin, caraJoin] = await Promise.all([
    join("Alice API"),
    join("Bob API"),
    join("Cara API"),
  ]);
  const alice = aliceJoin.participant;
  const bob = bobJoin.participant;
  const cara = caraJoin.participant;
  const initial = caraJoin.state;
  assert.equal(initial.encounter.code, code);
  assert.ok(initial.tokens.length >= 3, "The encounter should seed at least three tokens");
  assert.deepEqual(aliceJoin.state.grid, bobJoin.state.grid);
  assert.deepEqual(
    aliceJoin.state.tokens.map((token) => token.id),
    bobJoin.state.tokens.map((token) => token.id),
  );

  const aliceToken = initial.tokens.find((token) => token.owner?.name === alice.name) ??
    initial.tokens.find((token) => token.owner === null);
  const bobToken = initial.tokens.find(
    (token) => token.id !== aliceToken?.id && token.owner?.name === bob.name,
  ) ?? initial.tokens.find((token) => token.id !== aliceToken?.id && token.owner === null);
  assert.ok(aliceToken && bobToken, "The test requires two unclaimed or recoverable API tokens");

  const aliceClaim = await request("claim", {
    method: "POST",
    body: participantBody(alice, aliceToken.id),
  });
  assert.equal(aliceClaim.response.status, 200);
  assert.equal(
    aliceClaim.body.state.tokens.find((token) => token.id === aliceToken.id).owner.participantId,
    alice.id,
  );

  const conflictingClaim = await request("claim", {
    method: "POST",
    body: participantBody(bob, aliceToken.id),
  });
  assert.equal(conflictingClaim.response.status, 409);

  const bobClaim = await request("claim", {
    method: "POST",
    body: participantBody(bob, bobToken.id),
  });
  assert.equal(bobClaim.response.status, 200);
  assert.equal(
    bobClaim.body.state.tokens.find((token) => token.id === bobToken.id).owner.participantId,
    bob.id,
  );

  const heartbeat = await request("heartbeat", {
    method: "POST",
    body: sessionBody(alice),
  });
  assert.equal(heartbeat.response.status, 200);
  assert.equal(heartbeat.body.present, true);
  assert.ok(heartbeat.body.claimExpiresAt > Date.now() + 115_000);

  const invalidHeartbeat = await request("heartbeat", {
    method: "POST",
    body: JSON.stringify({
      participantId: alice.id,
      sessionSecret: bob.sessionSecret,
    }),
  });
  assert.equal(invalidHeartbeat.response.status, 401);

  const secondClaim = await request("claim", {
    method: "POST",
    body: participantBody(alice, bobToken.id),
  });
  assert.equal(secondClaim.response.status, 409);

  const unownedLock = await request("lock", {
    method: "POST",
    body: participantBody(cara, aliceToken.id),
  });
  assert.equal(unownedLock.response.status, 403);

  const [aliceLock, bobLock] = await Promise.all([
    request("lock", { method: "POST", body: participantBody(alice, aliceToken.id) }),
    request("lock", { method: "POST", body: participantBody(bob, bobToken.id) }),
  ]);
  assert.equal(aliceLock.response.status, 200);
  assert.equal(bobLock.response.status, 200);
  assert.equal(
    aliceLock.body.state.tokens.find((token) => token.id === aliceToken.id).lock.ownerId,
    alice.id,
  );
  assert.equal(
    bobLock.body.state.tokens.find((token) => token.id === bobToken.id).lock.ownerId,
    bob.id,
  );

  const destinationA = destinationFor(aliceToken, initial.grid, 1.137, 0.413);
  const destinationB = destinationFor(bobToken, initial.grid, 0.619, 1.271);
  assert.notEqual(destinationA.x, Math.trunc(destinationA.x));
  assert.notEqual(destinationA.y, Math.trunc(destinationA.y));
  assert.notEqual(destinationB.x, Math.trunc(destinationB.x));
  assert.notEqual(destinationB.y, Math.trunc(destinationB.y));

  const spoofedMove = await request("move", {
    method: "POST",
    body: JSON.stringify({
      participantId: alice.id,
      sessionSecret: bob.sessionSecret,
      tokenId: aliceToken.id,
      ...destinationA,
    }),
  });
  assert.equal(spoofedMove.response.status, 401);

  const unauthorizedMove = await request("move", {
    method: "POST",
    body: participantBody(bob, aliceToken.id, destinationA),
  });
  assert.equal(unauthorizedMove.response.status, 403);

  const beforeMoves = await request("state", { method: "GET" });
  const observedMoves = waitForPolledState(
    beforeMoves.body.encounter.version,
    (nextState) => {
      const nextA = nextState.tokens.find((token) => token.id === aliceToken.id);
      const nextB = nextState.tokens.find((token) => token.id === bobToken.id);
      return nextA?.x === destinationA.x && nextA?.y === destinationA.y && nextA?.lock === null &&
        nextB?.x === destinationB.x && nextB?.y === destinationB.y && nextB?.lock === null;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 100));

  const moveStartedAt = performance.now();
  const [moveA, moveB] = await Promise.all([
    request("move", {
      method: "POST",
      body: participantBody(alice, aliceToken.id, destinationA),
    }),
    request("move", {
      method: "POST",
      body: participantBody(bob, bobToken.id, destinationB),
    }),
  ]);
  assert.equal(moveA.response.status, 200);
  assert.equal(moveB.response.status, 200);

  const received = await observedMoves;
  const propagationMs = performance.now() - moveStartedAt;
  const receivedA = received.tokens.find((token) => token.id === aliceToken.id);
  const receivedB = received.tokens.find((token) => token.id === bobToken.id);
  assert.deepEqual({ x: receivedA.x, y: receivedA.y }, destinationA);
  assert.deepEqual({ x: receivedB.x, y: receivedB.y }, destinationB);
  assert.ok(propagationMs < 2_500, `Live propagation took ${propagationMs.toFixed(0)}ms`);

  const confirmed = await request("state", { method: "GET" });
  const confirmedA = confirmed.body.tokens.find((token) => token.id === aliceToken.id);
  const confirmedB = confirmed.body.tokens.find((token) => token.id === bobToken.id);
  assert.deepEqual({ x: confirmedA.x, y: confirmedA.y, lock: confirmedA.lock }, { ...destinationA, lock: null });
  assert.deepEqual({ x: confirmedB.x, y: confirmedB.y, lock: confirmedB.lock }, { ...destinationB, lock: null });

  const aliceRecoveryJoin = await join(alice.name);
  const recoveredClaim = await request("claim", {
    method: "POST",
    body: participantBody(aliceRecoveryJoin.participant, aliceToken.id),
  });
  assert.equal(recoveredClaim.response.status, 200);
  assert.equal(recoveredClaim.body.recovered, true);
  assert.equal(
    recoveredClaim.body.state.tokens.find((token) => token.id === aliceToken.id).owner.participantId,
    aliceRecoveryJoin.participant.id,
  );

  const supersededSessionLock = await request("lock", {
    method: "POST",
    body: participantBody(alice, aliceToken.id),
  });
  assert.equal(supersededSessionLock.response.status, 403);

  const [aliceRelease, bobRelease] = await Promise.all([
    request("relinquish", {
      method: "POST",
      body: participantBody(aliceRecoveryJoin.participant, aliceToken.id),
    }),
    request("relinquish", { method: "POST", body: participantBody(bob, bobToken.id) }),
  ]);
  assert.equal(aliceRelease.response.status, 200);
  assert.equal(bobRelease.response.status, 200);

  console.log(`Two-token propagation to third client: ${propagationMs.toFixed(0)}ms`);
  console.log(`Confirmed: ${aliceToken.name} ${destinationA.x},${destinationA.y}; ${bobToken.name} ${destinationB.x},${destinationB.y}`);
});
