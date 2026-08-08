import assert from "node:assert/strict";
import test from "node:test";
import { deriveHistoryActionIds } from "../shared/action-history.mjs";

const reversible = new Set(["token_moved"]);
const action = (id) => ({ id, action_type: "token_moved", payload_json: "{}" });
const history = (id, actionType, actionId) => ({ id, action_type: actionType, payload_json: JSON.stringify({ actionId }) });

test("builds independent undo and redo stacks in normal editor order", () => {
  const rows = [
    action("a"), action("b"), action("c"),
    history("u-c", "action_undone", "c"),
    history("u-b", "action_undone", "b"),
  ];
  assert.deepEqual(deriveHistoryActionIds(rows, reversible), {
    undoIds: ["a"],
    redoIds: ["b", "c"],
  });
});

test("redo restores undo order and a new action clears remaining redo", () => {
  const redone = [
    action("a"), action("b"), action("c"),
    history("u-c", "action_undone", "c"),
    history("u-b", "action_undone", "b"),
    history("r-b", "action_redone", "b"),
  ];
  assert.deepEqual(deriveHistoryActionIds(redone, reversible), {
    undoIds: ["b", "a"],
    redoIds: ["c"],
  });
  assert.deepEqual(deriveHistoryActionIds([...redone, action("d")], reversible), {
    undoIds: ["d", "b", "a"],
    redoIds: [],
  });
});
