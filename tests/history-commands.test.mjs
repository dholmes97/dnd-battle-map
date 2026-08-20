import assert from "node:assert/strict";
import test from "node:test";

import { redo, undo } from "../worker/commands/history-commands.ts";
import { createD1HistoryRepository } from "../worker/adapters/d1-history-repository.ts";

function context(rows, overrides = {}) {
  const calls = [];
  return {
    calls,
    encounter: {
      id: "encounter", code: "CODE", name: "Scenario", status: "active",
      mapAsset: "", mapPackageJson: null, activeMapPresetId: null,
      gridWidth: 24, gridHeight: 16, currentRound: 2,
      activeInitiativeOrder: 0, strictMovement: true, updatedAt: 0,
    },
    participant: { id: "player", name: "Dan", role: "player" },
    payload: {},
    now: 10,
    repository: {
      listParticipantActions: async () => rows,
      activeLeaderIds: async () => ["hero"],
      applyAction: async (value) => (calls.push(["apply", value]), { changes: 1, expectedChanges: 1 }),
      rebuildInitiativeOrders: async (...args) => calls.push(["rebuild", ...args]),
    },
    services: {
      createId: () => "id",
      loadState: async () => ({ marker: "state" }),
      bumpEncounter: async () => calls.push(["bump"]),
      recordAction: async (...args) => calls.push(["record", ...args]),
    },
    ...overrides,
  };
}

function action(id, actionType, payload) {
  return { id, action_type: actionType, payload_json: JSON.stringify(payload), created_at: Number(id) };
}

test("undo applies the newest reversible action and records the history marker", async () => {
  const value = context([
    action("2", "chat_message_sent", {}),
    action("1", "hp_changed", { tokenId: "hero", from: 10, to: 5 }),
  ]);
  const result = await undo(value);
  assert.equal(result.payload.undone, true);
  assert.equal(value.calls.find(([name]) => name === "apply")[1].direction, "undo");
  assert.deepEqual(value.calls.find(([name]) => name === "record").slice(1), [
    "action_undone",
    { actionId: "1", actionType: "hp_changed" },
  ]);
});

test("redo follows an undo marker and rejects shared-state conflicts", async () => {
  const rows = [
    action("3", "action_undone", { actionId: "1", actionType: "hp_changed" }),
    action("1", "hp_changed", { tokenId: "hero", from: 10, to: 5 }),
  ];
  const value = context(rows);
  assert.equal((await redo(value)).payload.redone, true);

  const conflict = context(rows, {
    repository: {
      listParticipantActions: async () => rows,
      activeLeaderIds: async () => [],
      applyAction: async () => ({ changes: 0, expectedChanges: 1 }),
      rebuildInitiativeOrders: async () => {},
    },
  });
  const denied = await redo(conflict);
  assert.equal(denied.status, 409);
  assert.match(denied.payload.error, /HP change/);
});

test("initiative history preserves the current active group during order rebuild", async () => {
  const value = context([
    action("1", "initiative_set", { tokenId: "hero", from: 12, fromGroupId: null, to: 18 }),
  ]);
  assert.equal((await undo(value)).payload.undone, true);
  assert.deepEqual(value.calls.find(([name]) => name === "rebuild").slice(1, 3), [
    "encounter",
    ["hero"],
  ]);
});

test("spell dismissal is reversible and restores zero-speed spell tokens", async () => {
  const row = action("1", "spell_effect_dismissed", {
    tokenId: "spell", token: {
      name: "Moonbeam", x: 4, y: 5, artAsset: "/moonbeam.png", kind: "spell-effect",
      size: "large", speed: 0, armorClass: null, hp: null, maxHp: null,
      hidden: false, summonerTokenId: "hero", initiative: 18, initiativeOrder: 0,
    },
  });
  const value = context([row]);
  assert.equal((await undo(value)).payload.undone, true);
  assert.equal(value.calls.find(([name]) => name === "apply")[1].actionType, "spell_effect_dismissed");

  const statements = [];
  const db = {
    prepare(sql) {
      return { bind(...bindings) { return { run: async () => (statements.push({ sql, bindings }), { meta: { changes: 1 } }) }; } };
    },
  };
  const repository = createD1HistoryRepository(db);
  const input = {
    encounterId: "encounter", participantId: "player", actionType: "spell_effect_dismissed",
    payload: JSON.parse(row.payload_json), gridWidth: 24, gridHeight: 16, now: 10,
  };
  assert.deepEqual(await repository.applyAction({ ...input, direction: "undo" }), { changes: 1, expectedChanges: 1 });
  assert.match(statements[0].sql, /INSERT OR IGNORE INTO tokens/);
  assert.equal(statements[0].bindings[8], 0);
  assert.deepEqual(await repository.applyAction({ ...input, direction: "redo" }), { changes: 1, expectedChanges: 1 });
  assert.match(statements[1].sql, /DELETE FROM tokens/);
});
