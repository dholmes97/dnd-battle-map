"use client";

import NextImage from "next/image";
import { useState } from "react";
import IconActionButton from "@/app/icon-action-button";
import { Icon, SpellShapeMark } from "@/app/battle-map-ui";
import type { TokenControls } from "@/app/use-token-controls";
import { CREATURE_SIZES, type CreatureSize } from "@/shared/creature-library";
import type { EncounterState, ParticipantSession, SharedToken } from "@/shared/contracts";
import { displayHealth } from "@/shared/health";
import { initiativePackMembers } from "@/shared/initiative-domain";
import type { MapNote } from "@/shared/map-package";
import { isSpellShapeArt, SPELL_AREA_SIZES, SPELL_EFFECT_KIND, spellAreaDiameter, spellEffectByArt, type SpellAreaSize, type SpellEffectDefinition } from "@/shared/spell-effects";

export type RosterRow =
  | { type: "token"; token: SharedToken; grouped: boolean }
  | { type: "group"; key: string; label: string; tokens: SharedToken[]; expanded: boolean };

function tokenInitial(token: SharedToken) {
  return token.name.split(/\s+/).at(-1)?.charAt(0).toUpperCase() || "T";
}

function artLabel(path: string) {
  return path.split("/").at(-1)?.replace(/-01\.png$/, "").replaceAll("-", " ") ?? "Artwork";
}

function isPendingCreate(token: SharedToken) {
  return token.id.startsWith("pending-create-");
}

function secondaryMovementLabel(token: SharedToken) {
  const speeds: Array<[string, number | null]> = [
    ["Fly", token.flySpeed],
    ["Swim", token.swimSpeed],
    ["Climb", token.climbSpeed],
    ["Burrow", token.burrowSpeed],
  ];
  return speeds.flatMap(([label, speed]) => speed !== null && speed > 0 ? [`${label} ${speed} ft`] : [])
    .join(" · ");
}

function spellFootprintLabel(spell: SpellEffectDefinition, size: CreatureSize) {
  const diameter = spellAreaDiameter(size);
  if (spell.shape === "square") return `${diameter}-ft square`;
  if (spell.id === "magic-circle") return `${diameter}-ft diameter · ${diameter / 2}-ft radius`;
  return `${diameter}-ft diameter`;
}

type EncounterSidebarProps = {
  participant: ParticipantSession;
  state: EncounterState;
  hidden: boolean;
  inCombat: boolean;
  rosterFilter: string;
  rosterRows: RosterRow[];
  selectedToken: SharedToken | null;
  selectedSpell: SpellEffectDefinition | null;
  selectedMapNote: MapNote | null;
  activeOwnTurnToken: SharedToken | null;
  activeOwnTurnIsGroup: boolean;
  initiativeTokens: SharedToken[];
  encounterAction: "pause" | "resume" | "reset" | null;
  controls: TokenControls;
  onRosterFilterChange: (value: string) => void;
  onToggleGroup: (key: string) => void;
  onSelectToken: (id: string) => void;
  onCloseMapNote: () => void;
  onResizeSpell: (token: SharedToken, spell: SpellEffectDefinition, size: SpellAreaSize) => void;
  onDeleteToken: (token: SharedToken) => void;
  canMoveToken: (token: SharedToken) => boolean;
  onHideToken: (token: SharedToken) => void;
  onEndTurn: (token: SharedToken) => void;
  onStartOrRestart: () => void;
  onAdvanceTurn: () => void;
  onPauseOrResume: () => void;
  onRequestReset: () => void;
  onCorrectTurn: (round: number, order: number) => void;
};

export function EncounterSidebar({ participant, state, hidden, inCombat, rosterFilter, rosterRows, selectedToken, selectedSpell, selectedMapNote, activeOwnTurnToken, activeOwnTurnIsGroup, initiativeTokens, encounterAction, controls, onRosterFilterChange, onToggleGroup, onSelectToken, onCloseMapNote, onResizeSpell, onDeleteToken, canMoveToken, onHideToken, onEndTurn, onStartOrRestart, onAdvanceTurn, onPauseOrResume, onRequestReset, onCorrectTurn }: EncounterSidebarProps) {
  const [initiativeEditorKey, setInitiativeEditorKey] = useState<string | null>(null);
  const playerCharacter = participant.role === "player"
    ? state.tokens.find((token) => token.kind === "character" && !token.summonerTokenId && token.controlledByViewer) ?? null
    : null;
  const hpStep = /^\d+$/.test(controls.hpAmount) && Number(controls.hpAmount) > 0
    ? Math.trunc(Number(controls.hpAmount))
    : null;
  const healthBar = (token: SharedToken) => {
    const health = displayHealth(token.hp, token.maxHp, token.healthState);
    if (!health) return <span className="roster-health is-unknown" aria-hidden="true" />;
    return <span className={`roster-health is-${health.band}`} title={health.label ?? undefined}><span className="roster-health-fill" style={{ width: `${Math.round(health.ratio * 100)}%`, background: health.color }} /></span>;
  };
  const beginInitiativeEdit = (draftKey: string, initiative: number | null) => {
    setInitiativeEditorKey(draftKey);
    controls.setInitiativeDrafts((current) => ({ ...current, [draftKey]: initiative === null ? "" : String(initiative) }));
    controls.setInitiativeStatuses((current) => ({ ...current, [draftKey]: "editing" }));
  };
  const cancelInitiativeEdit = (draftKey: string) => {
    setInitiativeEditorKey(null);
    controls.setInitiativeDrafts((current) => { const next = { ...current }; delete next[draftKey]; return next; });
    controls.setInitiativeStatuses((current) => { const next = { ...current }; delete next[draftKey]; return next; });
  };
  const rosterRow = (token: SharedToken, grouped: boolean) => {
    const selected = token.id === selectedToken?.id;
    const active = token.initiativeOrder !== null && token.initiativeOrder === state.encounter.activeInitiativeOrder;
    const pending = isPendingCreate(token);
    return <div className="roster-row-shell" role="listitem" key={token.id}>
      <button type="button" className={`roster-row${selected ? " is-selected" : ""}${active ? " is-active" : ""}${token.turnComplete ? " is-complete" : ""}${grouped ? " is-grouped" : ""}${token.controlledByViewer ? " is-mine" : ""}`} aria-pressed={selected} disabled={pending} onClick={() => onSelectToken(token.id)}>
        {token.artAsset && !isSpellShapeArt(token.artAsset) ? <NextImage className="roster-portrait" src={token.artAsset} alt="" width={44} height={44} unoptimized /> : token.kind === SPELL_EFFECT_KIND && spellEffectByArt(token.artAsset)?.shape ? <SpellShapeMark className="roster-portrait roster-spell-shape" shape={spellEffectByArt(token.artAsset)!.shape!} /> : <span className="roster-portrait roster-initial">{tokenInitial(token)}</span>}
        <span className="roster-name">{token.name}{token.hidden ? <em> · hidden</em> : null}</span>{healthBar(token)}
        <span className="roster-hp">{token.hp !== null && token.maxHp !== null ? `${token.hp}/${token.maxHp}` : ""}</span>
        {token.effects.length ? <span className={`roster-effects${token.effects.some((effect) => effect.due) ? " is-due" : ""}`}>{token.effects.length}</span> : null}
      </button>
      {token.controlledByViewer ? initiativeEditorKey === token.id
        ? <input autoFocus className="roster-initiative-input" aria-label={`Initiative for ${token.name}`} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={controls.initiativeDrafts[token.id] ?? token.initiative ?? ""} onChange={(event) => { const next = event.target.value.replace(/\D/g, "").slice(0, 2); controls.setInitiativeDrafts((current) => ({ ...current, [token.id]: next })); controls.setInitiativeStatuses((current) => ({ ...current, [token.id]: "editing" })); }} onBlur={() => { setInitiativeEditorKey(null); void controls.saveInitiative(token); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") cancelInitiativeEdit(token.id); }} disabled={pending} />
        : <button type="button" className="roster-initiative-trigger" aria-label={`${token.initiative === null ? "Enter" : "Edit"} initiative for ${token.name}${token.initiative === null ? "" : `, currently ${token.initiative}`}`} data-tooltip={token.initiative === null ? "Enter initiative" : "Edit initiative"} disabled={pending} onClick={() => beginInitiativeEdit(token.id, token.initiative)}>{token.initiative ?? "—"}</button>
        : <span className="roster-initiative">{token.initiative ?? "—"}</span>}
    </div>;
  };

  const tokenDetails = (token: SharedToken) => <TokenDetails participant={participant} state={state} token={token} health={displayHealth(token.hp, token.maxHp, token.healthState)} hpStep={hpStep} controls={controls} onHideToken={onHideToken} onDeleteToken={onDeleteToken} />;
  const selectedCard = selectedMapNote ? <section className="map-note-detail" aria-label={`DM note ${state.encounter.mapPackage!.notes.findIndex((note) => note.id === selectedMapNote.id) + 1}`}><div className="map-note-heading"><div><small>Private map note</small><h2>Note {state.encounter.mapPackage!.notes.findIndex((note) => note.id === selectedMapNote.id) + 1}</h2></div><IconActionButton variant="close" label="Close DM note" onClick={onCloseMapNote} /></div><p>{selectedMapNote.text}</p></section>
    : selectedToken && selectedSpell ? <section className={`spell-detail is-${selectedSpell.id}`} aria-label={`${selectedToken.name} spell effect details`}><div className={`spell-detail-visual${selectedSpell.shape ? " is-generic-shape" : ""}`}>{selectedSpell.shape ? <SpellShapeMark shape={selectedSpell.shape} /> : <NextImage src={selectedSpell.artAsset} alt="" width={180} height={180} unoptimized />}</div><div className="spell-detail-copy"><small>Persistent spell · controlled by {selectedToken.controller.name}</small><h2>{selectedToken.name}</h2><p>{selectedSpell.description}</p></div><div className="spell-detail-meta"><span><small>Area</small><strong>{spellFootprintLabel(selectedSpell, selectedToken.size)}</strong></span><span><small>Movement</small><strong>{canMoveToken(selectedToken) ? "Drag directly" : `Owner only · ${selectedToken.controller.name}`}</strong></span></div>{selectedToken.controlledByViewer ? <label className="spell-size-control">Footprint<select aria-label="Spell footprint size" value={SPELL_AREA_SIZES.includes(selectedToken.size as SpellAreaSize) ? selectedToken.size : "medium"} onChange={(event) => onResizeSpell(selectedToken, selectedSpell, event.target.value as SpellAreaSize)}>{SPELL_AREA_SIZES.map((size) => <option value={size} key={size}>{selectedSpell.shape === "square" ? `${spellAreaDiameter(size)}-ft square` : `${spellAreaDiameter(size)}-ft diameter`}</option>)}</select></label> : null}{selectedToken.controlledByViewer ? <button className="dismiss-spell-button" onClick={() => onDeleteToken(selectedToken)}>Dismiss {selectedSpell.name}</button> : null}</section>
      : selectedToken ? tokenDetails(selectedToken) : null;
  const playerSelectionCard = selectedToken?.id === playerCharacter?.id ? null : selectedCard;

  return <aside className={`control-panel${participant.role === "player" ? " is-player" : ""}`} aria-label="Encounter controls" hidden={hidden}>
    <div className="panel-head"><div className="participant-row"><span className="participant-avatar">{participant.name.charAt(0).toUpperCase()}</span><span><small>{participant.role === "dm" ? "Dungeon Master" : "Joined as"}</small><strong>{participant.name}</strong></span></div><span className="panel-round">{state.tokens.length} tokens</span></div>
    <label className="roster-filter"><Icon name="search" /><input type="search" value={rosterFilter} onChange={(event) => onRosterFilterChange(event.target.value)} placeholder={inCombat ? "Filter turn order" : "Filter tokens"} aria-label="Filter tokens" autoComplete="off" /></label>
    <div className="token-roster" role="list" aria-label={inCombat ? "Turn order" : "Tokens"}>
      {rosterRows.length === 0 ? <p className="empty-copy">No tokens match “{rosterFilter}”.</p> : null}
      {rosterRows.map((row) => row.type === "group" ? <div className={`roster-group${row.tokens[0].initiativeOrder !== null && row.tokens[0].initiativeOrder === state.encounter.activeInitiativeOrder ? " is-active" : ""}`} key={row.key}>
        <div className="roster-row-shell" role="listitem">
          <button type="button" className="roster-row is-group" aria-expanded={row.expanded} onClick={() => onToggleGroup(row.key)}>
            {row.tokens[0].artAsset && !isSpellShapeArt(row.tokens[0].artAsset) ? <NextImage className="roster-portrait" src={row.tokens[0].artAsset} alt="" width={44} height={44} unoptimized /> : row.tokens[0].kind === SPELL_EFFECT_KIND && spellEffectByArt(row.tokens[0].artAsset)?.shape ? <SpellShapeMark className="roster-portrait roster-spell-shape" shape={spellEffectByArt(row.tokens[0].artAsset)!.shape!} /> : <span className="roster-portrait roster-initial">{tokenInitial(row.tokens[0])}</span>}
            <span className="roster-name">{row.label}<em> ×{row.tokens.length}</em></span><span className="roster-group-toggle">{row.expanded ? "Hide" : "Show"}</span>
          </button>
          {row.tokens[0].controlledByViewer ? initiativeEditorKey === `group:${row.key}`
            ? <input autoFocus className="roster-initiative-input" aria-label={`Initiative for ${row.label} group`} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={controls.initiativeDrafts[`group:${row.key}`] ?? row.tokens[0].initiative ?? ""} onChange={(event) => { const next = event.target.value.replace(/\D/g, "").slice(0, 2); controls.setInitiativeDrafts((current) => ({ ...current, [`group:${row.key}`]: next })); controls.setInitiativeStatuses((current) => ({ ...current, [`group:${row.key}`]: "editing" })); }} onBlur={() => { setInitiativeEditorKey(null); void controls.saveInitiativeGroup(row.key, row.tokens); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") cancelInitiativeEdit(`group:${row.key}`); }} />
            : <button type="button" className="roster-initiative-trigger" aria-label={`${row.tokens[0].initiative === null ? "Enter" : "Edit"} initiative for ${row.label} group${row.tokens[0].initiative === null ? "" : `, currently ${row.tokens[0].initiative}`}`} data-tooltip={row.tokens[0].initiative === null ? "Enter group initiative" : "Edit group initiative"} onClick={() => beginInitiativeEdit(`group:${row.key}`, row.tokens[0].initiative)}>{row.tokens[0].initiative ?? "—"}</button>
            : <span className="roster-initiative">{row.tokens[0].initiative ?? "—"}</span>}
        </div>
      </div> : rosterRow(row.token, row.grouped))}
    </div>
    {participant.role === "player" && playerCharacter ? <div className={`player-card-stack${playerSelectionCard ? " has-selection" : ""}`} role="group" aria-label="Your character and selection">
      {playerSelectionCard ? <div className="player-card-layer is-selection">{playerSelectionCard}</div> : null}
      <div className="player-card-layer is-character">{tokenDetails(playerCharacter)}</div>
    </div> : selectedCard}
    <div className="panel-foot">
      {activeOwnTurnToken && participant.role !== "dm" ? <button className="end-turn-button" onClick={() => onEndTurn(activeOwnTurnToken)}>{activeOwnTurnIsGroup ? "End Group Turn" : "End Turn"}</button> : null}
      {participant.role === "dm" ? <><div className="button-row"><button className="primary-button" aria-describedby="restart-combat-help" data-tooltip={inCombat ? "Start again at round 1 using the current initiative. Keeps the map, tokens, HP, effects, and initiative values." : "Begin combat at round 1 using the entered initiative values."} onClick={onStartOrRestart}>{inCombat ? "Restart combat" : "Start combat"}</button><span id="restart-combat-help" className="visually-hidden">Restart begins combat again at round 1 using the current initiative values while preserving the map, tokens, HP, and effects.</span><button className="secondary-button" onClick={onAdvanceTurn} disabled={!inCombat}>Advance</button></div>
        <div className="button-row encounter-state-controls"><button className={`secondary-button${encounterAction === "pause" || encounterAction === "resume" ? " is-pending" : ""}`} aria-busy={encounterAction === "pause" || encounterAction === "resume"} aria-describedby="pause-encounter-help" data-tooltip="Temporarily freezes movement and turn advancement. The current round and initiative are preserved." disabled={encounterAction !== null || state.encounter.status === "setup"} onClick={onPauseOrResume}>{encounterAction === "pause" ? "Pausing…" : encounterAction === "resume" ? "Resuming…" : state.encounter.status === "paused" ? "Resume" : "Pause"}</button><span id="pause-encounter-help" className="visually-hidden">Temporarily freezes movement and turn advancement while preserving the current round and initiative.</span><button className={`secondary-button${encounterAction === "reset" ? " is-pending" : ""}`} aria-busy={encounterAction === "reset"} aria-describedby="reset-encounter-help" data-tooltip="Exit combat and return to setup. Clears the round, active turn, and movement tracking; keeps the map, tokens, HP, effects, and initiative values." disabled={encounterAction !== null || state.encounter.status === "setup"} onClick={onRequestReset}>{encounterAction === "reset" ? "Resetting…" : "Reset"}</button><span id="reset-encounter-help" className="visually-hidden">Reset exits combat and returns the encounter to setup while preserving the map, tokens, HP, effects, and initiative values.</span></div>
        {initiativeTokens.length ? <details className="turn-correction-details"><summary>Correct turn</summary><div className="turn-correction"><label>Round<input type="number" min="1" value={Math.max(1, state.encounter.currentRound)} onChange={(event) => onCorrectTurn(Number(event.target.value), state.encounter.activeInitiativeOrder ?? 0)} /></label><label>Active group<select value={state.encounter.activeInitiativeOrder ?? 0} onChange={(event) => onCorrectTurn(Math.max(1, state.encounter.currentRound), Number(event.target.value))}>{[...new Set(initiativeTokens.map((token) => token.initiativeOrder))].map((order) => <option key={order} value={order ?? 0}>#{(order ?? 0) + 1}</option>)}</select></label></div></details> : null}</> : null}
    </div>
  </aside>;
}

function TokenDetails({ participant, state, token, health, hpStep, controls, onHideToken, onDeleteToken }: { participant: ParticipantSession; state: EncounterState; token: SharedToken; health: ReturnType<typeof displayHealth>; hpStep: number | null; controls: TokenControls; onHideToken: (token: SharedToken) => void; onDeleteToken: (token: SharedToken) => void }) {
  const controlled = token.controlledByViewer;
  const packMembers = initiativePackMembers(token, state.tokens);
  const secondaryMovement = secondaryMovementLabel(token);
  return <section className="token-detail" aria-label={`${token.name} details`}>
    {controlled && controls.tokenEditorTokenId === token.id ? <div className="token-config"><div className="token-config-toolbar"><small>Edit token details</small><span className="token-config-actions"><IconActionButton variant="discard" label="Discard token detail changes" title="Discard changes" onClick={() => controls.discardTokenDetails(token.id)} /><button className="token-config-save" aria-label="Save token details" title="Save details" onClick={() => void controls.saveTokenDetails(token)}><Icon name="check" /></button></span></div><input aria-label="Token name" value={controls.tokenDrafts[token.id]?.name ?? token.name} onChange={(event) => controls.setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], name: event.target.value } }))} /><div className="form-grid"><label>Size<select aria-label="Token size" value={controls.tokenDrafts[token.id]?.size ?? token.size} onChange={(event) => controls.setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], size: event.target.value as CreatureSize } }))}>{CREATURE_SIZES.map((size) => <option value={size} key={size}>{size.charAt(0).toUpperCase() + size.slice(1)}</option>)}</select></label><label>Speed<input aria-label="Token speed" type="number" value={controls.tokenDrafts[token.id]?.speed ?? token.speed} onChange={(event) => controls.setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], speed: event.target.value } }))} /></label><label>AC<input aria-label="Token armor class" type="number" min="1" max="40" value={controls.tokenDrafts[token.id]?.armorClass ?? token.armorClass ?? ""} onChange={(event) => controls.setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], armorClass: event.target.value } }))} /></label><label>Max HP<input aria-label="Token maximum HP" type="number" value={controls.tokenDrafts[token.id]?.maxHp ?? token.maxHp ?? ""} onChange={(event) => controls.setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], maxHp: event.target.value } }))} /></label></div><label>Portrait<select aria-label="Token portrait" value={controls.tokenDrafts[token.id]?.artAsset ?? token.artAsset ?? ""} onChange={(event) => controls.setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], artAsset: event.target.value } }))}><option value="">No portrait</option>{state.availableArt.map((path) => <option value={path} key={path}>{artLabel(path)}</option>)}</select></label></div>
      : <><div className="token-heading">{token.artAsset ? <NextImage className="token-portrait" src={token.artAsset} alt="" width={48} height={48} unoptimized /> : <span className="token-mini">{tokenInitial(token)}</span>}<div><small>{`${token.hidden ? "Hidden · " : ""}${token.kind} · controlled by ${token.controller.name}`}</small><h2>{token.name}</h2></div></div><div className="token-meta"><span><small>Size</small><strong>{token.size.charAt(0).toUpperCase() + token.size.slice(1)}</strong></span><span><small>Speed</small><strong className={secondaryMovement ? "has-speed-tooltip" : undefined} title={secondaryMovement || undefined} aria-label={secondaryMovement ? `Walk ${token.speed} ft. ${secondaryMovement.replaceAll(" · ", ". ")}.` : undefined} tabIndex={secondaryMovement ? 0 : undefined}>{token.speed} ft</strong></span><span><small>AC</small><strong>{token.armorClass ?? "—"}</strong></span><span><small>HP</small><strong>{health?.label ?? "—"}</strong></span></div></>}
    {participant.role === "dm" && packMembers.length > 1 ? <div className="initiative-pack-note"><span>{token.initiativeGroupId ? `Shared with ${packMembers.length - 1} matching ${packMembers.length === 2 ? "creature" : "creatures"}.` : `Changes apply to all ${packMembers.length} matching creatures.`}</span>{token.initiativeGroupId ? <button className="inline-action" onClick={() => controls.splitInitiativePack(token)}>Split from group</button> : null}</div> : null}
    {controlled && token.hp !== null && token.maxHp !== null ? <div className="hp-panel"><div className="hp-readout"><strong>HP {token.hp}/{token.maxHp}</strong><span className={`hp-track is-${health?.band ?? "unharmed"}`}><span className="hp-track-fill" style={{ width: `${Math.round((health?.ratio ?? 0) * 100)}%`, background: health?.color }} /></span></div><div className="hp-row"><input aria-label="HP change amount" aria-invalid={controls.hpAmount !== "" && hpStep === null} title="HP amount" placeholder="HP" type="text" inputMode="numeric" pattern="[0-9]*" value={controls.hpAmount} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} onChange={(event) => controls.setHpAmount(event.target.value.replace(/\D/g, "").slice(0, 3))} onKeyDown={(event) => { if (event.key === "Enter" && hpStep !== null) void controls.applyHpToToken(token, -hpStep); }} /><button className="hp-apply is-damage" aria-label={hpStep === null ? `Enter an HP amount before damaging ${token.name}` : `Apply ${hpStep} damage to ${token.name}`} data-tooltip={hpStep === null ? "Enter an HP amount" : `Damage ${hpStep} HP`} disabled={hpStep === null} onClick={() => { if (hpStep !== null) void controls.applyHpToToken(token, -hpStep); }}><Icon name="damage" /></button><button className="hp-apply is-heal" aria-label={hpStep === null ? `Enter an HP amount before healing ${token.name}` : `Heal ${token.name} for ${hpStep}`} data-tooltip={hpStep === null ? "Enter an HP amount" : `Heal ${hpStep} HP`} disabled={hpStep === null} onClick={() => { if (hpStep !== null) void controls.applyHpToToken(token, hpStep); }}><Icon name="heal" /></button></div></div> : null}
    <div className="effect-list">{token.effects.map((effect) => <span className={effect.due ? "effect-chip is-due" : "effect-chip"} key={effect.id}>{effect.name}{effect.expiresRound ? ` · R${effect.expiresRound}` : ""}{controlled ? <IconActionButton variant="remove" label={`Remove ${effect.name}`} onClick={() => controls.removeEffectFromToken(token.id, effect.id)} /> : null}</span>)}</div>
    {controlled && controls.effectEditorTokenId !== token.id ? <button className="inline-action effect-editor-toggle" onClick={() => { controls.setEffectEditorTokenId(token.id); controls.setEffectName(""); }}>+ Effect</button> : null}
    {controlled && controls.effectEditorTokenId === token.id ? <div className="compact-form effect-form"><select aria-label="Effect preset" defaultValue="" onChange={(event) => { const preset = event.target.value; if (preset === "bless") { controls.setEffectName("Bless"); controls.setEffectType("concentration"); controls.setEffectDuration("10"); } else if (preset === "poisoned") { controls.setEffectName("Poisoned"); controls.setEffectType("condition"); controls.setEffectDuration("1"); } else if (preset === "stunned") { controls.setEffectName("Stunned"); controls.setEffectType("condition"); controls.setEffectDuration("1"); } }}><option value="">Preset…</option><option value="bless">Bless</option><option value="poisoned">Poisoned</option><option value="stunned">Stunned</option></select><input aria-label="Effect name" placeholder="Custom effect" value={controls.effectName} onChange={(event) => controls.setEffectName(event.target.value)} /><select aria-label="Effect type" value={controls.effectType} onChange={(event) => controls.setEffectType(event.target.value)}><option value="condition">Condition</option><option value="effect">Effect</option><option value="concentration">Concentration</option></select><select aria-label="Reminder timing" value={controls.effectReminder} onChange={(event) => controls.setEffectReminder(event.target.value)}><option value="start">Start of turn</option><option value="end">End of turn</option></select><input aria-label="Duration rounds" type="number" min="1" max="99" value={controls.effectDuration} onChange={(event) => controls.setEffectDuration(event.target.value)} /><button onClick={() => void controls.addEffectToToken(token.id)} disabled={!controls.effectName.trim()}>Add</button><button className="effect-editor-cancel" onClick={() => { controls.setEffectEditorTokenId(null); controls.setEffectName(""); }}>Cancel</button></div> : null}
    {controlled ? <div className="movement-summary"><span>Movement</span><strong>{token.movementUsed}/{token.speed} ft</strong><label className="altitude-control"><span>Altitude</span><span className="altitude-input"><input aria-label={`${token.name} altitude`} type="text" inputMode="numeric" pattern="[0-9]*" value={controls.altitudeDrafts[token.id] ?? token.altitude} onChange={(event) => controls.setAltitudeDrafts((current) => ({ ...current, [token.id]: event.target.value }))} onBlur={() => void controls.saveAltitude(token)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { controls.setAltitudeDrafts((current) => { const next = { ...current }; delete next[token.id]; return next; }); event.currentTarget.blur(); } }} /><span>ft</span></span></label></div> : <div className="movement-summary"><span>Altitude</span><strong>{token.altitude > 0 ? `${token.altitude} ft` : "Ground"}</strong></div>}
    {controlled ? <div className="token-actions">{controls.tokenEditorTokenId !== token.id ? <button className="inline-action" onClick={() => controls.setTokenEditorTokenId(token.id)}>Edit details</button> : null}{participant.role === "dm" ? <><button className="inline-action" onClick={() => onHideToken(token)}>{token.hidden ? "Reveal" : "Hide"}</button>{controls.pendingDeleteTokenId === token.id ? <><button className="inline-action is-danger is-confirming" onClick={() => { controls.setPendingDeleteTokenId(null); onDeleteToken(token); }}>Confirm delete</button><button className="inline-action" onClick={() => controls.setPendingDeleteTokenId(null)}>Keep</button></> : <button className="inline-action is-danger" onClick={() => controls.setPendingDeleteTokenId(token.id)}>Delete</button>}</> : null}</div> : null}
  </section>;
}
