"use client";

import type { DragEvent } from "react";
import NextImage from "next/image";
import IconActionButton from "@/app/icon-action-button";
import { SpellShapeMark } from "@/app/battle-map-ui";
import type { CreatureTemplate } from "@/shared/creature-library";
import type { ParticipantSession, SharedToken } from "@/shared/contracts";
import { SPELL_EFFECTS, type SpellEffectDefinition } from "@/shared/spell-effects";

type CreaturePaletteProps = {
  participant: ParticipantSession;
  tokens: SharedToken[];
  playerCharacter: SharedToken | null;
  creatures: CreatureTemplate[];
  families: string[];
  query: string;
  family: string;
  cursor: string | null;
  loading: boolean;
  error: string;
  armedId: string | null;
  summonerId: string;
  onClose: () => void;
  onSummonerChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onFamilyChange: (value: string) => void;
  onArm: (id: string | null) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, creature: CreatureTemplate) => void;
  onDragEnd: () => void;
  onLoadMore: () => void;
};

export function CreaturePalette({ participant, tokens, playerCharacter, creatures, families, query, family, cursor, loading, error, armedId, summonerId, onClose, onSummonerChange, onQueryChange, onFamilyChange, onArm, onDragStart, onDragEnd, onLoadMore }: CreaturePaletteProps) {
  return <section className="creature-palette" aria-label="Creature palette">
    <div className="palette-heading"><div><small>Quick placement</small><h2>Creature palette</h2></div><IconActionButton variant="close" label="Close creature palette" onClick={onClose} /></div>
    {participant.role === "dm"
      ? <label className="palette-controller">Control<select value={summonerId} onChange={(event) => onSummonerChange(event.target.value)}><option value="">DM-controlled creature</option>{tokens.filter((token) => token.kind === "character" && !token.summonerTokenId).map((token) => <option value={token.id} key={token.id}>Summoned by {token.name}</option>)}</select></label>
      : <p className="palette-controller">Anything you place is summoned by {playerCharacter?.name ?? "your character"} and controlled by you.</p>}
    <div className="palette-search">
      <label><span>Find</span><input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search creatures" autoComplete="off" /></label>
      <label><span>Family</span><select value={family} onChange={(event) => onFamilyChange(event.target.value)}><option value="">All</option>{families.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
    </div>
    <div className="creature-grid">
      {creatures.map((creature) => <button type="button" draggable className={`creature-tile${armedId === creature.id ? " is-armed" : ""}`} key={creature.id} onDragStart={(event) => onDragStart(event, creature)} onDragEnd={onDragEnd} onClick={() => onArm(armedId === creature.id ? null : creature.id)} aria-pressed={armedId === creature.id}>
        <NextImage src={creature.thumbnailAsset} alt="" width={72} height={72} loading="lazy" unoptimized />
        <span><strong>{creature.name}</strong><small>{creature.size} · AC {creature.armorClass} · HP {creature.defaultHp} · {creature.defaultSpeed} ft</small></span>
      </button>)}
    </div>
    {loading && creatures.length === 0 ? <div className="palette-status" role="status">Loading creatures…</div> : null}
    {!loading && !error && creatures.length === 0 ? <div className="palette-status">No matching creatures.</div> : null}
    {error ? <div className="palette-status is-error" role="alert">{error}</div> : null}
    {cursor ? <button className="palette-load-more" onClick={onLoadMore} disabled={loading}>{loading ? "Loading…" : "Load more creatures"}</button> : null}
    {armedId ? <button className="palette-cancel" onClick={() => onArm(null)}>Cancel placement</button> : null}
    <p className="palette-hint">Drag a creature onto the map, or select one and click repeatedly to place copies.</p>
  </section>;
}

type SpellPaletteProps = {
  participant: ParticipantSession;
  playerCharacter: SharedToken | null;
  armedId: string | null;
  onClose: () => void;
  onArm: (id: string | null) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, spell: SpellEffectDefinition) => void;
  onDragEnd: () => void;
};

export function SpellPalette({ participant, playerCharacter, armedId, onClose, onArm, onDragStart, onDragEnd }: SpellPaletteProps) {
  return <section className="spell-palette" aria-label="Spell effects palette">
    <div className="palette-heading"><div><small>Persistent magic</small><h2>Spell effects</h2></div><IconActionButton variant="close" label="Close spell effects" onClick={onClose} /></div>
    <p className="spell-palette-intro">Drag an effect onto the battlefield. It stays live, synchronizes for everyone, and can be repositioned like a token.</p>
    <div className="spell-grid">
      {SPELL_EFFECTS.map((spell) => <button type="button" draggable className={`spell-tile is-${spell.id}${armedId === spell.id ? " is-armed" : ""}`} key={spell.id} onDragStart={(event) => onDragStart(event, spell)} onDragEnd={onDragEnd} onClick={() => onArm(armedId === spell.id ? null : spell.id)} aria-pressed={armedId === spell.id}>
        <span className={`spell-art${spell.shape ? " is-generic-shape" : ""}`}>{spell.shape ? <SpellShapeMark shape={spell.shape} /> : <NextImage src={spell.artAsset} alt="" width={240} height={240} draggable={false} unoptimized />}</span>
        <span className="spell-copy"><small>{spell.areaLabel}</small><strong>{spell.name}</strong><em>{spell.description}</em></span>
      </button>)}
    </div>
    {participant.role === "player" ? <p className="palette-controller">Your effects are controlled by {playerCharacter?.name ?? "your character"}.</p> : <p className="palette-controller">DM effects are controlled by Kevin.</p>}
    {armedId ? <button className="palette-cancel" onClick={() => onArm(null)}>Cancel spell placement</button> : null}
    <p className="palette-hint">Drag onto the map, or select an effect and click to place it.</p>
  </section>;
}
