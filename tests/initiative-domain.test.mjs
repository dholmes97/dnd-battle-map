import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceEncounterTurn,
  buildRosterRows,
  initiativePackMembers,
  nextInitiativeTurn,
  orderedInitiativeGroups,
} from "../shared/initiative-domain.mjs";

function token(id, name, extra = {}) {
  return {
    id,
    name,
    artAsset: extra.artAsset ?? "/goblin.png",
    kind: extra.kind ?? "monster",
    summonerTokenId: extra.summonerTokenId ?? null,
    controlledByViewer: extra.controlledByViewer ?? false,
    initiative: extra.initiative ?? null,
    initiativeGroupId: extra.initiativeGroupId ?? null,
    initiativeOrder: extra.initiativeOrder ?? null,
    turnComplete: extra.turnComplete ?? false,
    movementUsed: extra.movementUsed ?? 0,
    movementOrigin: extra.movementOrigin ?? null,
  };
}

test("matching numbered monsters form a placement and roster pack", () => {
  const tokens = [token("g1", "Goblin 1"), token("g2", "Goblin 2"), token("g3", "Goblin 10")];
  assert.deepEqual(initiativePackMembers(tokens[0], tokens).map(({ id }) => id), ["g1", "g2", "g3"]);
  const rows = buildRosterRows(tokens, false, "", new Set());
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { type: "group", key: "Goblin|/goblin.png", label: "Goblin", tokens, expanded: false });
});

test("combat roster follows initiative slots and keeps summons with their character", () => {
  const dar = token("dar", "Dar'eleth", { kind: "character", initiativeOrder: 1 });
  const summon = token("wolf", "Dar's Wolf", { kind: "summon", summonerTokenId: "dar", initiativeOrder: 1 });
  const goblin = token("g1", "Goblin 1", { initiativeOrder: 0 });
  const rows = buildRosterRows([dar, summon, goblin], true, "", new Set());
  assert.equal(rows[0].type, "token");
  assert.equal(rows[0].token.id, "g1");
  assert.equal(rows[1].type, "group");
  assert.equal(rows[1].label, "Dar'eleth’s group");
});

test("initiative groups sort once by group leader initiative", () => {
  const groups = orderedInitiativeGroups([
    token("a", "A", { initiative: 12, initiativeGroupId: "pack" }),
    token("b", "B", { initiative: 12, initiativeGroupId: "pack" }),
    token("c", "C", { initiative: 18 }),
    token("summon", "Summon", { initiative: 30, summonerTokenId: "c" }),
  ]);
  assert.deepEqual(groups.map((group) => group.map(({ id }) => id)), [["c"], ["a", "b"]]);
});

test("turn transition wraps rounds and resets only the entering slot", () => {
  assert.deepEqual(nextInitiativeTurn([0, 1, 1, null], 1, 3), { round: 4, activeOrder: 0, wrapped: true });
  const current = {
    encounter: { activeInitiativeOrder: 1, currentRound: 3 },
    tokens: [
      token("next", "Next", { initiativeOrder: 0, turnComplete: true, movementUsed: 25, movementOrigin: { x: 1, y: 1 } }),
      token("current", "Current", { initiativeOrder: 1, movementUsed: 10, movementOrigin: { x: 2, y: 2 } }),
    ],
  };
  const advanced = advanceEncounterTurn(current, true);
  assert.deepEqual(advanced.encounter, { activeInitiativeOrder: 0, currentRound: 4 });
  assert.deepEqual(advanced.tokens[0], { ...current.tokens[0], turnComplete: false, movementUsed: 0, movementOrigin: null });
  assert.equal(advanced.tokens[1].turnComplete, true);
  assert.equal(advanced.tokens[1].movementUsed, 10);
});
