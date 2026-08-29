"use client";

import { useCallback, useMemo, useState } from "react";
import type { EncounterState, ParticipantSession } from "@/shared/contracts";

export function useDamageReviewQueue({ participant, state }: {
  participant: ParticipantSession | null;
  state: EncounterState | null;
}) {
  const [deferredProposalIds, setDeferredProposalIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingProposals = useMemo(() => participant?.role === "dm"
    ? [...(state?.damageProposals ?? [])]
      .filter((proposal) => proposal.status === "pending")
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    : [], [participant?.role, state?.damageProposals]);
  const activeProposal = pendingProposals.find((proposal) => !deferredProposalIds.has(proposal.id)) ?? null;

  const deferActive = useCallback(() => {
    if (!activeProposal) return;
    setDeferredProposalIds((current) => new Set(current).add(activeProposal.id));
  }, [activeProposal]);

  const reopen = useCallback(() => setDeferredProposalIds(new Set()), []);

  return {
    activeProposal,
    pendingCount: pendingProposals.length,
    deferActive,
    reopen,
  };
}
