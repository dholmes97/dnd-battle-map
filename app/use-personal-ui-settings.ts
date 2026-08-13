"use client";

import { useEffect, useState } from "react";
import type { ParticipantSession, Role } from "@/shared/contracts";

const DEFAULT_GRID_OPACITY = 0.17;
const STORAGE_PREFIX = "dnd-battle-map:ui:v1";
type Settings = { gridOpacity: number; showColoredTokenCenters: boolean; showHealthRings: boolean };

function storageKey(name: string, role: Role) {
  return `${STORAGE_PREFIX}:${role}:${encodeURIComponent(name.trim().toLocaleLowerCase())}`;
}

function load(name: string, role: Role): Settings {
  const defaults = { gridOpacity: DEFAULT_GRID_OPACITY, showColoredTokenCenters: true, showHealthRings: true };
  try {
    const stored = window.localStorage.getItem(storageKey(name, role));
    if (!stored) return defaults;
    const parsed = JSON.parse(stored) as Partial<Settings> & { transparentTokenBackgrounds?: boolean };
    return {
      gridOpacity: typeof parsed.gridOpacity === "number" && Number.isFinite(parsed.gridOpacity) ? Math.min(1, Math.max(0, parsed.gridOpacity)) : defaults.gridOpacity,
      showColoredTokenCenters: typeof parsed.showColoredTokenCenters === "boolean" ? parsed.showColoredTokenCenters : typeof parsed.transparentTokenBackgrounds === "boolean" ? !parsed.transparentTokenBackgrounds : defaults.showColoredTokenCenters,
      showHealthRings: typeof parsed.showHealthRings === "boolean" ? parsed.showHealthRings : defaults.showHealthRings,
    };
  } catch { return defaults; }
}

export function usePersonalUiSettings(participant: ParticipantSession | null) {
  const [gridOpacity, setGridOpacity] = useState(DEFAULT_GRID_OPACITY);
  const [showColoredTokenCenters, setShowColoredTokenCenters] = useState(true);
  const [showHealthRings, setShowHealthRings] = useState(true);
  const key = participant ? storageKey(participant.name, participant.role) : null;
  useEffect(() => {
    if (!key) return;
    try { window.localStorage.setItem(key, JSON.stringify({ gridOpacity, showColoredTokenCenters, showHealthRings })); }
    catch { /* Cosmetic settings continue in memory when browser storage is unavailable. */ }
  }, [gridOpacity, key, showColoredTokenCenters, showHealthRings]);
  const loadForIdentity = (name: string, role: Role) => {
    const settings = load(name, role);
    setGridOpacity(settings.gridOpacity); setShowColoredTokenCenters(settings.showColoredTokenCenters); setShowHealthRings(settings.showHealthRings);
  };
  return { gridOpacity, setGridOpacity, showColoredTokenCenters, setShowColoredTokenCenters, showHealthRings, setShowHealthRings, loadForIdentity };
}
