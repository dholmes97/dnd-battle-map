import type { CreatureSize } from "./creature-library.ts";
import { tokenRadiusCells } from "./creature-library.ts";
import type { EncounterStatus, MapPoint } from "./contracts.ts";
import { calculateDirectDistance, clampMapPoint } from "./battle-map-geometry.ts";
import { healthBand, type HealthBand } from "./health.ts";

export type TokenMoveTransitionInput = {
  previous: MapPoint;
  destination: MapPoint;
  previousMovementOrigin: MapPoint | null;
  previousMovementUsed: number;
  size: CreatureSize;
  grid: { width: number; height: number; feetPerCell: number };
  speed: number;
  encounterStatus: EncounterStatus;
  isSpellEffect: boolean;
};

export type TokenMoveTransition = {
  position: MapPoint;
  movementOrigin: MapPoint | null;
  movementUsed: number;
  distance: number;
  overBudget: boolean;
};

export function transitionTokenMove(input: TokenMoveTransitionInput): TokenMoveTransition {
  const position = clampMapPoint(input.grid, input.destination, tokenRadiusCells(input.size));
  if (input.isSpellEffect) {
    return { position, movementOrigin: null, movementUsed: 0, distance: 0, overBudget: false };
  }
  const movementOrigin = input.encounterStatus === "active"
    ? input.previousMovementOrigin ?? input.previous
    : input.previousMovementOrigin;
  const distance = calculateDirectDistance(
    movementOrigin ?? input.previous,
    position,
    input.grid.feetPerCell,
  );
  const movementUsed = input.encounterStatus === "active" ? distance : input.previousMovementUsed;
  return {
    position,
    movementOrigin,
    movementUsed,
    distance,
    overBudget: input.encounterStatus === "active" && distance > input.speed + 0.05,
  };
}

export type HpTransition = {
  from: number;
  hp: number;
  healthState: HealthBand;
};

export function transitionHp(currentHp: number | null, maxHp: number, delta: number): HpTransition {
  const from = currentHp ?? maxHp;
  const hp = Math.min(maxHp, Math.max(0, from + Math.trunc(delta)));
  return { from, hp, healthState: healthBand(hp, maxHp)! };
}

export type CombatStatusTransitionInput = {
  from: EncounterStatus;
  to: EncounterStatus;
  currentRound: number;
  activeInitiativeOrder: number | null;
};

export function combatStatusTransitionError(input: CombatStatusTransitionInput): string | null {
  if (input.from === input.to) return null;
  if (input.to === "setup") return null;
  if (input.from === "setup") {
    return "Combat must be started before it can be paused or resumed.";
  }
  if (input.from === "active" && input.to === "paused") return null;
  if (input.from === "paused" && input.to === "active") {
    return input.currentRound >= 1 && input.activeInitiativeOrder !== null
      ? null
      : "Paused combat cannot resume without an initialized round and active turn.";
  }
  return `Combat cannot transition from ${input.from} to ${input.to}.`;
}
