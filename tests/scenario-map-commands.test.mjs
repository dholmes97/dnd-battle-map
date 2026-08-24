import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMapDraft,
  configureEncounter,
  createScenario,
  discardMapDraft,
  renameScenario,
  saveMapDraft,
} from "../worker/commands/scenario-map-commands.ts";

function context(overrides = {}) {
  const { repository: repositoryOverrides = {}, ...contextOverrides } = overrides;
  const calls = [];
  let id = 0;
  const repository = {
    renameScenario: async (...args) => calls.push(["rename", ...args]),
    countScenarios: async () => 1,
    scenarioCodeExists: async () => false,
    listScenarioTokens: async () => [],
    createScenario: async (value) => calls.push(["create", value]),
    findMapImage: async (mapImageId) => mapImageFor(createMapPackage(), mapImageId),
    saveMapDraft: async (...args) => calls.push(["save", ...args]),
    discardMapDraft: async (...args) => calls.push(["discard", ...args]),
    listTokenPositions: async () => [],
    applyMapDraft: async (value) => calls.push(["apply", value]),
    configureEncounter: async () => {},
    ...repositoryOverrides,
  };
  return {
    calls,
    repository,
    encounter: {
      id: "encounter-1",
      campaignId: "campaign-force-of-nature",
      code: "OLD-CODE",
      name: "Old name",
      version: 1,
      status: "setup",
      activeMapImageId: null,
      activeMapSetupJson: null,
      activeMapPackageJson: null,
      draftMapImageId: null,
      draftMapSetupJson: null,
      gridWidth: 24,
      gridHeight: 16,
      currentRound: 0,
      activeInitiativeOrder: null,
      strictMovement: true,
      updatedAt: 1,
    },
    participant: {
      id: "dm-1", name: "Kevin", role: "dm",
      identityId: "identity-kevin", campaignMembershipId: "membership-force-of-nature-kevin",
    },
    payload: {},
    now: 100,
    loadScenarioState: async (code, participantId) => ({ code, participantId }),
    services: {
      createId: () => `id-${++id}`,
      loadState: async () => ({ marker: "current" }),
      commit: async (...args) => calls.push(["commit", ...args]),
      commitFor: async (input) => calls.push(["commit-for", input]),
    },
    ...contextOverrides,
  };
}

test("scenario renaming authorizes through the command boundary", async () => {
  const denied = context({
    participant: { id: "player-1", name: "Dan", role: "player" },
    payload: { name: "A new name" },
  });
  assert.equal((await renameScenario(denied)).status, 403);
  assert.deepEqual(denied.calls, []);

  const allowed = context({ payload: { name: "A new name" } });
  const result = await renameScenario(allowed);
  assert.equal(result.payload.renamed, true);
  assert.deepEqual(allowed.calls[0], ["rename", "encounter-1", "A new name", 100]);
});

test("party scenario creation resets state and records history on the new scenario", async () => {
  const source = {
    id: "dar",
    name: "Dar'eleth",
    x: 3,
    y: 4,
    art_asset: "dar.png",
    kind: "character",
    size: "medium",
    speed: 30,
    fly_speed: null,
    swim_speed: null,
    climb_speed: null,
    burrow_speed: null,
    hp: 20,
    max_hp: 42,
    is_hidden: 1,
    summoner_token_id: null,
    campaign_character_id: "character-dareleth",
    initiative: 18,
    initiative_group_id: "old-group",
    initiative_order: 0,
    turn_complete: 1,
    movement_used: 10,
    altitude: 25,
    owner_participant_id: null,
    owner_name: null,
  };
  const value = context({
    payload: { name: "Fresh Adventure", mode: "party" },
    repository: { listScenarioTokens: async () => [source] },
  });
  const result = await createScenario(value);
  const write = value.calls.find(([name]) => name === "create")[1];
  assert.equal(write.activeMapImageId, null);
  assert.equal(write.draftMapSetupJson, null);
  assert.equal(write.tokens[0].copiedHp, 42);
  assert.equal(write.tokens[0].copiedHidden, false);
  assert.equal(write.tokens[0].copiedAltitude, 0);
  const recorded = value.calls.find(([name]) => name === "commit-for");
  assert.equal(recorded[1].encounterId, write.id);
  assert.equal(result.payload.state.code, "FRESH-ADVENTURE");
});

test("scenario quota fails without partial writes", async () => {
  const scenarioQuota = context({
    payload: { name: "One Too Many", mode: "party" },
    repository: { countScenarios: async () => 100 },
  });
  assert.equal((await createScenario(scenarioQuota)).status, 409);
  assert.deepEqual(scenarioQuota.calls, []);
});

test("map drafts save, apply, and discard behind a fakeable repository", async () => {
  const map = createMapPackage();
  const saved = context({ payload: { mapPackage: map } });
  assert.equal((await saveMapDraft(saved)).payload.saved, true);
  assert.equal(saved.calls.find(([name]) => name === "save")[2], map.id);

  const applied = context({
    payload: { mapPackage: map },
    repository: {
      listTokenPositions: async () => [{ id: "token", x: -10, y: 99, size: "large" }],
    },
  });
  assert.equal((await applyMapDraft(applied)).payload.applied, true);
  assert.deepEqual(
    applied.calls.find(([name]) => name === "apply")[1].tokenPositions[0],
    { id: "token", x: 0.86, y: 15.14 },
  );

  const discarded = context();
  assert.equal((await discardMapDraft(discarded)).payload.discarded, true);
  assert.deepEqual(discarded.calls.find(([name]) => name === "discard"), ["discard", "encounter-1", 100]);
});

test("encounter configuration enforces the core combat transition policy", async () => {
  const invalidPause = context({ payload: { status: "paused" } });
  assert.equal((await configureEncounter(invalidPause)).status, 409);
  assert.deepEqual(invalidPause.calls, []);

  const paused = context({
    encounter: {
      ...context().encounter,
      status: "active",
      currentRound: 2,
      activeInitiativeOrder: 1,
    },
    payload: { status: "paused" },
    repository: {
      configureEncounter: async (...args) => paused.calls.push(["configure", ...args]),
    },
  });
  assert.equal((await configureEncounter(paused)).payload.configured, true);
  assert.equal(paused.calls.find(([name]) => name === "configure")[2], "paused");

  const corruptResume = context({
    encounter: { ...context().encounter, status: "paused" },
    payload: { status: "active" },
  });
  assert.equal((await configureEncounter(corruptResume)).status, 409);
});

function createMapPackage() {
  return {
    format: "dnd-battle-map",
    version: 1,
    id: "map-1",
    name: "Map",
    description: "",
    width: 24,
    height: 16,
    biome: "dungeon",
    mood: "torchlight",
    seed: "test",
    visual: {
      kind: "generated-scene",
      assetUrl: "/map-assets/map.jpg",
      pixelWidth: 2400,
      pixelHeight: 1600,
    },
    walls: [],
    portals: [],
    labels: [],
    notes: [],
    fog: {
      mode: "off",
      sharedPolygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }],
      walls: [],
      doors: [],
      circles: [],
    },
    source: { kind: "generated-scene" },
    createdAt: 1,
  };
}

function mapImageFor(map, id = map.id) {
  return {
    id,
    name: map.name,
    description: map.description,
    biome: map.biome,
    mood: map.mood,
    assetPath: map.visual.assetUrl,
    gridWidth: map.width,
    gridHeight: map.height,
    pixelWidth: map.visual.pixelWidth,
    pixelHeight: map.visual.pixelHeight,
    sourceKind: "generated",
    sourcePrompt: null,
    createdAt: map.createdAt,
    updatedAt: map.createdAt,
    active: true,
  };
}
