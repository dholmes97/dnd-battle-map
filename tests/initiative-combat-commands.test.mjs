import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceTurn,
  setInitiative,
  setInitiativeGroup,
  startCombat,
} from "../worker/commands/initiative-combat-commands.ts";

function token(id, initiative, extras = {}) {
  return {
    id,
    name: id,
    initiative,
    initiative_group_id: null,
    summoner_token_id: null,
    initiative_order: null,
    ...extras,
  };
}

function context(overrides = {}) {
  const { repository: repoOverrides = {}, ...rest } = overrides;
  const calls = [];
  const tokens = [token("hero", 18), token("goblin", 12)];
  const repository = {
    findToken: async (_encounterId, id) => tokens.find((entry) => entry.id === id) ?? null,
    activeLeaderIds: async () => ["hero"],
    listInitiativeTokens: async () => tokens,
    setInitiative: async (...args) => calls.push(["set", ...args]),
    setInitiativeGroup: async (...args) => calls.push(["group", ...args]),
    rebuildOrders: async (...args) => calls.push(["rebuild", ...args]),
    startCombat: async (...args) => calls.push(["start", ...args]),
    completeOrder: async (...args) => calls.push(["complete", ...args]),
    listOrders: async () => [0, 1],
    exitCombat: async (...args) => calls.push(["exit", ...args]),
    enterTurn: async (...args) => calls.push(["enter", ...args]),
    orderExists: async () => true,
    correctTurn: async (...args) => calls.push(["correct", ...args]),
    ...repoOverrides,
  };
  return {
    calls,
    repository,
    encounter: {
      id: "encounter",
      code: "CODE",
      name: "Scenario",
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
      updatedAt: 0,
    },
    participant: { id: "dm", name: "Kevin", role: "dm" },
    payload: {},
    now: 10,
    canControl: async () => true,
    services: {
      createId: () => "group-id",
      loadState: async () => ({ marker: "state" }),
      commit: async (...args) => calls.push(["commit", ...args]),
      commitFor: async (...args) => calls.push(["commit-for", ...args]),
    },
    ...rest,
  };
}

test("initiative changes validate authority and preserve the active group", async () => {
  const denied = context({
    participant: { id: "player", name: "Dan", role: "player" },
    payload: { tokenId: "hero", initiative: 20 },
    canControl: async () => false,
  });
  assert.equal((await setInitiative(denied)).status, 403);

  const active = context({
    encounter: { ...context().encounter, status: "active", activeInitiativeOrder: 0 },
    payload: { tokenId: "hero", initiative: 20 },
  });
  assert.equal((await setInitiative(active)).payload.updated, true);
  assert.deepEqual(active.calls.find(([name]) => name === "rebuild")[2], [["hero"], ["goblin"]]);
  assert.equal(active.calls.find(([name]) => name === "rebuild")[3], 0);
});

test("shared initiative groups reject summons and write one durable group", async () => {
  const invalid = context({
    payload: { tokenIds: ["hero", "summon"], initiative: 15 },
    repository: {
      listInitiativeTokens: async () => [token("hero", 18), token("summon", 18, { summoner_token_id: "hero" })],
    },
  });
  assert.equal((await setInitiativeGroup(invalid)).status, 400);

  const valid = context({ payload: { tokenIds: ["hero", "goblin"], initiative: 15 } });
  assert.equal((await setInitiativeGroup(valid)).payload.groupId, "group-id");
  assert.deepEqual(valid.calls.find(([name]) => name === "group").slice(2, 5), [
    ["hero", "goblin"],
    15,
    "group-id",
  ]);
});

test("combat start and turn advance use deterministic ordered groups", async () => {
  const start = context();
  assert.equal((await startCombat(start)).payload.started, true);
  assert.deepEqual(start.calls.find(([name]) => name === "start")[2], [["hero"], ["goblin"]]);

  const advance = context({
    encounter: { ...context().encounter, status: "active", currentRound: 2, activeInitiativeOrder: 1 },
    payload: { tokenId: "hero" },
    repository: {
      findToken: async () => token("hero", 18, { initiative_order: 1 }),
    },
  });
  const outcome = await advanceTurn(advance, false);
  assert.deepEqual(
    { round: outcome.payload.round, activeOrder: outcome.payload.activeOrder },
    { round: 3, activeOrder: 0 },
  );
  assert.deepEqual(advance.calls.find(([name]) => name === "enter").slice(2, 4), [3, 0]);
});
