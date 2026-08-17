"use client";

import type { RefObject } from "react";
import { Icon, UiSettingsMenu, type IconName } from "@/app/battle-map-ui";
import type { BattleMapViewport } from "@/app/battle-map-renderer";
import type { EncounterState, ParticipantSession } from "@/shared/contracts";
import type { MapPackage } from "@/shared/map-package";

export type AnnotationMode = "move" | "ping" | "drawing" | "erase" | "spotlight" | "neon-spotlight";

type CommandBarProps = {
  participant: ParticipantSession;
  state: EncounterState;
  annotationMode: AnnotationMode;
  editingSharedFog: boolean;
  chatOpen: boolean;
  chatMinimized: boolean;
  chatUnreadTotal: number;
  paletteOpen: boolean;
  spellPaletteOpen: boolean;
  busy: boolean;
  viewport: BattleMapViewport;
  effectiveZoom: number;
  connection: "connecting" | "live" | "reconnecting" | "lost";
  connectionLabel: string;
  connectionTooltip: string;
  uiSettingsRef: RefObject<HTMLDetailsElement | null>;
  gridOpacity: number;
  showColoredTokenCenters: boolean;
  showHealthRings: boolean;
  sidebarOpen: boolean;
  presenting: boolean;
  onAnnotationMode: (mode: AnnotationMode) => void;
  onToggleFogEditor: () => void;
  onClearAnnotations: () => void;
  onToggleChat: () => void;
  onToggleCreatures: () => void;
  onToggleSpells: () => void;
  onOpenWorkshop: () => void;
  onManageScenarios: () => void;
  onHistory: (direction: "undo" | "redo") => void;
  onFit: () => void;
  onZoom: (amount: number) => void;
  onResetZoom: () => void;
  onGridOpacityChange: (value: number) => void;
  onColoredTokenCentersChange: (value: boolean) => void;
  onHealthRingsChange: (value: boolean) => void;
  onFogModeChange: (mode: MapPackage["fog"]["mode"]) => void;
  onVisionDoorChange: (doorId: string, open: boolean) => void;
  onStrictMovementChange: (enabled: boolean) => void;
  onToggleSidebar: () => void;
  onTogglePresenting: () => void;
};

export function BattleMapCommandBar(props: CommandBarProps) {
  const tool = (mode: AnnotationMode, icon: IconName, label: string, shortcut: string) => <button className={`icon-tool${props.annotationMode === mode ? " tool-active" : ""}`} aria-label={label} data-tooltip={`${label} — ${shortcut}`} aria-pressed={props.annotationMode === mode} onClick={() => props.onAnnotationMode(mode)}><Icon name={icon} /></button>;
  const { participant, state } = props;
  const zoomPercentage = Math.round(props.effectiveZoom * 100);
  return <div className="command-bar" aria-label="Map tools and encounter status">
    <div className="map-tool-group" role="group" aria-label="Tactical tools">
      {tool("move", "move", "Move tokens", "V")}{tool("ping", "ping", "Ping map", "P")}{tool("drawing", "line", "Draw line", "L")}{tool("erase", "erase", "Erase line", "E")}
      {participant.role === "dm" ? tool("spotlight", "spotlight", "Arcane spotlight", "S") : null}{participant.role === "dm" ? tool("neon-spotlight", "neon", "Neon arrow", "N") : null}
      {participant.role === "dm" && state.encounter.mapPackage?.fog.mode === "shared" ? <button className={`icon-tool${props.editingSharedFog ? " tool-active" : ""}`} aria-label="Edit shared fog" data-tooltip="Edit shared fog corners" aria-pressed={props.editingSharedFog} onClick={props.onToggleFogEditor}><Icon name="fog" /></button> : null}
      {participant.role === "dm" ? <button className="icon-tool" aria-label="Clear all annotations" data-tooltip="Clear all annotations" onClick={props.onClearAnnotations}><Icon name="clear" /></button> : null}
    </div>
    <div className="map-tool-group" role="group" aria-label="Map content">
      <button className={`icon-tool chat-launcher${props.chatOpen ? " tool-active" : ""}`} aria-label={props.chatUnreadTotal > 0 ? `Chat, ${props.chatUnreadTotal} unread messages` : "Chat"} data-tooltip="Chat" aria-pressed={props.chatOpen} onClick={props.onToggleChat}><Icon name="chat" />{props.chatUnreadTotal > 0 ? <span className="chat-unread-badge" aria-hidden="true">{Math.min(99, props.chatUnreadTotal)}</span> : null}</button>
      <button className={`icon-tool${props.paletteOpen ? " tool-active" : ""}`} aria-label="Creature palette" data-tooltip="Creature palette" aria-pressed={props.paletteOpen} onClick={props.onToggleCreatures}><Icon name="creatures" /></button>
      <button className={`icon-tool${props.spellPaletteOpen ? " tool-active" : ""}`} aria-label="Spell effects" data-tooltip="Spell effects" aria-pressed={props.spellPaletteOpen} onClick={props.onToggleSpells}><Icon name="spells" /></button>
      {participant.role === "dm" ? <button className="icon-tool" aria-label="Open Map Workshop" data-tooltip="Map Workshop" onClick={props.onOpenWorkshop}><Icon name="workshop" /></button> : null}
      {participant.role === "dm" ? <button className="icon-tool" aria-label="Manage scenarios" data-tooltip="Manage scenarios" onClick={props.onManageScenarios}><Icon name="scenarios" /></button> : null}
    </div>
    <div className="map-tool-group" role="group" aria-label="Action history"><button className="icon-tool" aria-label="Undo last action" data-tooltip="Undo — Ctrl/Cmd + Z" onClick={() => props.onHistory("undo")} disabled={props.busy || state.undo.available === 0}><Icon name="undo" /></button><button className="icon-tool" aria-label="Redo last action" data-tooltip="Redo — Ctrl + Y or Cmd + Shift + Z" onClick={() => props.onHistory("redo")} disabled={props.busy || state.undo.redoAvailable === 0}><Icon name="redo" /></button></div>
    <div className="encounter-identity"><strong>{state.encounter.name}</strong><span>{state.encounter.status}</span></div>
    <div className="round-counter" aria-label={state.encounter.currentRound > 0 ? `Current round ${state.encounter.currentRound}` : "Combat has not started"}><span>Round</span><strong>{state.encounter.currentRound > 0 ? state.encounter.currentRound : "—"}</strong></div>
    <div className="map-tool-group viewport-tools" role="group" aria-label="Map view"><button className={`icon-tool${props.viewport.fit ? " tool-active" : ""}`} aria-label="Fit whole map" data-tooltip="Fit whole map — 0" aria-pressed={props.viewport.fit} onClick={props.onFit}><Icon name="fit" /></button><button className="icon-tool" aria-label="Zoom out" data-tooltip="Zoom out — minus" onClick={() => props.onZoom(-0.5)}><Icon name="zoomOut" /></button><button className="zoom-value" aria-label={`Reset zoom to 100%, currently ${zoomPercentage}%`} data-tooltip="Reset zoom to 100%" onClick={props.onResetZoom}>{zoomPercentage}%</button><button className="icon-tool" aria-label="Zoom in" data-tooltip="Zoom in — plus" onClick={() => props.onZoom(0.5)}><Icon name="zoomIn" /></button></div>
    <div className={`connection-pill connection-${props.connection}`} aria-label={props.connectionTooltip} data-tooltip={props.connectionTooltip} aria-live="polite"><span className="connection-dot" /><em>{props.connectionLabel}</em></div>
    <div className="map-tool-group" role="group" aria-label="Layout">
      <UiSettingsMenu menuRef={props.uiSettingsRef} participant={participant} state={state} gridOpacity={props.gridOpacity} showColoredTokenCenters={props.showColoredTokenCenters} showHealthRings={props.showHealthRings} onGridOpacityChange={props.onGridOpacityChange} onColoredTokenCentersChange={props.onColoredTokenCentersChange} onHealthRingsChange={props.onHealthRingsChange} onFogModeChange={props.onFogModeChange} onVisionDoorChange={props.onVisionDoorChange} onStrictMovementChange={props.onStrictMovementChange} />
      <button className={`icon-tool${props.sidebarOpen ? "" : " tool-active"}`} aria-label={props.sidebarOpen ? "Hide encounter panel" : "Show encounter panel"} data-tooltip={"Encounter panel — \\"} aria-pressed={!props.sidebarOpen} onClick={props.onToggleSidebar}><Icon name="sidebar" /></button>
      <button className={`icon-tool${props.presenting ? " tool-active" : ""}`} aria-label="Presentation mode" data-tooltip="Presentation mode — F" aria-pressed={props.presenting} onClick={props.onTogglePresenting}><Icon name="present" /></button>
    </div>
  </div>;
}
