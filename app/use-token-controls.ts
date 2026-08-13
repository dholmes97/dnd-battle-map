"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import type { useEncounterSync } from "@/app/use-encounter-sync";
import { tokenRadiusCells, type CreatureSize } from "@/shared/creature-library";
import type { EncounterState, ParticipantSession, SharedEffect, SharedToken } from "@/shared/contracts";
import { transitionHp } from "@/shared/encounter-transitions.ts";
import { clampMapPoint } from "@/shared/battle-map-geometry.ts";
import { initiativePackMembers, rosterBaseName } from "@/shared/initiative-domain.ts";
import { spellAreaDiameter, type SpellAreaSize, type SpellEffectDefinition } from "@/shared/spell-effects";

type EncounterSync = ReturnType<typeof useEncounterSync>;

export function useTokenControls({ participant, state, sync, setError, setNotice }: {
  participant: ParticipantSession | null;
  state: EncounterState | null;
  sync: EncounterSync;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
}) {
  const [initiativeDrafts, setInitiativeDrafts] = useState<Record<string, string>>({});
  const [initiativeStatuses, setInitiativeStatuses] = useState<Record<string, "editing" | "saving" | "saved">>({});
  const [tokenDrafts, setTokenDrafts] = useState<Record<string, { name?: string; size?: CreatureSize; speed?: string; maxHp?: string; artAsset?: string }>>({});
  const [hpAmount, setHpAmount] = useState("5");
  const [effectName, setEffectName] = useState("");
  const [effectType, setEffectType] = useState("condition");
  const [effectDuration, setEffectDuration] = useState("1");
  const [effectReminder, setEffectReminder] = useState("end");
  const [effectEditorTokenId, setEffectEditorTokenId] = useState<string | null>(null);
  const [tokenEditorTokenId, setTokenEditorTokenId] = useState<string | null>(null);
  const [pendingDeleteTokenId, setPendingDeleteTokenId] = useState<string | null>(null);

  const saveInitiative = async (token: SharedToken) => {
    const draft = initiativeDrafts[token.id];
    if (draft === undefined) return;
    if (draft === "") {
      setInitiativeDrafts((current) => { const next = { ...current }; delete next[token.id]; return next; });
      setInitiativeStatuses((current) => ({ ...current, [token.id]: "saved" }));
      return;
    }
    const initiative = Number(draft);
    if (!Number.isInteger(initiative) || initiative < 0 || initiative > 99) {
      setError("Initiative must be a whole number from 0 to 99.");
      return;
    }
    const packMembers = (participant?.role === "dm" && state ? initiativePackMembers(token, state.tokens) : [token]) as SharedToken[];
    const alreadyOnePack = packMembers.length > 1
      && packMembers.every((member) => member.initiative === initiative
        && member.initiativeGroupId && member.initiativeGroupId === packMembers[0].initiativeGroupId);
    if (initiative === token.initiative && (packMembers.length === 1 || alreadyOnePack)) {
      setInitiativeDrafts((current) => { const next = { ...current }; delete next[token.id]; return next; });
      setInitiativeStatuses((current) => ({ ...current, [token.id]: "saved" }));
      return;
    }
    setInitiativeStatuses((current) => ({ ...current, [token.id]: "saving" }));
    const packIds = new Set(packMembers.map((member) => member.id));
    const optimisticGroupId = `pending-group-${sync.nextTokenMutationSequence()}`;
    const result = packMembers.length > 1
      ? await sync.runOptimisticCommand(
          "set-initiative-group",
          { tokenIds: [...packIds], initiative },
          (current) => ({ ...current, tokens: current.tokens.map((item) => packIds.has(item.id)
            ? { ...item, initiative, initiativeGroupId: optimisticGroupId, turnComplete: false, movementUsed: 0, movementOrigin: null }
            : item) }),
          `${rosterBaseName(token.name)} initiative set for all ${packMembers.length}.`,
        )
      : await sync.runOptimisticCommand(
          "set-initiative",
          { tokenId: token.id, initiative },
          (current) => ({ ...current, tokens: current.tokens.map((item) => item.id === token.id
            ? { ...item, initiative, initiativeGroupId: null, initiativeOrder: null, turnComplete: false, movementUsed: 0, movementOrigin: null }
            : item) }),
        );
    if (result) {
      setInitiativeDrafts((current) => { const next = { ...current }; delete next[token.id]; return next; });
      setInitiativeStatuses((current) => ({ ...current, [token.id]: "saved" }));
    } else {
      setInitiativeStatuses((current) => ({ ...current, [token.id]: "editing" }));
    }
  };

  const splitInitiativePack = (token: SharedToken) => {
    if (token.initiative === null) return;
    void sync.runOptimisticCommand(
      "set-initiative",
      { tokenId: token.id, initiative: token.initiative },
      (current) => ({ ...current, tokens: current.tokens.map((item) => item.id === token.id
        ? { ...item, initiativeGroupId: null, turnComplete: false, movementUsed: 0, movementOrigin: null }
        : item) }),
      `${token.name} split from its initiative pack.`,
    );
  };

  const saveInitiativeGroup = async (key: string, tokens: SharedToken[]) => {
    const draftKey = `group:${key}`;
    const draft = initiativeDrafts[draftKey];
    if (draft === undefined || draft === "") return;
    const initiative = Number(draft);
    if (!Number.isInteger(initiative) || initiative < 0 || initiative > 99) {
      setError("Initiative must be a whole number from 0 to 99.");
      return;
    }
    if (tokens.every((token) => token.initiative === initiative && token.initiativeGroupId && token.initiativeGroupId === tokens[0].initiativeGroupId)) {
      setInitiativeDrafts((current) => { const next = { ...current }; delete next[draftKey]; return next; });
      return;
    }
    setInitiativeStatuses((current) => ({ ...current, [draftKey]: "saving" }));
    const optimisticGroupId = `pending-group-${sync.nextTokenMutationSequence()}`;
    const tokenIds = new Set(tokens.map((token) => token.id));
    const result = await sync.runOptimisticCommand(
      "set-initiative-group",
      { tokenIds: [...tokenIds], initiative },
      (current) => ({ ...current, tokens: current.tokens.map((token) => tokenIds.has(token.id)
        ? { ...token, initiative, initiativeGroupId: optimisticGroupId, initiativeOrder: null, turnComplete: false, movementUsed: 0, movementOrigin: null }
        : token) }),
      `${rosterBaseName(tokens[0].name)} initiative set for all ${tokens.length}.`,
    );
    if (result) {
      setInitiativeDrafts((current) => { const next = { ...current }; delete next[draftKey]; return next; });
      setInitiativeStatuses((current) => ({ ...current, [draftKey]: "saved" }));
    } else {
      setInitiativeStatuses((current) => ({ ...current, [draftKey]: "editing" }));
    }
  };

  const addEffectToToken = async (tokenId: string) => {
    const name = effectName.trim();
    if (!name) return;
    const temporaryId = `pending-effect-${Date.now()}-${sync.nextTokenMutationSequence()}`;
    const durationRounds = Number(effectDuration);
    const optimisticEffect: SharedEffect = {
      id: temporaryId,
      name,
      type: effectType,
      durationRounds,
      expiresRound: Math.max(1, state?.encounter.currentRound || 1) + durationRounds,
      reminderTiming: effectReminder,
      due: false,
    };
    setEffectName(""); setEffectEditorTokenId(null);
    const result = await sync.runOptimisticCommand(
      "add-effect",
      { tokenId, name, effectType, reminderTiming: effectReminder, durationRounds },
      (current) => ({ ...current, tokens: current.tokens.map((token) => token.id === tokenId ? { ...token, effects: [...token.effects, optimisticEffect] } : token) }),
      `${name} added.`,
    );
    if (!result) { setEffectEditorTokenId(tokenId); setEffectName(name); }
  };

  const applyHpToToken = async (token: SharedToken, delta: number) => {
    if (!Number.isFinite(delta) || delta === 0 || token.maxHp === null) return;
    const hpTransition = transitionHp(token.hp, token.maxHp, delta);
    const result = await sync.runOptimisticCommand<{ state: EncounterState; concentrationCheckRequired: boolean }>(
      "apply-hp",
      { tokenId: token.id, delta },
      (current) => ({ ...current, tokens: current.tokens.map((item) => item.id === token.id ? { ...item, hp: hpTransition.hp, healthState: hpTransition.healthState } : item) }),
    );
    if (result) setNotice(result.concentrationCheckRequired ? "HP updated — concentration check reminder." : "HP updated.");
  };

  const removeEffectFromToken = (tokenId: string, effectId: string) => {
    void sync.runOptimisticCommand(
      "remove-effect",
      { effectId },
      (current) => ({ ...current, tokens: current.tokens.map((token) => token.id === tokenId ? { ...token, effects: token.effects.filter((effect) => effect.id !== effectId) } : token) }),
    );
  };

  const discardTokenDetails = (tokenId: string) => {
    setTokenDrafts((current) => {
      if (!current[tokenId]) return current;
      const next = { ...current };
      delete next[tokenId];
      return next;
    });
    setTokenEditorTokenId(null);
  };

  const saveTokenDetails = async (token: SharedToken) => {
    const draft = tokenDrafts[token.id] ?? {};
    const name = draft.name ?? token.name;
    const size = draft.size ?? token.size;
    const requestedSpeed = Number(draft.speed ?? token.speed);
    const speed = Number.isFinite(requestedSpeed) ? requestedSpeed : token.speed;
    const requestedMaxHp = draft.maxHp === undefined || draft.maxHp === "" ? token.maxHp : Number(draft.maxHp);
    const maxHp = requestedMaxHp !== null && Number.isFinite(requestedMaxHp) ? Math.max(1, Math.trunc(requestedMaxHp)) : token.maxHp;
    const artAsset = draft.artAsset ?? token.artAsset ?? "";
    setTokenEditorTokenId(null);
    const result = await sync.runOptimisticCommand(
      "update-token",
      { tokenId: token.id, name, size, speed, maxHp: maxHp ?? undefined, artAsset },
      (current) => ({ ...current, tokens: current.tokens.map((item) => item.id === token.id ? { ...item, name, size, speed, maxHp, hp: maxHp === null ? null : Math.min(maxHp, item.hp ?? maxHp), artAsset: artAsset || null } : item) }),
      "Token details saved.",
    );
    if (result) {
      setTokenDrafts((current) => { const next = { ...current }; delete next[token.id]; return next; });
    } else {
      setTokenEditorTokenId(token.id);
    }
  };

  const resizeSpellEffect = (token: SharedToken, spell: SpellEffectDefinition, size: SpellAreaSize) => {
    if (token.size === size) return;
    const feet = spellAreaDiameter(size);
    void sync.runOptimisticCommand(
      "resize-spell-effect",
      { tokenId: token.id, size },
      (current) => ({
        ...current,
        tokens: current.tokens.map((item) => {
          if (item.id !== token.id) return item;
          const point = clampMapPoint(current.grid, item, tokenRadiusCells(size));
          return { ...item, ...point, size };
        }),
      }),
      spell.shape === "square" ? `Spell area resized to a ${feet}-ft square.` : `Spell area resized to ${feet} ft across.`,
    );
  };

  return {
    initiativeDrafts, setInitiativeDrafts, initiativeStatuses, setInitiativeStatuses,
    tokenDrafts, setTokenDrafts, hpAmount, setHpAmount,
    effectName, setEffectName, effectType, setEffectType, effectDuration, setEffectDuration,
    effectReminder, setEffectReminder, effectEditorTokenId, setEffectEditorTokenId,
    tokenEditorTokenId, setTokenEditorTokenId, pendingDeleteTokenId, setPendingDeleteTokenId,
    saveInitiative, splitInitiativePack, saveInitiativeGroup, addEffectToToken,
    applyHpToToken, removeEffectFromToken, discardTokenDetails, saveTokenDetails, resizeSpellEffect,
  };
}

export type TokenControls = ReturnType<typeof useTokenControls>;
