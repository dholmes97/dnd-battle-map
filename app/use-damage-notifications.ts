"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { transitionDamageWithTemporaryHp } from "@/shared/combat-rolling";
import type { EncounterState, ParticipantSession, SharedToken } from "@/shared/contracts";

export type DamageNotification = {
  id: string;
  targetTokenId: string;
  targetName: string;
  attackerName: string;
  actionName: string;
  damageType: string;
  finalDamage: number;
  hpBefore: number | null;
  hpAfter: number | null;
  maxHp: number | null;
  temporaryHpBefore: number | null;
  temporaryHpAfter: number | null;
  concentrationCheckRequired: boolean;
};

function tokenSnapshot(tokens: SharedToken[]) {
  return new Map(tokens.map((token) => [token.id, token]));
}

function resolvedProposal(proposal: EncounterState["damageProposals"][number]) {
  return proposal.status !== "pending" && proposal.resolvedAt !== null;
}

export function useDamageNotifications({ participant, state }: {
  participant: ParticipantSession | null;
  state: EncounterState | null;
}) {
  const [queue, setQueue] = useState<DamageNotification[]>([]);
  const sessionKeyRef = useRef("");
  const seenProposalIdsRef = useRef(new Set<string>());
  const previousTokensRef = useRef(new Map<string, SharedToken>());

  useEffect(() => {
    if (!participant || !state) {
      sessionKeyRef.current = "";
      seenProposalIdsRef.current = new Set();
      previousTokensRef.current = new Map();
      return;
    }
    const sessionKey = `${participant.id}:${state.encounter.code}`;
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey;
      seenProposalIdsRef.current = new Set(state.damageProposals.filter(resolvedProposal).map((proposal) => proposal.id));
      previousTokensRef.current = tokenSnapshot(state.tokens);
      queueMicrotask(() => setQueue([]));
      return;
    }

    const seenProposalIds = seenProposalIdsRef.current;
    const newlyResolved = state.damageProposals
      .filter((proposal) => resolvedProposal(proposal) && !seenProposalIds.has(proposal.id))
      .toSorted((left, right) => (left.resolvedAt ?? 0) - (right.resolvedAt ?? 0) || left.id.localeCompare(right.id));
    for (const proposal of newlyResolved) seenProposalIds.add(proposal.id);

    const currentTokens = tokenSnapshot(state.tokens);
    if (participant.role !== "dm" && newlyResolved.length > 0) {
      const rolls = new Map(state.combatRolls.map((roll) => [roll.id, roll]));
      const simulatedTokens = new Map(previousTokensRef.current);
      const notifications: DamageNotification[] = [];
      for (const proposal of newlyResolved) {
        const currentToken = currentTokens.get(proposal.targetTokenId);
        const roll = rolls.get(proposal.rollId);
        const finalDamage = proposal.finalDamage;
        if (!currentToken?.controlledByViewer || !roll || finalDamage === null || finalDamage <= 0) continue;

        const previousToken = simulatedTokens.get(currentToken.id) ?? null;
        const transition = previousToken && previousToken.hp !== null && previousToken.maxHp !== null && previousToken.temporaryHp !== null
          ? transitionDamageWithTemporaryHp({
              hp: previousToken.hp,
              maxHp: previousToken.maxHp,
              temporaryHp: previousToken.temporaryHp,
              damage: finalDamage,
            })
          : null;
        const simulatedToken = transition && previousToken
          ? { ...previousToken, hp: transition.hp, temporaryHp: transition.temporaryHp }
          : currentToken;
        simulatedTokens.set(currentToken.id, simulatedToken);
        notifications.push({
          id: proposal.id,
          targetTokenId: proposal.targetTokenId,
          targetName: currentToken.name,
          attackerName: roll.attackerName,
          actionName: roll.action.name,
          damageType: roll.action.damageType,
          finalDamage,
          hpBefore: previousToken?.hp ?? null,
          hpAfter: simulatedToken.hp,
          maxHp: simulatedToken.maxHp,
          temporaryHpBefore: previousToken?.temporaryHp ?? null,
          temporaryHpAfter: simulatedToken.temporaryHp,
          concentrationCheckRequired: proposal.concentrationCheckRequired,
        });
      }
      if (notifications.length > 0) {
        queueMicrotask(() => {
          setQueue((current) => {
            const queuedIds = new Set(current.map((notification) => notification.id));
            return [...current, ...notifications.filter((notification) => !queuedIds.has(notification.id))];
          });
        });
      }
    }
    previousTokensRef.current = currentTokens;
  }, [participant, state]);

  const dismiss = useCallback((notificationId?: string) => setQueue((current) => notificationId
    ? current.filter((notification) => notification.id !== notificationId)
    : current.slice(1)), []);
  return {
    notifications: queue,
    notification: queue[0] ?? null,
    remainingCount: Math.max(0, queue.length - 1),
    dismiss,
  };
}
