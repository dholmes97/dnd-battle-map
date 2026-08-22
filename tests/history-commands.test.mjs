import assert from "node:assert/strict";
import test from "node:test";

import { redo, undo } from "../worker/commands/history-commands.ts";

function context(rows, overrides = {}) {
  const calls = [];
  const hero = { id: "hero", summoner_token_id: null };
  const tokenRepository = {
    findToken: async (_encounterId, tokenId) => tokenId === "hero" ? hero : null,
    replayHistoryAction: async (input) => (calls.push(["token-replay", input]), 1),
  };
  const annotationRepository = {
    replayHistoryAction: async (input) => (calls.push(["annotation-replay", input]), 1),
  };
  const initiativeRepository = {
    activeLeaderIds: async () => ["hero"],
    replayHistoryAction: async (input) => (calls.push(["initiative-replay", input]),
      input.actionType === "initiative_group_set" ? input.payload.members.length : 1),
  };
  return {
    calls,
    encounter: {
      id: "encounter", code: "CODE", name: "Scenario", version: 4, status: "active",
      mapAsset: "", mapPackageJson: null, activeMapPresetId: null,
      gridWidth: 24, gridHeight: 16, currentRound: 2,
      activeInitiativeOrder: 0, strictMovement: true, updatedAt: 0,
    },
    participant: { id: "player", name: "Dan", role: "player" },
    payload: {},
    now: 10,
    repository: { listParticipantActions: async () => rows },
    tokenRepository,
    annotationRepository,
    initiativeRepository,
    canControl: async () => true,
    services: {
      createId: () => "id",
      loadState: async () => ({ marker: "state" }),
      commit: async (...args) => calls.push(["commit", ...args]),
      commitFor: async (...args) => calls.push(["commit-for", ...args]),
    },
    ...overrides,
  };
}

function action(id, actionType, payload) {
  return { id, action_type: actionType, payload_json: JSON.stringify(payload), created_at: Number(id) };
}

test("undo dispatches the newest reversible action through its feature repository", async () => {
  const value = context([
    action("2", "chat_message_sent", {}),
    action("1", "hp_changed", { tokenId: "hero", from: 10, to: 5 }),
  ]);
  const result = await undo(value);
  assert.equal(result.payload.undone, true);
  assert.equal(value.calls.find(([name]) => name === "token-replay")[1].direction, "undo");
  assert.deepEqual(value.calls.find(([name]) => name === "commit").slice(1), [
    "action_undone",
    { actionId: "1", actionType: "hp_changed" },
  ]);
});

test("redo follows an undo marker and rejects feature-level state conflicts", async () => {
  const rows = [
    action("3", "action_undone", { actionId: "1", actionType: "hp_changed" }),
    action("1", "hp_changed", { tokenId: "hero", from: 10, to: 5 }),
  ];
  assert.equal((await redo(context(rows))).payload.redone, true);

  const value = context(rows);
  value.tokenRepository = {
    ...value.tokenRepository,
    replayHistoryAction: async () => 0,
  };
  const denied = await redo(value);
  assert.equal(denied.status, 409);
  assert.match(denied.payload.error, /HP change/);
});

test("initiative replay receives the current active leaders and policy context", async () => {
  const value = context([
    action("1", "initiative_set", { tokenId: "hero", from: 12, fromGroupId: null, to: 18 }),
  ], { participant: { id: "dm", name: "Kevin", role: "dm" } });
  assert.equal((await undo(value)).payload.undone, true);
  const replay = value.calls.find(([name]) => name === "initiative-replay")[1];
  assert.deepEqual(replay.activeLeaderIds, ["hero"]);
});

test("spell dismissal and movement snapshots stay inside token feature replay", async () => {
  const spell = action("1", "spell_effect_dismissed", {
    tokenId: "spell",
    token: {
      name: "Moonbeam", x: 4, y: 5, artAsset: "/moonbeam.png", kind: "spell-effect",
      size: "large", speed: 0, armorClass: null, hp: null, maxHp: null,
      hidden: false, summonerTokenId: "hero", initiative: 18, initiativeOrder: 0,
    },
  });
  const spellValue = context([spell]);
  assert.equal((await undo(spellValue)).payload.undone, true);
  assert.equal(spellValue.calls.find(([name]) => name === "token-replay")[1].actionType, "spell_effect_dismissed");

  const move = action("2", "token_moved", {
    tokenId: "hero", from: { x: 1, y: 2 }, to: { x: 3, y: 4 },
    previousAltitude: 10, altitude: 25,
    previousMovementUsed: 5, movementUsed: 15,
    previousMovementOrigin: { x: 1, y: 2 }, movementOrigin: { x: 1, y: 2 },
  });
  const moveValue = context([move]);
  assert.equal((await undo(moveValue)).payload.undone, true);
  assert.equal(moveValue.calls.find(([name]) => name === "token-replay")[1].payload.previousAltitude, 10);
});

test("history replay rechecks current authorization", async () => {
  const value = context([
    action("1", "hp_changed", { tokenId: "hero", from: 10, to: 5 }),
  ], { canControl: async () => false });
  const denied = await undo(value);
  assert.equal(denied.status, 403);
  assert.equal(value.calls.length, 0);
});

test("cleared drawings replay as one DM history action with an exact expected count", async () => {
  const annotations = [
    { id: "a", annotationType: "drawing", createdBy: "dm", x: 1, y: 1, x2: 2, y2: 2 },
    { id: "b", annotationType: "drawing", createdBy: "dm", x: 2, y: 2, x2: 3, y2: 3 },
  ];
  const value = context([
    action("1", "annotations_cleared", { annotations }),
  ], { participant: { id: "dm", name: "Kevin", role: "dm" } });
  value.annotationRepository = {
    replayHistoryAction: async (input) => (value.calls.push(["annotation-replay", input]), 2),
  };
  assert.equal((await undo(value)).payload.undone, true);
  assert.equal(value.calls.find(([name]) => name === "annotation-replay")[1].actionType, "annotations_cleared");

  const conflict = context([
    action("1", "annotations_cleared", { annotations }),
  ], { participant: { id: "dm", name: "Kevin", role: "dm" } });
  const denied = await undo(conflict);
  assert.equal(denied.status, 409);
  assert.match(denied.payload.error, /cleared drawings/i);
});
