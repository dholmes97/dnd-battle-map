"use client";

import type { CSSProperties, RefObject } from "react";
import type { EncounterState, ParticipantSession } from "@/shared/contracts";
import type { MapPackage } from "@/shared/map-package";

const ICON_PATHS = {
  move: "M10 3v14M3 10h14M10 3 7.6 5.4M10 3l2.4 2.4M10 17l-2.4-2.4M10 17l2.4-2.4M3 10l2.4-2.4M3 10l2.4 2.4M17 10l-2.4-2.4M17 10l-2.4 2.4",
  ping: "M10 10h.01M6.1 13.9a5.5 5.5 0 0 1 0-7.8M13.9 6.1a5.5 5.5 0 0 1 0 7.8M3.6 16.4a9 9 0 0 1 0-12.8M16.4 3.6a9 9 0 0 1 0 12.8",
  line: "M5 15 15 5M5 15h.01M15 5h.01",
  erase: "m4 13 6.5-6.5a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 16H7zM4 16h12",
  spotlight: "M10 3v2M10 15v2M3 10h2M15 10h2M5.2 5.2l1.4 1.4M13.4 13.4l1.4 1.4M14.8 5.2l-1.4 1.4M6.6 13.4l-1.4 1.4M10 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6",
  neon: "M3 5h9v-2l5 5-5 5v-2H7v5H3z",
  clear: "M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14M5 5l10 10",
  creatures: "M7 4.5a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2M13 4.5a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2M4 9.2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3M16 9.2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3M10 9.5c2 0 3.6 1.7 3.9 3.3.3 1.6-.8 3.2-2.5 3.2h-2.8c-1.7 0-2.8-1.6-2.5-3.2C6.4 11.2 8 9.5 10 9.5",
  spells: "M10 2.8 11.6 7l4.4-1.4-2.5 3.8 3.7 2.7-4.6.2.2 4.7-2.8-3.7L7.2 17l.2-4.7-4.6-.2 3.7-2.7L4 5.6 8.4 7zM15.5 3.5h.01M3.8 15.8h.01",
  workshop: "M3 5.6 7.6 3.5l4.8 2.1L17 3.5v10.9l-4.6 2.1-4.8-2.1L3 16.5zM7.6 3.5v10.9M12.4 5.6v10.9",
  scenarios: "M3 5h5l1.7 2H17v9H3zM6 10h8M6 13h5",
  home: "M3 9.2 10 3l7 6.2V17h-5v-4.5H8V17H3z",
  chat: "M4 4h12v8H9l-3.5 3V12H4zM7 7h6M7 9.5h4",
  undo: "M7 5 3.5 8.5 7 12M3.5 8.5H12a4.5 4.5 0 0 1 0 9h-3",
  redo: "M13 5l3.5 3.5L13 12M16.5 8.5H8a4.5 4.5 0 0 0 0 9h3",
  fit: "M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4",
  zoomOut: "M9 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11M13 13l3.5 3.5M6.8 9h4.4",
  zoomIn: "M9 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11M13 13l3.5 3.5M6.8 9h4.4M9 6.8v4.4",
  sidebar: "M3 4.5h14v11H3zM12.5 4.5v11",
  present: "M3 4h14v9H3zM7 16.5h6M10 13v3.5",
  settings: "M4 5.5h12M7 3.5v4M4 10h12M13 8v4M4 14.5h12M8.5 12.5v4",
  fog: "M2.8 10s2.6-4.6 7.2-4.6 7.2 4.6 7.2 4.6-2.6 4.6-7.2 4.6S2.8 10 2.8 10M7.7 10a2.3 2.3 0 1 0 4.6 0 2.3 2.3 0 0 0-4.6 0",
  search: "M9 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11M13 13l3.5 3.5",
  check: "M4.5 10.2 8.2 14l7.3-8",
  damage: "M10 2.8 11.5 7l4.2-1.5-2.2 3.8 3.7 2.5-4.4.5.5 4.4-2.8-3.5-2.8 3.5.5-4.4-4.4-.5 3.7-2.5-2.2-3.8L8.5 7z",
  heal: "M7.5 3.5h5v4h4v5h-4v4h-5v-4h-4v-5h4z",
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="ui-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SpellShapeMark({ shape, className = "" }: { shape: "circle" | "square"; className?: string }) {
  return <span className={`${className}${className ? " " : ""}spell-shape-mark is-${shape}`} aria-hidden="true"><i /></span>;
}

type UiSettingsMenuProps = {
  menuRef: RefObject<HTMLDetailsElement | null>;
  participant: ParticipantSession;
  state: EncounterState;
  gridOpacity: number;
  showColoredTokenCenters: boolean;
  showHealthRings: boolean;
  onGridOpacityChange: (value: number) => void;
  onColoredTokenCentersChange: (value: boolean) => void;
  onHealthRingsChange: (value: boolean) => void;
  onFogModeChange: (mode: MapPackage["fog"]["mode"]) => void;
  onVisionDoorChange: (doorId: string, open: boolean) => void;
  onStrictMovementChange: (enabled: boolean) => void;
};

export function UiSettingsMenu({
  menuRef,
  participant,
  state,
  gridOpacity,
  showColoredTokenCenters,
  showHealthRings,
  onGridOpacityChange,
  onColoredTokenCentersChange,
  onHealthRingsChange,
  onFogModeChange,
  onVisionDoorChange,
  onStrictMovementChange,
}: UiSettingsMenuProps) {
  const fog = state.encounter.mapPackage?.fog;
  return (
    <details ref={menuRef} className="ui-settings-menu">
      <summary className="icon-tool" aria-label="UI Settings" data-tooltip="UI Settings"><Icon name="settings" /></summary>
      <section className="ui-settings-panel" aria-label="UI Settings">
        <div className="ui-settings-heading"><span><strong>UI Settings</strong><small>Personal and encounter display controls</small></span><button type="button" className="ui-settings-close" onClick={() => menuRef.current?.removeAttribute("open")}>Done</button></div>
        <div className="ui-settings-section-label"><strong>Your display</strong><small>Only changes your view</small></div>
        <label className="grid-opacity-control">
          <span>Grid visibility <output>{Math.round(gridOpacity * 100)}%</output></span>
          <input type="range" min="0" max="100" step="1" value={Math.round(gridOpacity * 100)} style={{ "--grid-level": `${Math.round(gridOpacity * 100)}%` } as CSSProperties} aria-label="Grid visibility" onChange={(event) => onGridOpacityChange(Number(event.target.value) / 100)} />
        </label>
        <label className="ui-setting-toggle"><span><strong>Colored token centers</strong><small>Show ownership colors behind token art</small></span><input type="checkbox" checked={showColoredTokenCenters} aria-label="Colored token centers" onChange={(event) => onColoredTokenCentersChange(event.target.checked)} /></label>
        <label className="ui-setting-toggle"><span><strong>Health rings</strong><small>Show current health around tokens</small></span><input type="checkbox" checked={showHealthRings} aria-label="Health rings" onChange={(event) => onHealthRingsChange(event.target.checked)} /></label>
        {participant.role === "dm" ? <div className="ui-settings-global">
          <div className="ui-settings-section-label"><strong>Encounter settings</strong><small>Affects everyone</small></div>
          <label className="ui-setting-select"><span><strong>Fog of war</strong><small>Choose how the map is revealed</small></span><select aria-label="Fog of war mode" value={fog?.mode ?? "off"} onChange={(event) => onFogModeChange(event.target.value as MapPackage["fog"]["mode"])}><option value="off">No fog</option><option value="shared">DM-controlled shared fog</option><option value="dynamic">Dynamic character vision</option></select></label>
          {fog?.mode === "dynamic" && fog.doors.length ? <div className="vision-door-controls"><span><strong>Vision doors</strong><small>Open or close line-of-sight blockers</small></span>{fog.doors.map((door, index) => <button type="button" className={door.open ? "is-open" : ""} key={door.id} aria-pressed={door.open} onClick={() => onVisionDoorChange(door.id, !door.open)}>Door {index + 1} · {door.open ? "Open" : "Closed"}</button>)}</div> : null}
          <label className="ui-setting-toggle" data-tooltip="With strict movement on, players can move only their own character and related summons. The DM can always move any token. Turn it off to let anyone move any visible token.">
            <span><strong>Strict movement</strong><small>Players move only their tokens</small></span>
            <input type="checkbox" checked={state.encounter.strictMovement} aria-label="Strict movement" aria-describedby="strict-movement-help" onChange={(event) => onStrictMovementChange(event.target.checked)} />
          </label>
          <span id="strict-movement-help" className="visually-hidden">With strict movement on, players can move only their own character and related summons. The DM can always move any token. Turn it off to let anyone move any visible token.</span>
        </div> : null}
      </section>
    </details>
  );
}
