import assert from "node:assert/strict";
import test from "node:test";
import {
  historyConflictMessage,
  mapPackageForViewer,
  scenarioCodeFromName,
} from "../shared/encounter-domain.mjs";

test("scenario codes normalize accents, punctuation, length, and blanks", () => {
  assert.equal(scenarioCodeFromName("  Château of Doom!  "), "CHATEAU-OF-DOOM");
  assert.equal(scenarioCodeFromName("---"), "NEW-SCENARIO");
  assert.equal(scenarioCodeFromName("a very long scenario name beyond the limit").length, 20);
});

test("viewer projection removes DM-only map information without mutating the map", () => {
  const map = {
    id: "map",
    labels: [{ id: "public", visibility: "everyone" }, { id: "secret", visibility: "dm" }],
    notes: [{ id: "trap" }],
  };
  assert.equal(mapPackageForViewer(map, { role: "dm" }), map);
  const playerMap = mapPackageForViewer(map, { role: "player" });
  assert.deepEqual(playerMap.labels.map(({ id }) => id), ["public"]);
  assert.deepEqual(playerMap.notes, []);
  assert.equal(map.labels.length, 2);
  assert.equal(map.notes.length, 1);
});

test("history conflicts identify the affected domain action", () => {
  assert.equal(historyConflictMessage("undone", "token_moved"), "This move cannot be undone because the token moved again.");
  assert.equal(historyConflictMessage("redone", "hp_changed"), "This HP change cannot be redone because the token's HP changed again.");
  assert.equal(historyConflictMessage("undone", "unknown"), "This action cannot be undone because its shared state changed.");
});
