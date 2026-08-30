"use client";

import { useCallback, useMemo, useState } from "react";
import type { EncounterState, ParticipantSession } from "@/shared/contracts";

export function useDamageReviewQueue({ participant, state, representedRollIds = [] }: {
  participant: ParticipantSession | null;
  state: EncounterState | null;
  representedRollIds?: readonly string[];
}) {
  const [deferredProposalIds, setDeferredProposalIds] = useState<ReadonlySet<string>>(() => new Set());
  const representedRollIdSet = useMemo(() => new Set(representedRollIds), [representedRollIds]);
  const pendingProposals = useMemo(() => participant?.role === "dm"
    ? [...(state?.damageProposals ?? [])]
      .filter((proposal) => proposal.status === "pending" &&
        (state?.combatRolls ?? []).find((roll) => roll.id === proposal.rollId)?.rollPrivacy !== "dm-private" &&
        !representedRollIdSet.has(proposal.rollId))
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    : [], [participant?.role, representedRollIdSet, state?.combatRolls, state?.damageProposals]);
  const visibleProposals = pendingProposals.filter((proposal) => !deferredProposalIds.has(proposal.id));
  const activeProposal = visibleProposals[0] ?? null;

  const deferProposal = useCallback((proposalId: string) => {
    setDeferredProposalIds((current) => new Set(current).add(proposalId));
  }, []);

  const deferActive = useCallback(() => {
    if (!activeProposal) return;
    deferProposal(activeProposal.id);
  }, [activeProposal, deferProposal]);

  const reopen = useCallback(() => setDeferredProposalIds(new Set()), []);

  return {
    activeProposal,
    visibleProposals,
    pendingCount: pendingProposals.length,
    deferProposal,
    deferActive,
    reopen,
  };
}
