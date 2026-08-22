import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  combatStatusTransitionError,
  transitionHp,
  transitionTokenMove,
} from "../shared/encounter-transitions.ts";

const baseMove = {
  previous: { x: 2, y: 2 }, destination: { x: 5, y: 4 },
  previousMovementOrigin: null, previousMovementUsed: 0, size: "medium",
  grid: { width: 24, height: 16, feetPerCell: 5 }, speed: 30,
  encounterStatus: "active", isSpellEffect: false,
};

test("movement transition replaces distance from one durable turn origin", () => {
  const first = transitionTokenMove(baseMove);
  assert.deepEqual(first, {
    position: { x: 5, y: 4 }, movementOrigin: { x: 2, y: 2 },
    movementUsed: 15, distance: 15, overBudget: false,
  });
  const revised = transitionTokenMove({
    ...baseMove, previous: first.position, destination: { x: 9, y: 2 },
    previousMovementOrigin: first.movementOrigin, previousMovementUsed: first.movementUsed,
  });
  assert.equal(revised.movementUsed, 35);
  assert.equal(revised.distance, 35);
  assert.equal(revised.overBudget, true);
  assert.deepEqual(revised.movementOrigin, { x: 2, y: 2 });
});

test("movement transition preserves setup tracking and isolates spell motion", () => {
  const setup = transitionTokenMove({ ...baseMove, encounterStatus: "setup", previousMovementUsed: 12 });
  assert.equal(setup.movementUsed, 12);
  assert.equal(setup.movementOrigin, null);
  const spell = transitionTokenMove({ ...baseMove, size: "large", isSpellEffect: true, destination: { x: 99, y: -4 } });
  assert.deepEqual(spell.position, { x: 23.14, y: 0.86 });
  assert.equal(spell.distance, 0);
  assert.equal(spell.movementUsed, 0);
  assert.equal(spell.movementOrigin, null);
});

test("HP transition clamps damage and healing and derives the visible band", () => {
  assert.deepEqual(transitionHp(10, 20, -99), { from: 10, hp: 0, healthState: "down" });
  assert.deepEqual(transitionHp(null, 20, -5), { from: 20, hp: 15, healthState: "injured" });
  assert.deepEqual(transitionHp(18, 20, 99), { from: 18, hp: 20, healthState: "unharmed" });
});

test("combat status transitions reject setup pause/resume and require initialized resume state", () => {
  assert.match(combatStatusTransitionError({
    from: "setup", to: "paused", currentRound: 0, activeInitiativeOrder: null,
  }), /must be started/);
  assert.match(combatStatusTransitionError({
    from: "setup", to: "active", currentRound: 0, activeInitiativeOrder: null,
  }), /must be started/);
  assert.equal(combatStatusTransitionError({
    from: "active", to: "paused", currentRound: 2, activeInitiativeOrder: 1,
  }), null);
  assert.match(combatStatusTransitionError({
    from: "paused", to: "active", currentRound: 0, activeInitiativeOrder: null,
  }), /initialized/);
  assert.equal(combatStatusTransitionError({
    from: "paused", to: "active", currentRound: 2, activeInitiativeOrder: 1,
  }), null);
  assert.equal(combatStatusTransitionError({
    from: "active", to: "setup", currentRound: 2, activeInitiativeOrder: 1,
  }), null);
});

test("both adapters invoke the same movement and HP transitions", async () => {
  const [encounterSync, tokenControls, worker, tokenCommands] = await Promise.all([
    readFile(new URL("../app/use-encounter-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/use-token-controls.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/commands/token-effect-commands.ts", import.meta.url), "utf8"),
  ]);
  const client = `${encounterSync}\n${tokenControls}`;
  assert.match(client, /transitionTokenMove\(/);
  assert.match(worker, /transitionTokenMove\(/);
  assert.match(client, /transitionHp\(/);
  assert.match(tokenCommands, /transitionHp\(/);
});
