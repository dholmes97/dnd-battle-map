import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDamageReviewQueue } from "@/app/use-damage-review-queue";
import type { EncounterState, ParticipantSession, SharedCombatRoll, SharedDamageProposal } from "@/shared/contracts";

function proposal(id: string, createdAt: number): SharedDamageProposal {
  return { id, rollId: `roll-${id}`, targetTokenId: "target", status: "pending", rolledDamage: 5, finalDamage: null, adjudicationMethod: null, adjudicationNote: null, concentrationCheckRequired: false, createdAt, resolvedAt: null };
}

describe("useDamageReviewQueue", () => {
  it("reviews oldest first, permits deferral, and reopens the queue", () => {
    const participant = { id: "dm", name: "Kevin", role: "dm", sessionSecret: "secret" } as ParticipantSession;
    const state = { damageProposals: [proposal("newer", 20), proposal("older", 10)] } as EncounterState;
    const { result } = renderHook(() => useDamageReviewQueue({ participant, state }));

    expect(result.current.activeProposal?.id).toBe("older");
    expect(result.current.visibleProposals.map((item) => item.id)).toEqual(["older", "newer"]);
    expect(result.current.pendingCount).toBe(2);
    act(() => result.current.deferProposal("older"));
    expect(result.current.activeProposal?.id).toBe("newer");
    expect(result.current.visibleProposals.map((item) => item.id)).toEqual(["newer"]);
    act(() => result.current.deferActive());
    expect(result.current.activeProposal).toBeNull();
    expect(result.current.pendingCount).toBe(2);
    act(() => result.current.reopen());
    expect(result.current.activeProposal?.id).toBe("older");
  });

  it("does not expose DM proposals to a player review queue", () => {
    const participant = { id: "player", name: "Dan", role: "player", sessionSecret: "secret" } as ParticipantSession;
    const state = { damageProposals: [proposal("one", 1)] } as EncounterState;
    const { result } = renderHook(() => useDamageReviewQueue({ participant, state }));
    expect(result.current.activeProposal).toBeNull();
    expect(result.current.pendingCount).toBe(0);
  });

  it("keeps a private DM damage roll in its attack card instead of duplicating it in the review queue", () => {
    const participant = { id: "dm", name: "Kevin", role: "dm", sessionSecret: "secret" } as ParticipantSession;
    const pending = proposal("private", 1);
    const state = {
      damageProposals: [pending],
      combatRolls: [{ id: pending.rollId, rollPrivacy: "dm-private" } as SharedCombatRoll],
    } as EncounterState;
    const { result } = renderHook(() => useDamageReviewQueue({ participant, state }));

    expect(result.current.activeProposal).toBeNull();
    expect(result.current.pendingCount).toBe(0);
  });
});
