"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CombatRollResultNotice } from "@/app/combat-activity-stack";
import type { EncounterState, ParticipantSession } from "@/shared/contracts";

function noticeForRoll(state: EncounterState, rollId: string): CombatRollResultNotice | null {
  const roll = state.combatRolls.find((item) => item.id === rollId);
  if (!roll) return null;
  return {
    roll,
    proposalId: state.damageProposals.find((proposal) => proposal.rollId === roll.id)?.id ?? null,
  };
}

export function useCombatRollNotifications({ participant, state }: {
  participant: ParticipantSession | null;
  state: EncounterState | null;
}) {
  const currentSessionKey = participant && state ? `${participant.id}:${state.encounter.code}` : "";
  const [queue, setQueue] = useState<CombatRollResultNotice[]>([]);
  const [sessionKey, setSessionKey] = useState(currentSessionKey);
  const [seenRollIds, setSeenRollIds] = useState<ReadonlySet<string>>(
    () => new Set(state?.combatRolls.map((roll) => roll.id) ?? []),
  );
  const [damageRolledIds, setDamageRolledIds] = useState<ReadonlySet<string>>(
    () => new Set(state?.combatRolls.filter((roll) => roll.damageRolledAt !== null).map((roll) => roll.id) ?? []),
  );
  const pendingNotificationRollIds = useMemo(() => participant && state && sessionKey === currentSessionKey
    ? state.combatRolls
      .filter((roll) => !seenRollIds.has(roll.id) ||
        roll.damageRolledAt !== null && !damageRolledIds.has(roll.id))
      .map((roll) => roll.id)
    : [], [currentSessionKey, damageRolledIds, participant, seenRollIds, sessionKey, state]);

  const enqueue = useCallback((notice: CombatRollResultNotice) => {
    setSeenRollIds((current) => new Set(current).add(notice.roll.id));
    if (notice.roll.damageRolledAt !== null) {
      setDamageRolledIds((current) => new Set(current).add(notice.roll.id));
    }
    setQueue((current) => current.some((item) => item.roll.id === notice.roll.id)
      ? current.map((item) => item.roll.id === notice.roll.id ? notice : item)
      : [...current, notice]);
  }, []);

  useEffect(() => {
    if (!participant || !state) {
      if (!sessionKey && queue.length === 0 && seenRollIds.size === 0 && damageRolledIds.size === 0) return;
      queueMicrotask(() => {
        setSessionKey("");
        setSeenRollIds(new Set());
        setDamageRolledIds(new Set());
        setQueue([]);
      });
      return;
    }

    const nextSessionKey = `${participant.id}:${state.encounter.code}`;
    if (sessionKey !== nextSessionKey) {
      queueMicrotask(() => {
        setSessionKey(nextSessionKey);
        setSeenRollIds(new Set(state.combatRolls.map((roll) => roll.id)));
        setDamageRolledIds(new Set(state.combatRolls
          .filter((roll) => roll.damageRolledAt !== null)
          .map((roll) => roll.id)));
        setQueue([]);
      });
      return;
    }

    const unseenRolls = state.combatRolls
      .filter((roll) => !seenRollIds.has(roll.id))
      .toSorted((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    const newlyDamagedRolls = state.combatRolls
      .filter((roll) => roll.damageRolledAt !== null && !damageRolledIds.has(roll.id))
      .toSorted((left, right) => (left.damageRolledAt ?? 0) - (right.damageRolledAt ?? 0) || left.id.localeCompare(right.id));
    const unseenIds = new Set(unseenRolls.map((roll) => roll.id));
    const eventRolls = [...unseenRolls, ...newlyDamagedRolls.filter((roll) => !unseenIds.has(roll.id))];
    if (eventRolls.length === 0) return;
    const notices = eventRolls.flatMap((roll) => {
      const notice = noticeForRoll(state, roll.id);
      return notice ? [notice] : [];
    });
    queueMicrotask(() => setQueue((current) => {
      const noticeByRollId = new Map(notices.map((notice) => [notice.roll.id, notice]));
      const updated = current.map((notice) => noticeByRollId.get(notice.roll.id) ?? notice);
      const queuedIds = new Set(updated.map((notice) => notice.roll.id));
      return [...updated, ...notices.filter((notice) => !queuedIds.has(notice.roll.id))];
    }));
    queueMicrotask(() => {
      setSeenRollIds((current) => new Set([...current, ...unseenRolls.map((roll) => roll.id)]));
      setDamageRolledIds((current) => new Set([...current, ...newlyDamagedRolls.map((roll) => roll.id)]));
    });
  }, [damageRolledIds, participant, queue.length, seenRollIds, sessionKey, state]);

  const dismiss = useCallback((rollId?: string) => setQueue((current) => rollId
    ? current.filter((notice) => notice.roll.id !== rollId)
    : current.slice(1)), []);

  return { notifications: queue, pendingNotificationRollIds, enqueue, dismiss };
}
