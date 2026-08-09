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
const FIXED_IDENTITIES = Object.freeze({
  dan: { name: "Dan", role: "player", tokenId: "token-bronze-warden" },
  barry: { name: "Barry", role: "player", tokenId: "token-ash-mystic" },
  scott: { name: "Scott", role: "player", tokenId: "token-ember-scout" },
  kevin: { name: "Kevin", role: "dm", tokenId: null },
});

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

async function joinIdentity(identity) {
  return join(identity.name, identity.role);
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

test("lists durable scenarios for the join chooser", async () => {
  const response = await fetch(`${baseUrl}/api/encounters`, { headers: { accept: "application/json" } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.items));
  assert.ok(body.items.some((encounter) => encounter.code === code && encounter.name === "The Ember Keep"));
  assert.ok(body.items.every((encounter) => typeof encounter.status === "string" && Number.isFinite(encounter.updatedAt)));
});

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
  assert.match(catalog.items[0].thumbnailAsset, /variant=thumbnail&v=3$/);
  assert.ok(catalog.families.includes("fiend"));
  const thumbnailResponse = await fetch(`${baseUrl}${catalog.items[0].thumbnailAsset}`);
  assert.equal(thumbnailResponse.status, 200);
  assert.match(thumbnailResponse.headers.get("content-type") ?? "", /^image\//);
  const thumbnailBytes = (await thumbnailResponse.arrayBuffer()).byteLength;
  assert.ok(thumbnailBytes > 1_000);
  assert.ok(thumbnailBytes < 100_000, `Thumbnail should stay lightweight, received ${thumbnailBytes} bytes`);
});

test("fixed identities independently move disposable summons without reservations", async () => {
  const [dmJoin, danJoin, barryJoin, scottJoin] = await Promise.all([
    joinIdentity(FIXED_IDENTITIES.kevin),
    joinIdentity(FIXED_IDENTITIES.dan),
    joinIdentity(FIXED_IDENTITIES.barry),
    joinIdentity(FIXED_IDENTITIES.scott),
  ]);
  const dm = dmJoin.participant;
  const dan = danJoin.participant;
  const barry = barryJoin.participant;
  const initial = scottJoin.state;
  const initialStrictMovement = initial.encounter.strictMovement;
  const createdIds = [];
  assert.equal(initial.encounter.code, code);
  assert.deepEqual(danJoin.state.grid, barryJoin.state.grid);

  try {
    const strictOn = await command(dm, "set-strict-movement", { enabled: true });
    assert.equal(strictOn.response.status, 200);
    assert.equal(strictOn.body.state.encounter.strictMovement, true);
    const playerCannotChangePolicy = await command(dan, "set-strict-movement", { enabled: false });
    assert.equal(playerCannotChangePolicy.response.status, 403);

    const danSummon = await command(dan, "create-token", {
      name: `Dan sync summon ${Date.now()}`,
      kind: "monster",
      size: "small",
      speed: 30,
      hidden: true,
      summonerTokenId: FIXED_IDENTITIES.dan.tokenId,
      x: 3.25,
      y: 3.25,
    });
    const barrySummon = await command(barry, "create-token", {
      name: `Barry sync summon ${Date.now()}`,
      kind: "summon",
      size: "small",
      speed: 30,
      summonerTokenId: FIXED_IDENTITIES.barry.tokenId,
      x: 6.25,
      y: 5.25,
    });
    assert.equal(danSummon.response.status, 200);
    assert.equal(barrySummon.response.status, 200);
    createdIds.push(danSummon.body.tokenId, barrySummon.body.tokenId);
    const aliceToken = danSummon.body.state.tokens.find((token) => token.id === danSummon.body.tokenId);
    const bobToken = barrySummon.body.state.tokens.find((token) => token.id === barrySummon.body.tokenId);
    assert.equal(aliceToken.kind, "summon");
    assert.equal(aliceToken.hidden, false);
    assert.equal(aliceToken.controller.name, "Dan");
    assert.equal(bobToken.controller.name, "Barry");

    const moonbeam = await command(dan, "create-spell-effect", {
      spellId: "moonbeam",
      summonerTokenId: FIXED_IDENTITIES.dan.tokenId,
      x: 8.5,
      y: 4.5,
    });
    const flamingSphere = await command(barry, "create-spell-effect", {
      spellId: "flaming-sphere",
      summonerTokenId: FIXED_IDENTITIES.barry.tokenId,
      x: 10.5,
      y: 5.5,
    });
    const magicCircle = await command(dan, "create-spell-effect", {
      spellId: "magic-circle",
      summonerTokenId: FIXED_IDENTITIES.dan.tokenId,
      x: 13.5,
      y: 8.5,
    });
    assert.equal(moonbeam.response.status, 200);
    assert.equal(flamingSphere.response.status, 200);
    assert.equal(magicCircle.response.status, 200);
    createdIds.push(moonbeam.body.tokenId, flamingSphere.body.tokenId, magicCircle.body.tokenId);
    const moonbeamToken = moonbeam.body.state.tokens.find((token) => token.id === moonbeam.body.tokenId);
    const sphereToken = flamingSphere.body.state.tokens.find((token) => token.id === flamingSphere.body.tokenId);
    const circleToken = magicCircle.body.state.tokens.find((token) => token.id === magicCircle.body.tokenId);
    assert.equal(moonbeamToken.kind, "spell-effect");
    assert.equal(moonbeamToken.size, "large");
    assert.equal(moonbeamToken.controller.name, "Dan");
    assert.equal(sphereToken.kind, "spell-effect");
    assert.equal(sphereToken.size, "medium");
    assert.equal(sphereToken.controller.name, "Barry");
    assert.equal(circleToken.kind, "spell-effect");
    assert.equal(circleToken.size, "gargantuan");
    assert.equal(circleToken.controller.name, "Dan");
    const moveMoonbeam = await request("move", {
      method: "POST",
      body: participantBody(dan, moonbeam.body.tokenId, { x: 9.25, y: 6.25 }),
    });
    assert.equal(moveMoonbeam.response.status, 200);
    assert.equal(moveMoonbeam.body.distance, 0);
    assert.equal(moveMoonbeam.body.movementUsed, 0);
    const forbiddenForeignSpell = await command(dan, "create-spell-effect", {
      spellId: "flaming-sphere",
      summonerTokenId: FIXED_IDENTITIES.barry.tokenId,
      x: 2,
      y: 2,
    });
    assert.equal(forbiddenForeignSpell.response.status, 403);
    const dismissMoonbeam = await command(dan, "delete-token", { tokenId: moonbeam.body.tokenId });
    assert.equal(dismissMoonbeam.response.status, 200);
    assert.equal(dismissMoonbeam.body.state.tokens.some((token) => token.id === moonbeam.body.tokenId), false);

    const forbiddenUnattachedCreature = await command(dan, "create-token", {
      name: "Not a summon",
      kind: "monster",
      size: "small",
      speed: 30,
      x: 2,
      y: 2,
    });
    assert.equal(forbiddenUnattachedCreature.response.status, 403);
    const forbiddenForeignSummon = await command(dan, "create-token", {
      name: "Wrong summoner",
      kind: "summon",
      size: "small",
      speed: 30,
      summonerTokenId: FIXED_IDENTITIES.barry.tokenId,
      x: 2,
      y: 2,
    });
    assert.equal(forbiddenForeignSummon.response.status, 403);

    const heartbeat = await request("heartbeat", {
      method: "POST",
      body: sessionBody(dan),
    });
    assert.equal(heartbeat.response.status, 200);
    assert.deepEqual(heartbeat.body, { present: true });

    const invalidHeartbeat = await request("heartbeat", {
      method: "POST",
      body: JSON.stringify({
        participantId: dan.id,
        sessionSecret: barry.sessionSecret,
      }),
    });
    assert.equal(invalidHeartbeat.response.status, 401);

    const retiredClaimEndpoint = await fetch(endpoint("claim"), { method: "POST" });
    assert.equal(retiredClaimEndpoint.status, 404);

    const destinationA = destinationFor(aliceToken, initial.grid, 1.137, 0.413);
    const destinationB = destinationFor(bobToken, initial.grid, 0.619, 1.271);
    assert.notEqual(destinationA.x, Math.trunc(destinationA.x));
    assert.notEqual(destinationB.y, Math.trunc(destinationB.y));

    const spoofedMove = await request("move", {
      method: "POST",
      body: JSON.stringify({
        participantId: dan.id,
        sessionSecret: barry.sessionSecret,
        tokenId: aliceToken.id,
        ...destinationA,
      }),
    });
    assert.equal(spoofedMove.response.status, 401);

    const unauthorizedMove = await request("move", {
      method: "POST",
      body: participantBody(barry, aliceToken.id, destinationA),
    });
    assert.equal(unauthorizedMove.response.status, 403);

    const strictOff = await command(dm, "set-strict-movement", { enabled: false });
    assert.equal(strictOff.response.status, 200);
    assert.equal(strictOff.body.state.encounter.strictMovement, false);
    const openDestination = destinationFor(aliceToken, initial.grid, 0.431, 1.183);
    const openMove = await request("move", {
      method: "POST",
      body: participantBody(barry, aliceToken.id, openDestination),
    });
    assert.equal(openMove.response.status, 200);
    assert.deepEqual(
      (({ x, y }) => ({ x, y }))(openMove.body.state.tokens.find((token) => token.id === aliceToken.id)),
      openDestination,
    );
    const strictRestored = await command(dm, "set-strict-movement", { enabled: true });
    assert.equal(strictRestored.response.status, 200);

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
        body: participantBody(dan, aliceToken.id, destinationA),
      }),
      request("move", {
        method: "POST",
        body: participantBody(barry, bobToken.id, destinationB),
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

    const reconnectedDan = (await joinIdentity(FIXED_IDENTITIES.dan)).participant;
    const reconnectDestination = destinationFor(receivedA, initial.grid, 0.427, 0.733);
    const reconnectMove = await request("move", {
      method: "POST",
      body: participantBody(reconnectedDan, aliceToken.id, reconnectDestination),
    });
    assert.equal(reconnectMove.response.status, 200);
    const originalSessionStillValid = await request("heartbeat", {
      method: "POST",
      body: sessionBody(dan),
    });
    assert.equal(originalSessionStillValid.response.status, 200);

    console.log(`Two-token propagation to observer: ${propagationMs.toFixed(0)}ms`);
  } finally {
    for (const tokenId of createdIds.reverse()) {
      await command(dm, "delete-token", { tokenId }).catch(() => null);
    }
    await command(dm, "set-strict-movement", { enabled: initialStrictMovement }).catch(() => null);
  }
});

test("the last accepted move wins when two authorized clients move the same token", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const dm = (await joinIdentity(FIXED_IDENTITIES.kevin)).participant;
  const firstDan = (await joinIdentity(FIXED_IDENTITIES.dan)).participant;
  const secondDan = (await joinIdentity(FIXED_IDENTITIES.dan)).participant;
  let tokenId;

  try {
    const created = await command(dm, "create-token", {
      name: `Last write token ${suffix}`,
      kind: "summon",
      size: "medium",
      speed: 30,
      summonerTokenId: FIXED_IDENTITIES.dan.tokenId,
      x: 3.25,
      y: 3.25,
    });
    assert.equal(created.response.status, 200);
    tokenId = created.body.tokenId;

    const retiredLockEndpoint = await fetch(endpoint("lock"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: participantBody(firstDan, tokenId),
    });
    assert.equal(retiredLockEndpoint.status, 404);

    const firstMove = await request("move", {
      method: "POST",
      body: participantBody(firstDan, tokenId, { x: 5.125, y: 4.625 }),
    });
    assert.equal(firstMove.response.status, 200);

    const secondMove = await request("move", {
      method: "POST",
      body: participantBody(secondDan, tokenId, { x: 6.375, y: 5.875 }),
    });
    assert.equal(secondMove.response.status, 200);

    const confirmed = await viewerState(dm);
    const movedToken = confirmed.body.tokens.find((token) => token.id === tokenId);
    assert.deepEqual({ x: movedToken.x, y: movedToken.y }, { x: 6.375, y: 5.875 });
  } finally {
    if (tokenId) await command(dm, "delete-token", { tokenId }).catch(() => null);
  }
});

test("map presets persist privately and applied packages resize the shared authoritative grid", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const dm = (await joinIdentity(FIXED_IDENTITIES.kevin)).participant;
  const player = (await joinIdentity(FIXED_IDENTITIES.scott)).participant;
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
    portals: [],
    labels: [
      { id: `public-label-${suffix}`, x: 4, y: 4, text: "Collapsed arch", visibility: "everyone" },
      { id: `dm-label-${suffix}`, x: 6, y: 6, text: "Secret door", visibility: "dm" },
    ],
    notes: [{ id: `dm-note-${suffix}`, x: 5, y: 5, text: "The floor gives way here." }],
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
    assert.deepEqual(shared.body.encounter.mapPackage.notes, [], "players must not receive private DM-note text or markers");
    assert.deepEqual(shared.body.encounter.mapPackage.labels.map((label) => label.text), ["Collapsed arch"], "players receive only public labels");
    assert.equal(applied.body.state.encounter.mapPackage.notes[0].text, "The floor gives way here.", "the DM keeps the complete package");
    assert.equal(applied.body.state.encounter.mapPackage.labels.length, 2);

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
  const dm = (await joinIdentity(FIXED_IDENTITIES.kevin)).participant;
  const player = (await joinIdentity(FIXED_IDENTITIES.dan)).participant;
  const latePlayer = (await joinIdentity(FIXED_IDENTITIES.scott)).participant;
  const createdIds = [];
  let originalStatus;
  let originalStrictMovement;
  try {
    const initial = await viewerState(dm);
    assert.equal(initial.response.status, 200);
    originalStatus = initial.body.encounter.status;
    originalStrictMovement = initial.body.encounter.strictMovement;
    const strictOn = await command(dm, "set-strict-movement", { enabled: true });
    assert.equal(strictOn.response.status, 200);

    const configure = await command(dm, "configure-encounter", {
      status: "paused",
    });
    assert.equal(configure.response.status, 200);
    assert.equal(configure.body.state.encounter.status, "paused");

    const character = await command(dm, "create-token", {
      name: "Dar'eleth",
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

    const secondMonster = await command(dm, "create-token", {
      name: `Warg ${suffix} 2`,
      kind: "monster",
      size: "large",
      speed: 40,
      hp: 40,
      maxHp: 40,
      artAsset: "/creature-assets/tokens/monsters/shadow-dire-warg-01.png",
      x: 12,
      y: 7,
    });
    assert.equal(secondMonster.response.status, 200);
    const secondMonsterId = secondMonster.body.tokenId;
    createdIds.push(secondMonsterId);

    const untrackedCharacter = await command(dm, "create-token", {
      name: "Malichar",
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

    const inheritedSummon = await command(dm, "create-token", {
      name: `Imp ${suffix}`,
      kind: "summon",
      size: "tiny",
      speed: 40,
      artAsset: "/creature-assets/tokens/creatures/imp-01.png",
      summonerTokenId: untrackedCharacterId,
      x: 7.5,
      y: 8.5,
    });
    assert.equal(inheritedSummon.response.status, 200);
    const inheritedSummonId = inheritedSummon.body.tokenId;
    createdIds.push(inheritedSummonId);
    const inheritedSummonToken = inheritedSummon.body.state.tokens.find((token) => token.id === inheritedSummonId);
    assert.equal(inheritedSummonToken.controller.name, "Scott");
    assert.equal(inheritedSummonToken.artAsset, "/creature-assets/tokens/creatures/imp-01.png");

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
    assert.equal(summon.body.state.tokens.find((token) => token.id === summonId).controller.name, "Dan");

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

    const playerInitiative = await command(player, "set-initiative", { tokenId: characterId, initiative: 99 });
    assert.equal(playerInitiative.response.status, 200);
    const monsterInitiative = await command(dm, "set-initiative-group", { tokenIds: [monsterId, secondMonsterId], initiative: 12 });
    assert.equal(monsterInitiative.response.status, 200);
    const undoMonsterGroup = await command(dm, "undo");
    assert.equal(undoMonsterGroup.response.status, 200);
    assert.equal(undoMonsterGroup.body.actionType, "initiative_group_set");
    assert.equal(undoMonsterGroup.body.state.tokens.find((token) => token.id === monsterId).initiativeGroupId, null);
    const redoMonsterGroup = await command(dm, "redo");
    assert.equal(redoMonsterGroup.response.status, 200);
    assert.equal(redoMonsterGroup.body.actionType, "initiative_group_set");
    const start = await command(dm, "start-combat");
    assert.equal(start.response.status, 200);
    assert.equal(start.body.state.encounter.currentRound, 1);
    const activeHero = start.body.state.tokens.find((token) => token.id === characterId);
    const activeSummon = start.body.state.tokens.find((token) => token.id === summonId);
    const groupedMonster = start.body.state.tokens.find((token) => token.id === monsterId);
    const groupedMonsterPeer = start.body.state.tokens.find((token) => token.id === secondMonsterId);
    assert.equal(activeHero.initiativeOrder, activeSummon.initiativeOrder);
    assert.equal(activeHero.initiativeOrder, start.body.state.encounter.activeInitiativeOrder);
    assert.equal(groupedMonster.initiativeOrder, groupedMonsterPeer.initiativeOrder);

    const splitMonster = await command(dm, "set-initiative", { tokenId: secondMonsterId, initiative: 13 });
    assert.equal(splitMonster.response.status, 200);
    const splitMonsterA = splitMonster.body.state.tokens.find((token) => token.id === monsterId);
    const splitMonsterB = splitMonster.body.state.tokens.find((token) => token.id === secondMonsterId);
    assert.notEqual(splitMonsterA.initiativeOrder, splitMonsterB.initiativeOrder);
    assert.equal(
      splitMonster.body.state.tokens.find((token) => token.id === characterId).initiativeOrder,
      splitMonster.body.state.encounter.activeInitiativeOrder,
    );
    const regroupDuringCombat = await command(dm, "set-initiative-group", { tokenIds: [monsterId, secondMonsterId], initiative: 12 });
    assert.equal(regroupDuringCombat.response.status, 200);
    assert.equal(
      regroupDuringCombat.body.state.tokens.find((token) => token.id === monsterId).initiativeOrder,
      regroupDuringCombat.body.state.tokens.find((token) => token.id === secondMonsterId).initiativeOrder,
    );
    assert.equal(
      regroupDuringCombat.body.state.tokens.find((token) => token.id === characterId).initiativeOrder,
      regroupDuringCombat.body.state.encounter.activeInitiativeOrder,
    );

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
      body: participantBody(latePlayer, inheritedSummonId, {
        x: 8.1,
        y: 8.2,
      }),
    });
    assert.equal(inheritedSummonMove.response.status, 200);
    assert.equal(
      inheritedSummonMove.body.state.tokens.find((token) => token.id === inheritedSummonId).controller.name,
      "Scott",
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
    assert.equal(overBudgetMove.body.distance, 40);
    assert.equal(overBudgetMove.body.movementUsed, 40);
    assert.equal(overBudgetMove.body.overBudget, true);
    assert.deepEqual(overBudgetMove.body.state.tokens.find((token) => token.id === characterId).movementOrigin, { x: 2.25, y: 2.5 });

    const revisedMove = await request("move", {
      method: "POST",
      body: participantBody(player, characterId, {
        x: 5.25,
        y: 3.5,
      }),
    });
    assert.equal(revisedMove.response.status, 200);
    assert.equal(revisedMove.body.distance, 15);
    assert.equal(revisedMove.body.movementUsed, 15);
    assert.equal(revisedMove.body.overBudget, false);
    const afterOverBudgetMove = await viewerState(player);
    assert.deepEqual(
      (({ x, y, movementUsed, movementOrigin }) => ({ x, y, movementUsed, movementOrigin }))(
        afterOverBudgetMove.body.tokens.find((token) => token.id === characterId),
      ),
      { x: 5.25, y: 3.5, movementUsed: 15, movementOrigin: { x: 2.25, y: 2.5 } },
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
    assert.equal(summonEnd.body.advanced, true);
    assert.notEqual(summonEnd.body.state.encounter.activeInitiativeOrder, activeHero.initiativeOrder);

    const correction = await command(dm, "correct-turn", {
      round: 2,
      activeOrder: activeHero.initiativeOrder,
    });
    assert.equal(correction.response.status, 200);
    assert.equal(correction.body.state.encounter.currentRound, 2);
    assert.equal(correction.body.state.tokens.find((token) => token.id === characterId).movementUsed, 0);
    assert.equal(correction.body.state.tokens.find((token) => token.id === characterId).movementOrigin, null);
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
    if (typeof originalStrictMovement === "boolean") {
      await command(dm, "set-strict-movement", { enabled: originalStrictMovement }).catch(() => null);
    }
  }
});

test("eight joined clients converge on one collaboration update", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const dm = (await joinIdentity(FIXED_IDENTITIES.kevin)).participant;
  const viewerIdentities = [FIXED_IDENTITIES.dan, FIXED_IDENTITIES.barry, FIXED_IDENTITIES.scott];
  const viewers = await Promise.all(
    Array.from({ length: 7 }, (_, index) => joinIdentity(viewerIdentities[index % viewerIdentities.length])),
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
