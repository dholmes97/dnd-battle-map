"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [queue, setQueue] = useState<CombatRollResultNotice[]>([]);
  const sessionKeyRef = useRef("");
  const seenRollIdsRef = useRef(new Set<string>());
  const damageRolledIdsRef = useRef(new Set<string>());

  const enqueue = useCallback((notice: CombatRollResultNotice) => {
    seenRollIdsRef.current.add(notice.roll.id);
    if (notice.roll.damageRolledAt !== null) damageRolledIdsRef.current.add(notice.roll.id);
    setQueue((current) => current.some((item) => item.roll.id === notice.roll.id)
      ? current.map((item) => item.roll.id === notice.roll.id ? notice : item)
      : [...current, notice]);
  }, []);

  useEffect(() => {
    if (!participant || !state) {
      sessionKeyRef.current = "";
      seenRollIdsRef.current = new Set();
      damageRolledIdsRef.current = new Set();
      queueMicrotask(() => setQueue([]));
      return;
    }

    const sessionKey = `${participant.id}:${state.encounter.code}`;
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey;
      seenRollIdsRef.current = new Set(state.combatRolls.map((roll) => roll.id));
      damageRolledIdsRef.current = new Set(state.combatRolls
        .filter((roll) => roll.damageRolledAt !== null)
        .map((roll) => roll.id));
      queueMicrotask(() => setQueue([]));
      return;
    }

    const unseenRolls = state.combatRolls
      .filter((roll) => !seenRollIdsRef.current.has(roll.id))
      .toSorted((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    for (const roll of unseenRolls) seenRollIdsRef.current.add(roll.id);
    const newlyDamagedRolls = state.combatRolls
      .filter((roll) => roll.damageRolledAt !== null && !damageRolledIdsRef.current.has(roll.id))
      .toSorted((left, right) => (left.damageRolledAt ?? 0) - (right.damageRolledAt ?? 0) || left.id.localeCompare(right.id));
    for (const roll of newlyDamagedRolls) damageRolledIdsRef.current.add(roll.id);
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
  }, [participant, state]);

  const dismiss = useCallback((rollId?: string) => setQueue((current) => rollId
    ? current.filter((notice) => notice.roll.id !== rollId)
    : current.slice(1)), []);

  return { notifications: queue, enqueue, dismiss };
}
