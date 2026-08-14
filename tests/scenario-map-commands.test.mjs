import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMapPackage,
  createScenario,
  renameScenario,
  saveMapPreset,
} from "../worker/commands/scenario-map-commands.ts";

function context(overrides = {}) {
  const { repository: repositoryOverrides = {}, ...contextOverrides } = overrides;
  const calls = [];
  let id = 0;
  const repository = {
    renameScenario: async (...args) => calls.push(["rename", ...args]),
    scenarioCodeExists: async () => false,
    listScenarioTokens: async () => [],
    createScenario: async (value) => calls.push(["create", value]),
    saveMapPreset: async (value, update) => (calls.push(["save", value, update]), true),
    deleteMapPreset: async () => true,
    clearActivePreset: async () => {},
    loadMapPreset: async () => null,
    listTokenPositions: async () => [],
    applyMapPackage: async (value) => calls.push(["apply", value]),
    configureEncounter: async () => {},
    ...repositoryOverrides,
  };
  return {
    calls,
    repository,
    encounter: {
      id: "encounter-1",
      code: "OLD-CODE",
      name: "Old name",
      status: "setup",
      mapAsset: "map.jpg",
      mapPackageJson: null,
      activeMapPresetId: null,
      gridWidth: 24,
      gridHeight: 16,
      currentRound: 0,
      activeInitiativeOrder: null,
      strictMovement: true,
      updatedAt: 1,
    },
    participant: { id: "dm-1", name: "Kevin", role: "dm" },
    payload: {},
    now: 100,
    loadScenarioState: async (code, participantId) => ({ code, participantId }),
    recordScenarioAction: async (...args) => calls.push(["record-new", ...args]),
    services: {
      createId: () => `id-${++id}`,
      loadState: async () => ({ marker: "current" }),
      bumpEncounter: async () => calls.push(["bump"]),
      recordAction: async (...args) => calls.push(["record", ...args]),
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
    hp: 20,
    max_hp: 42,
    is_hidden: 1,
    summoner_token_id: null,
    initiative: 18,
    initiative_group_id: "old-group",
    initiative_order: 0,
    turn_complete: 1,
    movement_used: 10,
    owner_participant_id: null,
    owner_name: null,
  };
  const value = context({
    payload: { name: "Fresh Adventure", mode: "party" },
    repository: { listScenarioTokens: async () => [source] },
  });
  const result = await createScenario(value);
  const write = value.calls.find(([name]) => name === "create")[1];
  assert.equal(write.mapPackageJson, null);
  assert.equal(write.tokens[0].copiedHp, 42);
  assert.equal(write.tokens[0].copiedHidden, false);
  const recorded = value.calls.find(([name]) => name === "record-new");
  assert.equal(recorded[1], write.id);
  assert.equal(result.payload.state.code, "FRESH-ADVENTURE");
});

test("map presets and map application stay behind a fakeable repository", async () => {
  const map = {
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
  const saved = context({ payload: { mapPackage: map, name: "Preset" } });
  assert.equal((await saveMapPreset(saved)).payload.saved, true);
  assert.equal(saved.calls.find(([name]) => name === "save")[1].name, "Preset");

  const applied = context({
    payload: { mapPackage: map },
    repository: {
      listTokenPositions: async () => [{ id: "token", x: -10, y: 99, size: "large" }],
    },
  });
  assert.equal((await applyMapPackage(applied)).payload.applied, true);
  assert.deepEqual(
    applied.calls.find(([name]) => name === "apply")[1].tokenPositions[0],
    { id: "token", x: 0.86, y: 15.14 },
  );
});
