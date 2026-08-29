import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDamageNotifications } from "@/app/use-damage-notifications";
import type { EncounterState, ParticipantSession, SharedDamageProposal, SharedToken } from "@/shared/contracts";

const participant = { id: "participant-player", name: "QA Player", role: "player", sessionSecret: "secret" } satisfies ParticipantSession;

function token(hp: number, temporaryHp: number): SharedToken {
  return {
    id: "target", name: "QA Champion", hp, maxHp: 30, temporaryHp, controlledByViewer: true,
  } as SharedToken;
}

function proposal(status: SharedDamageProposal["status"], finalDamage: number | null, resolvedAt: number | null): SharedDamageProposal {
  return {
    id: "proposal-1", rollId: "roll-1", targetTokenId: "target", status, rolledDamage: 5,
    finalDamage, adjudicationMethod: status === "pending" ? null : "apply", adjudicationNote: null,
    concentrationCheckRequired: status !== "pending",
    createdAt: 100, resolvedAt,
  };
}

function encounterState(target: SharedToken, damageProposal: SharedDamageProposal): EncounterState {
  return {
    encounter: { code: "COMBAT-ROLLING-QA" },
    tokens: [target],
    combatRolls: [{
      id: "roll-1", attackerName: "QA Goblin Raider", action: { name: "Scimitar", damageType: "slashing" },
    }],
    damageProposals: [damageProposal],
  } as EncounterState;
}

describe("useDamageNotifications", () => {
  it("notifies a targeted player when newly resolved damage consumes temporary HP", async () => {
    const pending = encounterState(token(30, 5), proposal("pending", null, null));
    const resolved = encounterState(token(30, 0), proposal("applied", 5, 200));
    const { result, rerender } = renderHook(({ state }) => useDamageNotifications({ participant, state }), {
      initialProps: { state: pending },
    });

    expect(result.current.notification).toBeNull();
    rerender({ state: resolved });

    await waitFor(() => expect(result.current.notification).toMatchObject({
        attackerName: "QA Goblin Raider",
        finalDamage: 5,
        hpBefore: 30,
        hpAfter: 30,
        temporaryHpBefore: 5,
        temporaryHpAfter: 0,
        concentrationCheckRequired: true,
      }));
    act(() => result.current.dismiss());
    expect(result.current.notification).toBeNull();
  });

  it("does not replay resolved history when the player opens the encounter", () => {
    const resolved = encounterState(token(25, 0), proposal("applied", 5, 200));
    const { result } = renderHook(() => useDamageNotifications({ participant, state: resolved }));
    expect(result.current.notification).toBeNull();
  });

  it("queues multiple newly resolved hits without losing either update", async () => {
    const secondPending = { ...proposal("pending", null, null), id: "proposal-2", rollId: "roll-2", targetTokenId: "target-2", createdAt: 101 };
    const secondResolved = { ...secondPending, status: "applied" as const, finalDamage: 4, adjudicationMethod: "apply" as const, resolvedAt: 201 };
    const pending = encounterState(token(30, 0), proposal("pending", null, null));
    pending.tokens.push({ ...token(20, 0), id: "target-2", name: "Wolf Companion", maxHp: 20 });
    pending.combatRolls.push({ ...pending.combatRolls[0], id: "roll-2", attackerName: "QA Skeleton Archer" });
    pending.damageProposals.push(secondPending);
    const resolved = encounterState(token(25, 0), proposal("applied", 5, 200));
    resolved.tokens.push({ ...token(16, 0), id: "target-2", name: "Wolf Companion", maxHp: 20 });
    resolved.combatRolls.push({ ...resolved.combatRolls[0], id: "roll-2", attackerName: "QA Skeleton Archer" });
    resolved.damageProposals.push(secondResolved);
    const { result, rerender } = renderHook(({ state }) => useDamageNotifications({ participant, state }), {
      initialProps: { state: pending },
    });

    rerender({ state: resolved });
    await waitFor(() => expect(result.current.remainingCount).toBe(1));
    expect(result.current.notification?.attackerName).toBe("QA Goblin Raider");
    act(() => result.current.dismiss());
    expect(result.current.notification?.attackerName).toBe("QA Skeleton Archer");
  });

  it("does not notify the DM for damage applied to DM-controlled targets", () => {
    const dm = { ...participant, role: "dm" as const };
    const pending = encounterState(token(30, 5), proposal("pending", null, null));
    const resolved = encounterState(token(30, 0), proposal("applied", 5, 200));
    const { result, rerender } = renderHook(({ state }) => useDamageNotifications({ participant: dm, state }), {
      initialProps: { state: pending },
    });
    rerender({ state: resolved });
    expect(result.current.notification).toBeNull();
  });
});
