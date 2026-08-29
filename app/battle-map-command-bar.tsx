"use client";

import { useState, type RefObject } from "react";
import IconActionButton from "@/app/icon-action-button";
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
  durableAnnotationCount: number;
  onAnnotationMode: (mode: AnnotationMode) => void;
  onToggleFogEditor: () => void;
  onRequestClearAnnotations: () => void;
  onToggleChat: () => void;
  onToggleCreatures: () => void;
  onToggleSpells: () => void;
  onOpenDashboard: () => void;
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
  onCorrectTurn: (round: number, order: number) => void;
};

function combatOutcomeLabel(outcome: EncounterState["combatRolls"][number]["outcome"]) {
  if (outcome === "needs-ac") return "Needs ruling";
  return outcome === "hit" ? "Hit" : "Miss";
}

function proposalStatusLabel(status: EncounterState["damageProposals"][number]["status"]) {
  if (status === "pending") return "Pending approval";
  if (status === "applied") return "Damage applied";
  return "No damage applied";
}

export function BattleMapCommandBar(props: CommandBarProps) {
  const [combatLogOpen, setCombatLogOpen] = useState(false);
  const [roundEditorOpen, setRoundEditorOpen] = useState(false);
  const [roundDraft, setRoundDraft] = useState("");
  const [activeOrderDraft, setActiveOrderDraft] = useState(0);
  const tool = (mode: AnnotationMode, icon: IconName, label: string, shortcut: string) => <button className={`icon-tool${props.annotationMode === mode ? " tool-active" : ""}`} aria-label={label} data-tooltip={`${label} — ${shortcut}`} aria-pressed={props.annotationMode === mode} onClick={() => props.onAnnotationMode(mode)}><Icon name={icon} /></button>;
  const { participant, state } = props;
  const zoomPercentage = Math.round(props.effectiveZoom * 100);
  const initiativeOrders = [...new Set(state.tokens.flatMap((token) => token.initiativeOrder === null ? [] : [token.initiativeOrder]))].sort((a, b) => a - b);
  const canCorrectTurn = participant.role === "dm" && state.encounter.status !== "setup" && initiativeOrders.length > 0;
  const correctedRound = /^\d+$/.test(roundDraft) && Number(roundDraft) >= 1 ? Number(roundDraft) : null;
  return <div className="command-bar" aria-label="Map tools and encounter status">
    <div className="map-tool-group" role="group" aria-label="Tactical tools">
      {tool("move", "move", "Move tokens", "V")}{tool("ping", "ping", "Ping map", "P")}{tool("drawing", "line", "Draw line", "L")}{tool("erase", "erase", "Erase line", "E")}
      {participant.role === "dm" ? tool("spotlight", "spotlight", "Arcane spotlight", "S") : null}{participant.role === "dm" ? tool("neon-spotlight", "neon", "Neon arrow", "N") : null}
      {participant.role === "dm" && state.encounter.mapPackage?.fog.mode === "shared" ? <button className={`icon-tool${props.editingSharedFog ? " tool-active" : ""}`} aria-label="Edit shared fog" data-tooltip="Edit shared fog corners" aria-pressed={props.editingSharedFog} onClick={props.onToggleFogEditor}><Icon name="fog" /></button> : null}
      {participant.role === "dm" ? <button className="icon-tool" aria-label={props.durableAnnotationCount > 0 ? `Clear ${props.durableAnnotationCount} ${props.durableAnnotationCount === 1 ? "drawing" : "drawings"}` : "No drawings to clear"} data-tooltip="Clear durable drawings" disabled={props.durableAnnotationCount === 0} onClick={props.onRequestClearAnnotations}><Icon name="clear" /></button> : null}
    </div>
    <div className="map-tool-group" role="group" aria-label="Map content">
      <button className={`icon-tool chat-launcher${props.chatOpen ? " tool-active" : ""}`} aria-label={props.chatUnreadTotal > 0 ? `Chat, ${props.chatUnreadTotal} unread messages` : "Chat"} data-tooltip="Chat" aria-pressed={props.chatOpen} onClick={props.onToggleChat}><Icon name="chat" />{props.chatUnreadTotal > 0 ? <span className="chat-unread-badge" aria-hidden="true">{Math.min(99, props.chatUnreadTotal)}</span> : null}</button>
      <div className="toolbar-popover-anchor combat-log-menu">
        <button type="button" className={`icon-tool${combatLogOpen ? " tool-active" : ""}`} aria-label={`Combat Log${state.combatRolls.length ? `, ${state.combatRolls.length} ${state.combatRolls.length === 1 ? "roll" : "rolls"}` : ""}`} aria-controls="combat-log-panel" aria-expanded={combatLogOpen} data-tooltip="Combat Log" onClick={() => { setCombatLogOpen((open) => !open); setRoundEditorOpen(false); }}><Icon name="combatLog" />{state.combatRolls.length ? <span className="combat-log-count" aria-hidden="true">{Math.min(99, state.combatRolls.length)}</span> : null}</button>
        {combatLogOpen ? <section id="combat-log-panel" className="toolbar-popover combat-log-panel" aria-label="Combat Log">
          <header><span><small>Combat Log</small><strong>{state.combatRolls.length ? `${state.combatRolls.length} ${state.combatRolls.length === 1 ? "roll" : "rolls"}` : "No rolls yet"}</strong></span><IconActionButton variant="close" label="Close Combat Log" onClick={() => setCombatLogOpen(false)} /></header>
          <div className="combat-log-scroll">{state.combatRolls.length ? <ol>{state.combatRolls.map((roll) => { const proposal = state.damageProposals.find((item) => item.rollId === roll.id); return <li key={roll.id}><strong>{roll.attackerName} → {roll.targetName}</strong><span>{roll.action.name}</span><small>{combatOutcomeLabel(roll.outcome)}{roll.damageTotal === null ? "" : ` · ${roll.damageTotal} ${roll.action.damageType}`}{proposal ? ` · ${proposalStatusLabel(proposal.status)}` : ""}</small></li>; })}</ol> : <p>No combat rolls have been made.</p>}</div>
        </section> : null}
      </div>
      <button className={`icon-tool${props.paletteOpen ? " tool-active" : ""}`} aria-label="Creature palette" data-tooltip="Creature palette" aria-pressed={props.paletteOpen} onClick={props.onToggleCreatures}><Icon name="creatures" /></button>
      <button className={`icon-tool${props.spellPaletteOpen ? " tool-active" : ""}`} aria-label="Spell effects" data-tooltip="Spell effects" aria-pressed={props.spellPaletteOpen} onClick={props.onToggleSpells}><Icon name="spells" /></button>
    </div>
    <div className="map-tool-group" role="group" aria-label="Action history"><button className="icon-tool" aria-label="Undo last action" data-tooltip="Undo — Ctrl/Cmd + Z" onClick={() => props.onHistory("undo")} disabled={props.busy || state.undo.available === 0}><Icon name="undo" /></button><button className="icon-tool" aria-label="Redo last action" data-tooltip="Redo — Ctrl + Y or Cmd + Shift + Z" onClick={() => props.onHistory("redo")} disabled={props.busy || state.undo.redoAvailable === 0}><Icon name="redo" /></button></div>
    <div className="encounter-identity"><strong>{state.encounter.name}</strong><span>{state.encounter.status}</span></div>
    <div className="toolbar-popover-anchor round-menu">
      {participant.role === "dm" ? <button type="button" className={`round-counter${roundEditorOpen ? " tool-active" : ""}`} aria-label={canCorrectTurn ? `Round ${state.encounter.currentRound}, correct turn` : state.encounter.currentRound > 0 ? `Current round ${state.encounter.currentRound}` : "Combat has not started"} aria-controls={canCorrectTurn ? "round-editor-panel" : undefined} aria-expanded={canCorrectTurn ? roundEditorOpen : undefined} data-tooltip={canCorrectTurn ? "Correct round and active turn" : undefined} disabled={!canCorrectTurn} onClick={() => { const opening = !roundEditorOpen; setRoundEditorOpen(opening); if (opening) { setRoundDraft(String(Math.max(1, state.encounter.currentRound))); setActiveOrderDraft(state.encounter.activeInitiativeOrder ?? initiativeOrders[0]); } setCombatLogOpen(false); }}><span>Round</span><strong>{state.encounter.currentRound > 0 ? state.encounter.currentRound : "—"}</strong></button>
        : <div className="round-counter" aria-label={state.encounter.currentRound > 0 ? `Current round ${state.encounter.currentRound}` : "Combat has not started"}><span>Round</span><strong>{state.encounter.currentRound > 0 ? state.encounter.currentRound : "—"}</strong></div>}
      {roundEditorOpen && canCorrectTurn ? <section id="round-editor-panel" className="toolbar-popover round-editor-panel" aria-label="Correct turn">
        <header><span><small>Combat position</small><strong>Correct turn</strong></span><IconActionButton variant="close" label="Close turn correction" onClick={() => setRoundEditorOpen(false)} /></header>
        <div className="turn-correction"><label>Round<input aria-label="Correct round" type="text" inputMode="numeric" pattern="[0-9]*" value={roundDraft} onChange={(event) => setRoundDraft(event.target.value.replace(/\D/g, "").slice(0, 4))} /></label><label>Active group<select aria-label="Correct active group" value={activeOrderDraft} onChange={(event) => setActiveOrderDraft(Number(event.target.value))}>{initiativeOrders.map((order) => <option key={order} value={order}>#{order + 1}</option>)}</select></label><button type="button" className="round-editor-apply" disabled={correctedRound === null} onClick={() => { if (correctedRound === null) return; props.onCorrectTurn(correctedRound, activeOrderDraft); setRoundEditorOpen(false); }}>Apply correction</button></div>
      </section> : null}
    </div>
    <div className="map-tool-group viewport-tools" role="group" aria-label="Map view"><button className={`icon-tool${props.viewport.fit ? " tool-active" : ""}`} aria-label="Fit whole map" data-tooltip="Fit whole map — 0" aria-pressed={props.viewport.fit} onClick={props.onFit}><Icon name="fit" /></button><button className="icon-tool" aria-label="Zoom out" data-tooltip="Zoom out — minus" onClick={() => props.onZoom(-0.5)}><Icon name="zoomOut" /></button><button className="zoom-value" aria-label={`Reset zoom to 100%, currently ${zoomPercentage}%`} data-tooltip="Reset zoom to 100%" onClick={props.onResetZoom}>{zoomPercentage}%</button><button className="icon-tool" aria-label="Zoom in" data-tooltip="Zoom in — plus" onClick={() => props.onZoom(0.5)}><Icon name="zoomIn" /></button></div>
    <div className={`connection-pill connection-${props.connection}`} data-tooltip={props.connectionTooltip} role="status" aria-live="polite"><span className="connection-dot" /><em>{props.connectionLabel}</em><span className="visually-hidden">{props.connectionTooltip}</span></div>
    <div className="map-tool-group" role="group" aria-label="Layout">
      <button className="icon-tool" aria-label="Back to campaign home" data-tooltip="Campaign home" onClick={props.onOpenDashboard}><Icon name="home" /></button>
      <UiSettingsMenu menuRef={props.uiSettingsRef} participant={participant} state={state} gridOpacity={props.gridOpacity} showColoredTokenCenters={props.showColoredTokenCenters} showHealthRings={props.showHealthRings} onGridOpacityChange={props.onGridOpacityChange} onColoredTokenCentersChange={props.onColoredTokenCentersChange} onHealthRingsChange={props.onHealthRingsChange} onFogModeChange={props.onFogModeChange} onVisionDoorChange={props.onVisionDoorChange} onStrictMovementChange={props.onStrictMovementChange} />
      <button className={`icon-tool${props.sidebarOpen ? "" : " tool-active"}`} aria-label={props.sidebarOpen ? "Hide encounter panel" : "Show encounter panel"} data-tooltip={"Encounter panel — \\"} aria-pressed={!props.sidebarOpen} onClick={props.onToggleSidebar}><Icon name="sidebar" /></button>
      <button className={`icon-tool${props.presenting ? " tool-active" : ""}`} aria-label="Presentation mode" data-tooltip="Presentation mode — F" aria-pressed={props.presenting} onClick={props.onTogglePresenting}><Icon name="present" /></button>
    </div>
  </div>;
}
