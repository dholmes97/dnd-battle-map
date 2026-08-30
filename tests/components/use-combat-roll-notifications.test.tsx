import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCombatRollNotifications } from "@/app/use-combat-roll-notifications";
import type { EncounterState, ParticipantSession, SharedCombatRoll, SharedDamageProposal } from "@/shared/contracts";

const participant: ParticipantSession = {
  id: "qa-player-1",
  name: "QA Player 1",
  role: "player",
  sessionSecret: "secret",
};

function roll(id: string, createdAt: number, attackerName = "QA Scout", overrides: Partial<SharedCombatRoll> = {}): SharedCombatRoll {
  return {
    id,
    attackerTokenId: `attacker-${id}`,
    attackerName,
    targetTokenId: `target-${id}`,
    targetName: "QA Goblin Raider",
    participantName: "QA Player 2",
    action: {
      name: "Shortsword",
      attackBonus: 5,
      attackKind: "melee",
      damage: { count: 1, sides: 6, modifier: 3 },
      damageType: "piercing",
      reachFeet: 5,
      rangeFeet: null,
      manualRider: false,
      manualRiderText: null,
      alternateDamage: null,
    },
    actionSource: "character",
    rollMode: "normal",
    attackDice: [14],
    keptD20: 14,
    blessDie: null,
    attackTotal: 19,
    outcome: "hit",
    calculatedOutcome: null,
    releasedOutcome: "hit",
    rollPrivacy: "public",
    damageDice: [4],
    damageTotal: 7,
    damageRolledAt: createdAt + 1,
    canRollDamage: false,
    canReleaseOutcome: false,
    inTurn: true,
    createdAt,
    ...overrides,
  };
}

function proposal(combatRoll: SharedCombatRoll): SharedDamageProposal {
  return {
    id: `proposal-${combatRoll.id}`,
    rollId: combatRoll.id,
    targetTokenId: combatRoll.targetTokenId,
    status: "pending",
    rolledDamage: combatRoll.damageTotal,
    finalDamage: null,
    adjudicationMethod: null,
    adjudicationNote: null,
    concentrationCheckRequired: false,
    createdAt: combatRoll.createdAt,
    resolvedAt: null,
  };
}

function state(combatRolls: SharedCombatRoll[]): EncounterState {
  return {
    encounter: { code: "INTERACTION-QA" },
    combatRolls,
    damageProposals: combatRolls.filter((combatRoll) => combatRoll.damageRolledAt !== null).map(proposal),
  } as EncounterState;
}

describe("useCombatRollNotifications", () => {
  it("does not replay history, then queues a new roll made by another player", async () => {
    const historicalRoll = roll("historical", 10);
    const sharedRoll = roll("shared", 20);
    const { result, rerender } = renderHook(({ encounterState }) => useCombatRollNotifications({
      participant,
      state: encounterState,
    }), { initialProps: { encounterState: state([historicalRoll]) } });

    expect(result.current.notifications).toEqual([]);
    rerender({ encounterState: state([sharedRoll, historicalRoll]) });

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    expect(result.current.notifications[0]).toMatchObject({
      roll: { id: "shared", attackerName: "QA Scout" },
      proposalId: "proposal-shared",
    });
  });

  it("deduplicates the initiating player's immediate card against the shared state update", async () => {
    const sharedRoll = roll("local", 20);
    const initialState = state([]);
    const updatedState = state([sharedRoll]);
    const { result, rerender } = renderHook(({ encounterState }) => useCombatRollNotifications({
      participant,
      state: encounterState,
    }), { initialProps: { encounterState: initialState } });

    act(() => result.current.enqueue({ roll: sharedRoll, proposalId: "proposal-local" }));
    rerender({ encounterState: updatedState });

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    act(() => result.current.dismiss("local"));
    expect(result.current.notifications).toEqual([]);
  });

  it("reopens a dismissed shared hit when its damage is rolled", async () => {
    const pendingRoll = roll("two-stage", 20, "QA Scout", {
      damageDice: [], damageTotal: null, damageRolledAt: null, canRollDamage: false,
    });
    const damagedRoll = { ...pendingRoll, damageDice: [6], damageTotal: 9, damageRolledAt: 30 };
    const { result, rerender } = renderHook(({ encounterState }) => useCombatRollNotifications({
      participant,
      state: encounterState,
    }), { initialProps: { encounterState: state([]) } });

    rerender({ encounterState: state([pendingRoll]) });
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    act(() => result.current.dismiss("two-stage"));
    expect(result.current.notifications).toEqual([]);

    rerender({ encounterState: state([damagedRoll]) });
    await waitFor(() => expect(result.current.notifications[0]?.roll.damageTotal).toBe(9));
  });
});
