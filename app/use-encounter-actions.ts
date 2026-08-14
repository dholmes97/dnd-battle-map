"use client";

import { useState } from "react";
import type { EncounterSync } from "@/app/use-encounter-sync";
import type { MapPoint, SharedToken } from "@/shared/contracts";
import { ensureSharedFogPolygon } from "@/shared/fog-of-war";
import { advanceEncounterTurn } from "@/shared/initiative-domain";
import type { MapPackage } from "@/shared/map-package";

export function useEncounterActions(sync: EncounterSync) {
  const [pendingAction, setPendingAction] = useState<"pause" | "resume" | "reset" | null>(null);

  const startCombat = () => void sync.runOptimisticCommand("start-combat", {}, (current) => {
    const leaders = current.tokens.filter((token) => !token.summonerTokenId && token.initiative !== null).sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0) || a.name.localeCompare(b.name));
    const groupKeys = [...new Set(leaders.map((leader) => leader.initiativeGroupId || leader.id))];
    const groupOrders = new Map(groupKeys.map((key, order) => [key, order]));
    const orders = new Map(leaders.map((leader) => [leader.id, groupOrders.get(leader.initiativeGroupId || leader.id)!]));
    return { ...current, encounter: { ...current.encounter, status: "active", currentRound: 1, activeInitiativeOrder: 0 }, tokens: current.tokens.map((token) => { const leaderId = token.summonerTokenId ?? token.id; return orders.has(leaderId) ? { ...token, initiativeOrder: orders.get(leaderId)!, turnComplete: false, movementUsed: 0, movementOrigin: null } : { ...token, initiativeOrder: null, turnComplete: false, movementUsed: 0, movementOrigin: null }; }) };
  }, "Combat started.");

  const endTurn = (token: SharedToken) => void sync.runOptimisticCommand("end-turn", { tokenId: token.id }, (current) => advanceEncounterTurn(current, true), "Group turn ended.", undefined, undefined, true);
  const advanceTurn = () => void sync.runOptimisticCommand("advance-turn", {}, (current) => advanceEncounterTurn(current, true), "Turn advanced.", undefined, undefined, true);
  const correctTurn = (round: number, activeOrder: number) => void sync.runOptimisticCommand("correct-turn", { round, activeOrder }, (current) => ({ ...current, encounter: { ...current.encounter, status: "active", currentRound: round, activeInitiativeOrder: activeOrder }, tokens: current.tokens.map((token) => token.initiativeOrder === activeOrder ? { ...token, turnComplete: false, movementUsed: 0, movementOrigin: null } : token) }), "Turn corrected.");

  const configure = async (status: "setup" | "active" | "paused", notice: string) => {
    const action = status === "setup" ? "reset" : status === "paused" ? "pause" : "resume";
    setPendingAction(action);
    try { return await sync.runOptimisticCommand("configure-encounter", { status }, (current) => ({ ...current, encounter: { ...current.encounter, status } }), notice); }
    finally { setPendingAction(null); }
  };

  const setStrictMovement = (enabled: boolean) => void sync.runOptimisticCommand("set-strict-movement", { enabled }, (current) => ({ ...current, encounter: { ...current.encounter, strictMovement: enabled } }), enabled ? "Strict movement enabled." : "Open movement enabled.");
  const setFogMode = (mode: MapPackage["fog"]["mode"]) => void sync.runOptimisticCommand("set-fog-mode", { mode }, (current) => {
    const mapPackage = current.encounter.mapPackage;
    const sharedPolygon = mapPackage && mode === "shared" ? ensureSharedFogPolygon(mapPackage.fog.sharedPolygon, mapPackage.width, mapPackage.height) : mapPackage?.fog.sharedPolygon;
    return { ...current, encounter: { ...current.encounter, mapPackage: mapPackage ? { ...mapPackage, fog: { ...mapPackage.fog, mode, sharedPolygon: sharedPolygon! } } : null, fogVisibility: { ...current.encounter.fogVisibility, mode } } };
  }, mode === "off" ? "Fog of war disabled." : mode === "shared" ? "Shared fog enabled." : "Dynamic character vision enabled.");
  const setVisionDoorOpen = (doorId: string, open: boolean) => void sync.runOptimisticCommand("set-vision-door-open", { doorId, open }, (current) => ({ ...current, encounter: { ...current.encounter, mapPackage: current.encounter.mapPackage ? { ...current.encounter.mapPackage, fog: { ...current.encounter.mapPackage.fog, doors: current.encounter.mapPackage.fog.doors.map((door) => door.id === doorId ? { ...door, open } : door) } } : null } }), open ? "Vision door opened." : "Vision door closed.");
  const updateSharedFog = (polygon: MapPoint[]) => void sync.runOptimisticCommand("update-shared-fog", { polygon }, (current) => ({ ...current, encounter: { ...current.encounter, mapPackage: current.encounter.mapPackage ? { ...current.encounter.mapPackage, fog: { ...current.encounter.mapPackage.fog, sharedPolygon: polygon } } : null } }), "Shared fog updated.");

  return { pendingAction, startCombat, endTurn, advanceTurn, correctTurn, configure, setStrictMovement, setFogMode, setVisionDoorOpen, updateSharedFog };
}
