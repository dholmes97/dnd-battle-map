import assert from "node:assert/strict";
import test from "node:test";
import { deriveHistoryActionIds, isReversibleHistoryRow } from "../shared/action-history.mjs";

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

test("only durable drawings are reversible annotations", () => {
  const annotationTypes = new Set(["annotation_added", "annotation_removed"]);
  const row = (annotationType) => ({
    id: annotationType,
    action_type: "annotation_added",
    payload_json: JSON.stringify({ annotation: { annotationType } }),
  });

  assert.equal(isReversibleHistoryRow(row("drawing"), annotationTypes), true);
  assert.equal(isReversibleHistoryRow(row("ping"), annotationTypes), false);
  assert.equal(isReversibleHistoryRow(row("spotlight"), annotationTypes), false);
  assert.equal(isReversibleHistoryRow({ ...row("broken"), payload_json: "{" }, annotationTypes), false);
});
