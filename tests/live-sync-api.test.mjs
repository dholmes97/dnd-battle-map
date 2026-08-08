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

async function join(name, role = "player") {
  const result = await request("join", {
    method: "POST",
    body: JSON.stringify({ participantName: name, role }),
  });
  assert.equal(result.response.status, 200);
  assert.match(result.body.participantId, /^[a-f0-9-]{36}$/);
  assert.match(result.body.sessionSecret, /^[a-f0-9-]{36}$/);
  return {
    state: result.body.state,
    participant: {
      id: result.body.participantId,
      name,
      role,
      sessionSecret: result.body.sessionSecret,
    },
  };
}

async function command(participant, name, extra = {}) {
  return request("command", {
    method: "POST",
    body: JSON.stringify({
      participantId: participant.id,
      sessionSecret: participant.sessionSecret,
      command: name,
      ...extra,
    }),
  });
}

async function viewerState(participant) {
  return request("state", {
    method: "GET",
    headers: {
      "x-participant-id": participant.id,
      "x-session-secret": participant.sessionSecret,
    },
  });
}

async function waitForPolledState(since, predicate, timeoutMs = 15_000, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let lastVersion = since;
  try {
    while (true) {
      const response = await fetch(`${endpoint("events")}?since=${lastVersion}`, {
        signal: controller.signal,
        headers: { accept: "application/json", ...headers },
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
  const keepFractional = (value, limit) => {
    const rounded = Number(value.toFixed(3));
    if (!Number.isInteger(rounded)) return rounded;
    return Number((rounded < limit - 0.2 ? rounded + 0.111 : rounded - 0.111).toFixed(3));
  };
  return {
    x: keepFractional(token.x < grid.width / 2 ? token.x + xDelta : token.x - xDelta, grid.width),
    y: keepFractional(token.y < grid.height / 2 ? token.y + yDelta : token.y - yDelta, grid.height),
  };
}

test("the creature catalog pages metadata and serves artwork only on request", async () => {
  const firstPageResponse = await fetch(`${baseUrl}/api/creatures?limit=8`);
  assert.equal(firstPageResponse.status, 200);
  const firstPage = await firstPageResponse.json();
  assert.equal(firstPage.items.length, 8);
  assert.equal(firstPage.nextCursor, "8");
  const secondPageResponse = await fetch(`${baseUrl}/api/creatures?limit=8&cursor=${firstPage.nextCursor}`);
  assert.equal(secondPageResponse.status, 200);
  const secondPage = await secondPageResponse.json();
  assert.equal(secondPage.items.length, 8);
  assert.equal(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)).size, 16);

  const catalogResponse = await fetch(`${baseUrl}/api/creatures?limit=8&q=imp`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.items.length, 1);
  assert.equal(catalog.items[0].name, "Ember Imp");
  assert.equal(catalog.items[0].artAsset, "/creature-assets/tokens/creatures/imp-01.png");
  assert.match(catalog.items[0].thumbnailAsset, /variant=thumbnail&v=2$/);
  assert.ok(catalog.families.includes("fiend"));
  const thumbnailResponse = await fetch(`${baseUrl}${catalog.items[0].thumbnailAsset}`);
  assert.equal(thumbnailResponse.status, 200);
  assert.match(thumbnailResponse.headers.get("content-type") ?? "", /^image\//);
  const thumbnailBytes = (await thumbnailResponse.arrayBuffer()).byteLength;
  assert.ok(thumbnailBytes > 1_000);
  assert.ok(thumbnailBytes < 100_000, `Thumbnail should stay lightweight, received ${thumbnailBytes} bytes`);
});

test("three clients claim and independently move authoritative tokens without reservations", async () => {
  const [aliceJoin, bobJoin, caraJoin] = await Promise.all([
    join("Alice API"),
    join("Bob API"),
    join("Cara API"),
  ]);
  const alice = aliceJoin.participant;
  const bob = bobJoin.participant;
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
      return nextA?.x === destinationA.x && nextA?.y === destinationA.y &&
        nextB?.x === destinationB.x && nextB?.y === destinationB.y;
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
  assert.deepEqual({ x: confirmedA.x, y: confirmedA.y }, destinationA);
  assert.deepEqual({ x: confirmedB.x, y: confirmedB.y }, destinationB);
  assert.equal("lock" in confirmedA, false);
  assert.equal("lock" in confirmedB, false);

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

  const supersededSessionMove = await request("move", {
    method: "POST",
    body: participantBody(alice, aliceToken.id, destinationA),
  });
  assert.equal(supersededSessionMove.response.status, 403);

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

test("the last accepted move wins when two authorized clients move the same token", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const dm = (await join(`LWW DM ${suffix}`, "dm")).participant;
  const player = (await join(`LWW Player ${suffix}`)).participant;
  const initial = await viewerState(dm);
  const originalStatus = initial.body.encounter.status;
  let tokenId;

  try {
    await command(dm, "configure-encounter", { status: "setup" });
    const created = await command(dm, "create-token", {
      name: `Last write token ${suffix}`,
      kind: "character",
      size: "medium",
      speed: 30,
      x: 3.25,
      y: 3.25,
    });
    assert.equal(created.response.status, 200);
    tokenId = created.body.tokenId;

    const claim = await request("claim", {
      method: "POST",
      body: participantBody(player, tokenId),
    });
    assert.equal(claim.response.status, 200);

    const retiredLockEndpoint = await fetch(endpoint("lock"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: participantBody(player, tokenId),
    });
    assert.equal(retiredLockEndpoint.status, 404);

    const dmMove = await request("move", {
      method: "POST",
      body: participantBody(dm, tokenId, { x: 5.125, y: 4.625, override: true }),
    });
    assert.equal(dmMove.response.status, 200);

    const playerMove = await request("move", {
      method: "POST",
      body: participantBody(player, tokenId, { x: 6.375, y: 5.875 }),
    });
    assert.equal(playerMove.response.status, 200);

    const confirmed = await viewerState(dm);
    const movedToken = confirmed.body.tokens.find((token) => token.id === tokenId);
    assert.deepEqual({ x: movedToken.x, y: movedToken.y }, { x: 6.375, y: 5.875 });
  } finally {
    if (tokenId) await command(dm, "delete-token", { tokenId }).catch(() => null);
    await command(dm, "configure-encounter", { status: originalStatus }).catch(() => null);
  }
});

test("map presets persist privately and applied packages resize the shared authoritative grid", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const dm = (await join(`Map DM ${suffix}`, "dm")).participant;
  const player = (await join(`Map Player ${suffix}`)).participant;
  const initial = await viewerState(dm);
  const originalPackage = initial.body.encounter.mapPackage;
  const width = 18;
  const height = 12;
  const mapPackage = {
    format: "dnd-battle-map",
    version: 1,
    id: `api-map-${suffix}`,
    name: `Haunted API Ruins ${suffix}`,
    description: "A durable map-package verification fixture.",
    biome: "ruins",
    mood: "moonlight",
    seed: `API-${suffix}`,
    width,
    height,
    visual: { kind: "generated-scene", assetUrl: "/map-assets/storm-coast-ruins-02.jpg", pixelWidth: 3072, pixelHeight: 2048, sceneKitId: "storm-coast" },
    sceneObjects: [{ id: `boat-${suffix}`, definitionId: "coast-boat", assetUrl: "/map-assets/scene-kits/coast-boat.png", x: 7, y: 5, width: 6, height: 6, rotation: 0 }],
    walls: [{ id: `wall-${suffix}`, x1: 2, y1: 2, x2: 8, y2: 2, style: "ruined" }],
    portals: [], labels: [], notes: [],
    source: { kind: "generated-scene" },
    createdAt: Date.now(),
  };
  let presetId;
  try {
    const saved = await command(dm, "save-map-preset", { name: mapPackage.name, mapPackage });
    assert.equal(saved.response.status, 200);
    assert.match(saved.body.presetId, /^[a-f0-9-]{36}$/);
    presetId = saved.body.presetId;
    assert.equal(saved.body.state.savedMapPresets.some((preset) => preset.id === presetId), true);

    const privatePlayerState = await viewerState(player);
    assert.deepEqual(privatePlayerState.body.savedMapPresets, []);

    const applied = await command(dm, "apply-map-package", { presetId });
    assert.equal(applied.response.status, 200);
    assert.deepEqual(applied.body.state.grid, { width, height, feetPerCell: 5 });
    assert.equal(applied.body.state.encounter.mapPackage.id, mapPackage.id);
    assert.equal(applied.body.state.encounter.activeMapPresetId, presetId);

    const shared = await viewerState(player);
    assert.equal(shared.body.encounter.mapPackage.name, mapPackage.name);
    assert.deepEqual(shared.body.grid, { width, height, feetPerCell: 5 });

    const editedDraft = { ...mapPackage, name: `${mapPackage.name} · Edited`, description: "The currently edited workshop draft must win over its older saved preset." };
    const editedApplication = await command(dm, "apply-map-package", { presetId, mapPackage: editedDraft });
    assert.equal(editedApplication.response.status, 200);
    assert.equal(editedApplication.body.state.encounter.mapPackage.name, editedDraft.name);
    assert.equal(editedApplication.body.state.encounter.activeMapPresetId, null, "An edited draft must not masquerade as the older saved preset");

    const editedShared = await viewerState(player);
    assert.equal(editedShared.body.encounter.mapPackage.description, editedDraft.description);

    const deleted = await command(dm, "delete-map-preset", { presetId });
    assert.equal(deleted.response.status, 200);
    presetId = null;
    assert.equal(deleted.body.state.encounter.mapPackage.name, editedDraft.name, "Deleting a preset must not erase the already-applied map");
    assert.equal(deleted.body.state.encounter.activeMapPresetId, null);
  } finally {
    if (presetId) await command(dm, "delete-map-preset", { presetId }).catch(() => null);
    if (originalPackage) await command(dm, "apply-map-package", { mapPackage: originalPackage }).catch(() => null);
    else await command(dm, "configure-encounter", { status: initial.body.encounter.status }).catch(() => null);
  }
});

test("initiative, turn groups, tactical state, visibility, setup, and undo stay authoritative", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const dm = (await join(`DM ${suffix}`, "dm")).participant;
  const player = (await join(`Player ${suffix}`)).participant;
  const latePlayer = (await join(`Late Player ${suffix}`)).participant;
  const createdIds = [];
  let originalStatus;
  try {
    const initial = await viewerState(dm);
    assert.equal(initial.response.status, 200);
    originalStatus = initial.body.encounter.status;

    const configure = await command(dm, "configure-encounter", {
      status: "paused",
    });
    assert.equal(configure.response.status, 200);
    assert.equal(configure.body.state.encounter.status, "paused");

    const character = await command(dm, "create-token", {
      name: `Hero ${suffix}`,
      kind: "character",
      size: "medium",
      speed: 30,
      hp: 24,
      maxHp: 24,
      artAsset: "/assets/tokens/characters/dareleth-paladin-01.png",
      x: 2.25,
      y: 2.5,
    });
    assert.equal(character.response.status, 200);
    const characterId = character.body.tokenId;
    createdIds.push(characterId);

    const monster = await command(dm, "create-token", {
      name: `Warg ${suffix}`,
      kind: "monster",
      size: "large",
      speed: 40,
      hp: 20,
      maxHp: 40,
      artAsset: "/creature-assets/tokens/monsters/shadow-dire-warg-01.png",
      hidden: true,
      x: initial.body.grid.width - 0.1,
      y: initial.body.grid.height - 0.1,
    });
    assert.equal(monster.response.status, 200);
    const monsterId = monster.body.tokenId;
    createdIds.push(monsterId);
    const placedMonster = monster.body.state.tokens.find((token) => token.id === monsterId);
    assert.deepEqual(
      { size: placedMonster.size, x: placedMonster.x, y: placedMonster.y },
      { size: "large", x: initial.body.grid.width - 0.86, y: initial.body.grid.height - 0.86 },
    );

    const untrackedCharacter = await command(dm, "create-token", {
      name: `Untracked Hero ${suffix}`,
      kind: "character",
      size: "medium",
      speed: 30,
      artAsset: "/assets/tokens/characters/malichar-rogue-01.png",
      x: 6.5,
      y: 8.5,
    });
    assert.equal(untrackedCharacter.response.status, 200);
    const untrackedCharacterId = untrackedCharacter.body.tokenId;
    createdIds.push(untrackedCharacterId);

    const preclaimSummon = await command(dm, "create-token", {
      name: `Imp ${suffix}`,
      kind: "summon",
      size: "tiny",
      speed: 40,
      artAsset: "/creature-assets/tokens/creatures/imp-01.png",
      summonerTokenId: untrackedCharacterId,
      x: 7.5,
      y: 8.5,
    });
    assert.equal(preclaimSummon.response.status, 200);
    const preclaimSummonId = preclaimSummon.body.tokenId;
    createdIds.push(preclaimSummonId);
    const preclaimSummonToken = preclaimSummon.body.state.tokens.find((token) => token.id === preclaimSummonId);
    assert.equal(preclaimSummonToken.owner, null);
    assert.equal(preclaimSummonToken.artAsset, "/creature-assets/tokens/creatures/imp-01.png");

    const untrackedClaim = await request("claim", {
      method: "POST",
      body: participantBody(latePlayer, untrackedCharacterId),
    });
    assert.equal(untrackedClaim.response.status, 200);
    assert.equal(
      untrackedClaim.body.state.tokens.find((token) => token.id === preclaimSummonId).owner.participantId,
      latePlayer.id,
    );

    const claim = await request("claim", {
      method: "POST",
      body: participantBody(player, characterId),
    });
    assert.equal(claim.response.status, 200);

    const summon = await command(dm, "create-token", {
      name: `Griffon ${suffix}`,
      kind: "summon",
      size: "large",
      speed: 35,
      hp: 12,
      maxHp: 12,
      artAsset: "/creature-assets/tokens/monsters/hungry-01.png",
      summonerTokenId: characterId,
      x: 3.25,
      y: 2.5,
    });
    assert.equal(summon.response.status, 200);
    const summonId = summon.body.tokenId;
    createdIds.push(summonId);
    assert.equal(summon.body.state.tokens.find((token) => token.id === summonId).owner.participantId, player.id);

    const playerHiddenState = await viewerState(player);
    assert.equal(playerHiddenState.body.tokens.some((token) => token.id === monsterId), false);
    const dmHiddenState = await viewerState(dm);
    assert.equal(dmHiddenState.body.tokens.find((token) => token.id === monsterId).hp, 20);

    let reveal = await command(dm, "update-token", { tokenId: monsterId, hidden: false, size: "huge" });
    assert.equal(reveal.response.status, 200);
    let resizedMonster = reveal.body.state.tokens.find((token) => token.id === monsterId);
    assert.deepEqual(
      { size: resizedMonster.size, x: resizedMonster.x, y: resizedMonster.y },
      { size: "huge", x: initial.body.grid.width - 1.29, y: initial.body.grid.height - 1.29 },
    );
    const undoResize = await command(dm, "undo");
    assert.equal(undoResize.response.status, 200);
    const restoredMonster = undoResize.body.state.tokens.find((token) => token.id === monsterId);
    assert.deepEqual(
      { size: restoredMonster.size, x: restoredMonster.x, y: restoredMonster.y, hidden: restoredMonster.hidden },
      { size: "large", x: initial.body.grid.width - 0.86, y: initial.body.grid.height - 0.86, hidden: true },
    );
    reveal = await command(dm, "update-token", { tokenId: monsterId, hidden: false, size: "huge" });
    resizedMonster = reveal.body.state.tokens.find((token) => token.id === monsterId);
    assert.equal(resizedMonster.size, "huge");
    const playerVisibleState = await viewerState(player);
    const coarseMonster = playerVisibleState.body.tokens.find((token) => token.id === monsterId);
    assert.equal(coarseMonster.hp, null);
    assert.equal(coarseMonster.maxHp, null);
    assert.equal(coarseMonster.healthState, "bloodied");
    assert.equal(playerVisibleState.body.tokens.find((token) => token.id === characterId).hp, 24);

    const playerInitiative = await command(player, "set-initiative", { tokenId: characterId, initiative: 18 });
    assert.equal(playerInitiative.response.status, 200);
    const monsterInitiative = await command(dm, "set-initiative", { tokenId: monsterId, initiative: 12 });
    assert.equal(monsterInitiative.response.status, 200);
    const start = await command(dm, "start-combat");
    assert.equal(start.response.status, 200);
    assert.equal(start.body.state.encounter.currentRound, 1);
    const activeHero = start.body.state.tokens.find((token) => token.id === characterId);
    const activeSummon = start.body.state.tokens.find((token) => token.id === summonId);
    assert.equal(activeHero.initiativeOrder, activeSummon.initiativeOrder);
    assert.equal(activeHero.initiativeOrder, start.body.state.encounter.activeInitiativeOrder);

    const untrackedMove = await request("move", {
      method: "POST",
      body: participantBody(latePlayer, untrackedCharacterId, {
        x: 7.35,
        y: 8.15,
      }),
    });
    assert.equal(untrackedMove.response.status, 200);
    assert.deepEqual(
      (({ x, y }) => ({ x, y }))(
        untrackedMove.body.state.tokens.find((token) => token.id === untrackedCharacterId),
      ),
      { x: 7.35, y: 8.15 },
    );

    const inheritedSummonMove = await request("move", {
      method: "POST",
      body: participantBody(latePlayer, preclaimSummonId, {
        x: 8.1,
        y: 8.2,
      }),
    });
    assert.equal(inheritedSummonMove.response.status, 200);
    assert.equal(
      inheritedSummonMove.body.state.tokens.find((token) => token.id === preclaimSummonId).owner.participantId,
      latePlayer.id,
    );

    const unauthorizedMonsterMove = await request("move", {
      method: "POST",
      body: participantBody(player, monsterId, { x: 7.5, y: 7.5 }),
    });
    assert.equal(unauthorizedMonsterMove.response.status, 403);

    const move = await request("move", {
      method: "POST",
      body: participantBody(player, characterId, {
        x: 4.25,
        y: 3.5,
      }),
    });
    assert.equal(move.response.status, 200);
    assert.equal(move.body.distance, 10);
    assert.equal(move.body.movementUsed, 10);

    const overBudgetMove = await request("move", {
      method: "POST",
      body: participantBody(player, characterId, {
        x: 10.25,
        y: 3.5,
      }),
    });
    assert.equal(overBudgetMove.response.status, 200);
    assert.equal(overBudgetMove.body.distance, 30);
    assert.equal(overBudgetMove.body.movementUsed, 40);
    assert.equal(overBudgetMove.body.overBudget, true);
    const afterOverBudgetMove = await viewerState(player);
    assert.deepEqual(
      (({ x, y, movementUsed }) => ({ x, y, movementUsed }))(
        afterOverBudgetMove.body.tokens.find((token) => token.id === characterId),
      ),
      { x: 10.25, y: 3.5, movementUsed: 40 },
    );

    const dmOverrideMove = await request("move", {
      method: "POST",
      body: participantBody(dm, monsterId, {
        x: 0.4,
        y: 7.7,
      }),
    });
    assert.equal(dmOverrideMove.response.status, 200);
    assert.ok(dmOverrideMove.body.distance > 40);

    const concentration = await command(player, "add-effect", {
      tokenId: characterId,
      name: "Bless",
      effectType: "concentration",
      durationRounds: 1,
    });
    assert.equal(concentration.response.status, 200);
    const damage = await command(player, "apply-hp", { tokenId: characterId, delta: -5 });
    assert.equal(damage.response.status, 200);
    assert.equal(damage.body.concentrationCheckRequired, true);

    const summonEnd = await command(player, "end-turn", { tokenId: summonId });
    assert.equal(summonEnd.response.status, 200);
    assert.equal(summonEnd.body.advanced, false);
    const heroEnd = await command(player, "end-turn", { tokenId: characterId });
    assert.equal(heroEnd.response.status, 200);
    assert.equal(heroEnd.body.advanced, true);
    assert.notEqual(heroEnd.body.state.encounter.activeInitiativeOrder, activeHero.initiativeOrder);

    const correction = await command(dm, "correct-turn", {
      round: 2,
      activeOrder: activeHero.initiativeOrder,
    });
    assert.equal(correction.response.status, 200);
    assert.equal(correction.body.state.encounter.currentRound, 2);
    assert.equal(
      correction.body.state.tokens.find((token) => token.id === characterId).effects[0].due,
      true,
    );

    const forbiddenSpotlight = await command(player, "add-annotation", {
      annotationType: "spotlight",
      x: 5,
      y: 5,
    });
    assert.equal(forbiddenSpotlight.response.status, 403);
    const drawing = await command(player, "add-annotation", {
      annotationType: "drawing",
      x: 1,
      y: 1,
      x2: 2,
      y2: 2,
    });
    assert.equal(drawing.response.status, 200);
    assert.ok(drawing.body.state.annotations.some((annotation) => annotation.id === drawing.body.annotationId));
    assert.ok(drawing.body.state.undo.available > 0);
    const undo = await command(player, "undo");
    assert.equal(undo.response.status, 200);
    assert.equal(undo.body.actionType, "annotation_added");
    assert.equal(undo.body.state.annotations.some((annotation) => annotation.id === drawing.body.annotationId), false);

    const erasableDrawing = await command(player, "add-annotation", {
      annotationType: "drawing",
      x: 2,
      y: 2,
      x2: 4,
      y2: 3,
    });
    assert.equal(erasableDrawing.response.status, 200);
    const eraseOwnDrawing = await command(player, "remove-annotation", {
      annotationId: erasableDrawing.body.annotationId,
    });
    assert.equal(eraseOwnDrawing.response.status, 200);
    assert.equal(eraseOwnDrawing.body.state.annotations.some((annotation) => annotation.id === erasableDrawing.body.annotationId), false);
    const undoErase = await command(player, "undo");
    assert.equal(undoErase.response.status, 200);
    assert.equal(undoErase.body.actionType, "annotation_removed");
    assert.equal(undoErase.body.state.annotations.some((annotation) => annotation.id === erasableDrawing.body.annotationId), true);

    const dmDrawing = await command(dm, "add-annotation", {
      annotationType: "drawing",
      x: 5,
      y: 2,
      x2: 6,
      y2: 4,
    });
    assert.equal(dmDrawing.response.status, 200);
    const forbiddenErase = await command(player, "remove-annotation", {
      annotationId: dmDrawing.body.annotationId,
    });
    assert.equal(forbiddenErase.response.status, 403);
    const dmErase = await command(dm, "remove-annotation", {
      annotationId: dmDrawing.body.annotationId,
    });
    assert.equal(dmErase.response.status, 200);

    const resetSetup = await command(dm, "configure-encounter", {
      status: "setup",
    });
    assert.equal(resetSetup.response.status, 200);
    assert.equal(resetSetup.body.state.encounter.currentRound, 0);
    assert.equal(resetSetup.body.state.encounter.activeInitiativeOrder, null);
    assert.ok(resetSetup.body.state.tokens.every((token) => token.initiativeOrder === null));
    originalStatus = null;
  } finally {
    for (const tokenId of createdIds.reverse()) {
      await command(dm, "delete-token", { tokenId }).catch(() => null);
    }
    if (originalStatus) {
      await command(dm, "configure-encounter", { status: originalStatus }).catch(() => null);
    }
  }
});

test("eight joined clients converge on one collaboration update", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const dm = (await join(`Load DM ${suffix}`, "dm")).participant;
  const viewers = await Promise.all(
    Array.from({ length: 7 }, (_, index) => join(`Load P${index + 1} ${suffix}`)),
  );
  const clients = [dm, ...viewers.map((viewer) => viewer.participant)];
  try {
    const baselines = await Promise.all(clients.map((client) => viewerState(client)));
    const started = performance.now();
    const observations = clients.map((client, index) => waitForPolledState(
      baselines[index].body.encounter.version,
      (state) => state.annotations.some((annotation) => annotation.label === suffix),
      5_000,
      {
        "x-participant-id": client.id,
        "x-session-secret": client.sessionSecret,
      },
    ));
    const ping = await command(dm, "add-annotation", {
      annotationType: "ping",
      x: 6.25,
      y: 4.75,
      label: suffix,
    });
    assert.equal(ping.response.status, 200);
    await Promise.all(observations);
    const convergenceMs = performance.now() - started;
    assert.ok(convergenceMs < 2_500, `Eight-client convergence took ${convergenceMs.toFixed(0)}ms`);
    console.log(`Eight-client collaboration convergence: ${convergenceMs.toFixed(0)}ms`);

    const budgetStarted = performance.now();
    const budgetWindowMs = 2_000;
    const requestCounts = await Promise.all(clients.map(async (client) => {
      let count = 0;
      let since = ping.body.state.encounter.version;
      while (performance.now() - budgetStarted < budgetWindowMs) {
        const response = await fetch(`${endpoint("events")}?since=${since}`, {
          headers: {
            accept: "application/json",
            "x-participant-id": client.id,
            "x-session-secret": client.sessionSecret,
          },
        });
        assert.ok([200, 204].includes(response.status));
        if (response.status === 200) {
          const refreshed = await response.json();
          since = refreshed.encounter.version;
        }
        count += 1;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return count;
    }));
    const requestRate = requestCounts.reduce((total, count) => total + count, 0) /
      ((performance.now() - budgetStarted) / 1_000);
    assert.ok(requestRate < 40, `Idle polling exceeded the 40 request/second budget: ${requestRate.toFixed(1)}`);
    console.log(`Eight-client idle request rate: ${requestRate.toFixed(1)} requests/second`);
  } finally {
    await command(dm, "clear-annotations").catch(() => null);
  }
});
