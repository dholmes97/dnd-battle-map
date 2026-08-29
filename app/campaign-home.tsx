"use client";

import { useState } from "react";
import Image from "next/image";
import type { JoinIdentity } from "@/app/join-screen";
import type { EncounterSummary } from "@/app/encounter-summary";
import type { CampaignAccessSummary, CampaignMemberSummary } from "@/shared/campaigns";
import {
  DAMAGE_TYPES,
  SUPPORTED_DIE_SIDES,
  formatDiceFormula,
  type CombatActionProfile,
  type CombatActionValues,
} from "@/shared/combat-rolling";

const DM_PARTY_PORTRAIT = "/assets/party-portraits/dungeon-master-v1.webp";

function formatUpdatedAt(updatedAt: number) {
  if (!updatedAt) return "Ready to prepare";
  return `Updated ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(updatedAt)}`;
}

function statusLabel(status: EncounterSummary["status"]) {
  if (status === "active") return "In combat";
  if (status === "paused") return "Paused";
  return "Ready";
}

function PartyMemberCard({ member }: { member: CampaignMemberSummary }) {
  const portraitCharacter = member.characters.find((character) => character.artAsset);
  const portraitAsset = portraitCharacter?.artAsset ?? (member.role === "dm" ? DM_PARTY_PORTRAIT : null);
  const portraitLabel = portraitCharacter ? `${portraitCharacter.name} portrait` : `${member.identity.displayName}, Dungeon Master portrait`;
  return <article className="campaign-member-card">
    <div className={`campaign-member-portrait${member.role === "dm" ? " is-dm" : ""}`}>
      {portraitAsset ? <Image src={portraitAsset} alt={portraitLabel} fill sizes="(max-width: 560px) 44vw, (max-width: 850px) 38vw, 14rem" unoptimized /> : <span aria-hidden="true">{member.identity.displayName.slice(0, 1)}</span>}
    </div>
    <div className="campaign-member-copy"><div className="campaign-member-heading"><strong>{member.identity.displayName}</strong><span>{member.role === "dm" ? "Dungeon Master" : "Player"}</span></div>{member.characters.length ? <ul>{member.characters.map((character) => <li key={character.id}>{character.name}{character.className ? ` · ${character.className}` : ""}</li>)}</ul> : member.role === "player" ? <small>No character added yet</small> : <small>Keeper of the campaign</small>}</div>
  </article>;
}

type ActionDraft = {
  name: string; attackBonus: string; attackKind: "melee" | "ranged";
  count: string; sides: string; modifier: string; damageType: string;
  reachFeet: string; rangeFeet: string; manualRider: boolean;
  alternate: boolean; alternateLabel: string; alternateCount: string; alternateSides: string; alternateModifier: string;
};

const EMPTY_ACTION: ActionDraft = {
  name: "", attackBonus: "0", attackKind: "melee", count: "1", sides: "8", modifier: "0",
  damageType: "slashing", reachFeet: "5", rangeFeet: "", manualRider: false,
  alternate: false, alternateLabel: "Two-handed", alternateCount: "1", alternateSides: "10", alternateModifier: "0",
};

function CharacterCombatActions({ campaign, pending, onSave, onDelete }: {
  campaign: CampaignAccessSummary;
  pending: boolean;
  onSave(input: { characterId: string; actionId?: string; values: CombatActionValues }): Promise<boolean>;
  onDelete(actionId: string): Promise<boolean>;
}) {
  const [characterId, setCharacterId] = useState(campaign.characters[0]?.id ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ActionDraft>(EMPTY_ACTION);
  const character = campaign.characters.find((item) => item.id === characterId) ?? campaign.characters[0] ?? null;
  const actions = character?.combatActions ?? [];
  const begin = (action?: CombatActionProfile) => {
    setEditingId(action?.id ?? "new");
    setDraft(action ? {
      name: action.name, attackBonus: String(action.attackBonus), attackKind: action.attackKind,
      count: String(action.damage.count), sides: String(action.damage.sides), modifier: String(action.damage.modifier),
      damageType: action.damageType, reachFeet: action.reachFeet === null ? "" : String(action.reachFeet),
      rangeFeet: action.rangeFeet === null ? "" : String(action.rangeFeet), manualRider: action.manualRider,
      alternate: Boolean(action.alternateDamage), alternateLabel: action.alternateDamage?.label ?? "Two-handed",
      alternateCount: String(action.alternateDamage?.formula.count ?? 1), alternateSides: String(action.alternateDamage?.formula.sides ?? 10),
      alternateModifier: String(action.alternateDamage?.formula.modifier ?? action.damage.modifier),
    } : { ...EMPTY_ACTION });
  };
  const values = (): CombatActionValues | null => {
    const numbers = [draft.attackBonus, draft.count, draft.sides, draft.modifier].map(Number);
    if (!numbers.every(Number.isInteger) || !draft.name.trim()) return null;
    const [attackBonus, count, sides, modifier] = numbers;
    const alternateNumbers = [draft.alternateCount, draft.alternateSides, draft.alternateModifier].map(Number);
    if (draft.alternate && !alternateNumbers.every(Number.isInteger)) return null;
    return {
      name: draft.name.trim(), attackBonus, attackKind: draft.attackKind,
      damage: { count, sides: sides as 4 | 6 | 8 | 10 | 12 | 20, modifier },
      damageType: draft.damageType as CombatActionValues["damageType"],
      reachFeet: draft.reachFeet === "" ? null : Number(draft.reachFeet),
      rangeFeet: draft.rangeFeet === "" ? null : Number(draft.rangeFeet),
      manualRider: draft.manualRider,
      alternateDamage: draft.alternate ? {
        label: draft.alternateLabel.trim() || "Alternate",
        formula: { count: alternateNumbers[0], sides: alternateNumbers[1] as 4 | 6 | 8 | 10 | 12 | 20, modifier: alternateNumbers[2] },
      } : null,
    };
  };
  if (!character) return null;
  return <section className="campaign-combat-actions" aria-labelledby="combat-actions-title"><div className="campaign-section-heading"><div><div className="eyebrow">Tactical mirror</div><h2 id="combat-actions-title">Combat actions</h2></div><button className="campaign-create-button" type="button" onClick={() => begin()}>+ Action</button></div><p>Keep only the attack bonus and damage formula needed for map rolls. D&amp;D Beyond remains the complete character sheet.</p>{campaign.characters.length > 1 ? <label>Character<select value={character.id} onChange={(event) => { setCharacterId(event.target.value); setEditingId(null); }} disabled={pending}>{campaign.characters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <strong>{character.name}</strong>}<div className="campaign-action-list">{actions.length ? actions.map((action) => <article key={action.id}><div><strong>{action.name}</strong><span>{action.attackBonus >= 0 ? "+" : ""}{action.attackBonus} · {formatDiceFormula(action.damage)} {action.damageType}{action.manualRider ? " · manual rider" : ""}</span></div><button onClick={() => begin(action)}>Edit</button><button className="is-danger" disabled={pending} onClick={() => void onDelete(action.id)}>Delete</button></article>) : <p>No maintained actions yet.</p>}</div>{editingId ? <form className="campaign-action-editor" onSubmit={(event) => { event.preventDefault(); const next = values(); if (!next) return; void onSave({ characterId: character.id, actionId: editingId === "new" ? undefined : editingId, values: next }).then((saved) => { if (saved) setEditingId(null); }); }}><label>Action name<input autoFocus maxLength={64} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label><label>Attack bonus<input type="number" min="-20" max="30" value={draft.attackBonus} onChange={(event) => setDraft((current) => ({ ...current, attackBonus: event.target.value }))} /></label><label>Kind<select value={draft.attackKind} onChange={(event) => setDraft((current) => ({ ...current, attackKind: event.target.value as "melee" | "ranged" }))}><option value="melee">Melee</option><option value="ranged">Ranged</option></select></label><label>Dice count<input type="number" min="0" max="20" value={draft.count} onChange={(event) => setDraft((current) => ({ ...current, count: event.target.value }))} /></label><label>Die<select value={draft.sides} onChange={(event) => setDraft((current) => ({ ...current, sides: event.target.value }))}>{SUPPORTED_DIE_SIDES.map((side) => <option key={side} value={side}>d{side}</option>)}</select></label><label>Damage modifier<input type="number" min="-50" max="100" value={draft.modifier} onChange={(event) => setDraft((current) => ({ ...current, modifier: event.target.value }))} /></label><label>Damage type<select value={draft.damageType} onChange={(event) => setDraft((current) => ({ ...current, damageType: event.target.value }))}>{DAMAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label>Reach (ft)<input type="number" min="0" value={draft.reachFeet} onChange={(event) => setDraft((current) => ({ ...current, reachFeet: event.target.value }))} /></label><label>Range (ft)<input type="number" min="0" value={draft.rangeFeet} onChange={(event) => setDraft((current) => ({ ...current, rangeFeet: event.target.value }))} /></label><label className="campaign-action-check"><input type="checkbox" checked={draft.manualRider} onChange={(event) => setDraft((current) => ({ ...current, manualRider: event.target.checked }))} />Manual rider</label><label className="campaign-action-check"><input type="checkbox" checked={draft.alternate} onChange={(event) => setDraft((current) => ({ ...current, alternate: event.target.checked }))} />Alternate damage</label>{draft.alternate ? <><label>Alternate label<input value={draft.alternateLabel} onChange={(event) => setDraft((current) => ({ ...current, alternateLabel: event.target.value }))} /></label><label>Alt dice count<input type="number" min="0" max="20" value={draft.alternateCount} onChange={(event) => setDraft((current) => ({ ...current, alternateCount: event.target.value }))} /></label><label>Alt die<select value={draft.alternateSides} onChange={(event) => setDraft((current) => ({ ...current, alternateSides: event.target.value }))}>{SUPPORTED_DIE_SIDES.map((side) => <option key={side} value={side}>d{side}</option>)}</select></label><label>Alt modifier<input type="number" value={draft.alternateModifier} onChange={(event) => setDraft((current) => ({ ...current, alternateModifier: event.target.value }))} /></label></> : null}<div className="campaign-action-editor-buttons"><button type="button" onClick={() => setEditingId(null)}>Cancel</button><button className="primary-button" disabled={pending || !values()}>{pending ? "Saving…" : "Save action"}</button></div></form> : null}</section>;
}

export function CampaignHome({ identity, campaign, invitedIdentities, loading, openingCode, openingDestination, renamingCode, error, notice, creating, campaignMutationPending, onOpenEncounter, onSetupEncounter, onCreateEncounter, onRenameEncounter, onRenameCampaign, onAddPlayer, onSaveCombatAction, onDeleteCombatAction, onBackToCampaigns, onSignOut }: {
  identity: JoinIdentity;
  campaign: CampaignAccessSummary;
  invitedIdentities: JoinIdentity[];
  loading: boolean;
  openingCode: string | null;
  openingDestination: "map" | "setup" | null;
  renamingCode: string | null;
  error: string;
  notice: string;
  creating: boolean;
  campaignMutationPending: boolean;
  onOpenEncounter: (code: string) => void;
  onSetupEncounter: (code: string) => void;
  onCreateEncounter: (input: { name: string; mode: "party" | "duplicate"; sourceCode: string }) => Promise<boolean>;
  onRenameEncounter: (code: string, name: string) => Promise<boolean>;
  onRenameCampaign: (name: string) => Promise<boolean>;
  onAddPlayer: (input: { identityId: string; character: { name: string; className: string; maxHp: number; armorClass: number; speed: number } | null }) => Promise<boolean>;
  onSaveCombatAction: (input: { characterId: string; actionId?: string; values: CombatActionValues }) => Promise<boolean>;
  onDeleteCombatAction: (actionId: string) => Promise<boolean>;
  onBackToCampaigns: () => void;
  onSignOut: () => void;
}) {
  const encounters = campaign.encounters;
  const encountersByRecency = [...encounters].sort((left, right) => right.updatedAt - left.updatedAt);
  const [showCreator, setShowCreator] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"party" | "duplicate">("party");
  const [sourceCode, setSourceCode] = useState(encountersByRecency[0]?.code ?? "");
  const [selectedEncounterCode, setSelectedEncounterCode] = useState(encountersByRecency[0]?.code ?? "");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [showCampaignManager, setShowCampaignManager] = useState(false);
  const [campaignName, setCampaignName] = useState(campaign.name);
  const [newPlayerId, setNewPlayerId] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [characterClass, setCharacterClass] = useState("");
  const [characterMaxHp, setCharacterMaxHp] = useState("10");
  const [characterArmorClass, setCharacterArmorClass] = useState("10");
  const [characterSpeed, setCharacterSpeed] = useState("30");
  const isDm = campaign.role === "dm";
  const members = campaign.members ?? [];
  const availablePlayers = invitedIdentities.filter((candidate) => {
    const member = members.find((entry) => entry.identity.id === candidate.id);
    return !member || (member.role === "player" && member.characters.length === 0);
  });
  const selectedExistingMember = members.some((member) => member.identity.id === newPlayerId);
  const selectedEncounter = encounters.find((encounter) => encounter.code === selectedEncounterCode) ?? encountersByRecency[0] ?? null;
  const editingSelectedEncounter = selectedEncounter ? editingCode === selectedEncounter.code : false;
  const selectedEncounterIsOpening = selectedEncounter ? openingCode === selectedEncounter.code : false;
  const saveSelectedEncounterRename = async () => {
    if (!selectedEncounter) return;
    const nextName = renameName.trim();
    if (nextName.length < 3 || nextName === selectedEncounter.name) return;
    if (await onRenameEncounter(selectedEncounter.code, nextName)) setEditingCode(null);
  };
  const submit = async () => {
    const source = sourceCode || encountersByRecency[0]?.code || "";
    if ((mode === "duplicate" && !source) || name.trim().length < 3) return;
    if (await onCreateEncounter({ name: name.trim(), mode, sourceCode: source })) {
      setName(""); setMode("party"); setShowCreator(false);
    }
  };

  return <main className="campaign-home-shell">
    <header className="campaign-home-header">
      <div><div className="eyebrow">Friday Lunch Crew</div><strong>{campaign.name}</strong></div>
      <div className="campaign-person"><button type="button" onClick={onBackToCampaigns}>All campaigns</button><span><strong>{identity.displayName}</strong><small>{isDm ? "Dungeon Master" : "Player"}</small></span><button type="button" onClick={onSignOut}>Sign out</button></div>
    </header>
    <div className="campaign-home-content">
      <section className="campaign-welcome">
        <div><div className="eyebrow">{isDm ? "Behind the screen" : campaign.characters.map((character) => character.name).join(" · ") || "Your place at the table"}</div><h1>{campaign.name}</h1><p>{isDm ? "Prepare an encounter or return to one already underway." : "Choose an encounter to return to the battle map. This campaign home will grow with the things your character needs between sessions."}</p></div>
      </section>

      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {!error && notice ? <div className="campaign-notice" role="status">{notice}</div> : null}
      <section className="campaign-party" aria-labelledby="campaign-party-title"><div className="campaign-section-heading"><div><div className="eyebrow">At this table</div><h2 id="campaign-party-title">Party</h2></div>{isDm ? <button className="campaign-create-button" type="button" onClick={() => setShowCampaignManager((open) => !open)} aria-expanded={showCampaignManager}>{showCampaignManager ? "Done" : "Manage campaign"}</button> : null}</div><div className="campaign-party-grid">{members.map((member) => <PartyMemberCard member={member} key={member.membershipId} />)}</div>{isDm && showCampaignManager ? <div className="campaign-management-panel"><section><h3>Campaign name</h3><div className="campaign-management-row"><input aria-label="Campaign name" maxLength={64} value={campaignName} onChange={(event) => setCampaignName(event.target.value)} disabled={campaignMutationPending} /><button type="button" disabled={campaignMutationPending || campaignName.trim().length < 3 || campaignName.trim() === campaign.name} onClick={() => void onRenameCampaign(campaignName.trim())}>{campaignMutationPending ? "Saving…" : "Save name"}</button></div></section><section><h3>Add a player or character</h3>{availablePlayers.length ? <><label>Player<select value={newPlayerId} onChange={(event) => setNewPlayerId(event.target.value)}><option value="">Choose a person</option>{availablePlayers.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>)}</select></label><div className="campaign-character-fields"><label>Character name<input value={characterName} maxLength={64} onChange={(event) => setCharacterName(event.target.value)} placeholder={selectedExistingMember ? "Required" : "Optional for now"} /></label><label>Class<input value={characterClass} maxLength={64} onChange={(event) => setCharacterClass(event.target.value)} /></label><label>Max HP<input inputMode="numeric" value={characterMaxHp} onChange={(event) => setCharacterMaxHp(event.target.value)} /></label><label>AC<input inputMode="numeric" value={characterArmorClass} onChange={(event) => setCharacterArmorClass(event.target.value)} /></label><label>Speed<input inputMode="numeric" value={characterSpeed} onChange={(event) => setCharacterSpeed(event.target.value)} /></label></div><button className="primary-button" type="button" disabled={campaignMutationPending || !newPlayerId || (selectedExistingMember && !characterName.trim())} onClick={() => void onAddPlayer({ identityId: newPlayerId, character: characterName.trim() ? { name: characterName.trim(), className: characterClass.trim(), maxHp: Number(characterMaxHp), armorClass: Number(characterArmorClass), speed: Number(characterSpeed) } : null }).then((added) => { if (added) { setNewPlayerId(""); setCharacterName(""); setCharacterClass(""); } })}>{campaignMutationPending ? "Adding…" : selectedExistingMember ? "Add character" : "Add player"}</button></> : <p>Every invited player has a character in this campaign.</p>}</section></div> : null}</section>
      {campaign.combatRollingEnabled ? <CharacterCombatActions campaign={campaign} pending={campaignMutationPending} onSave={onSaveCombatAction} onDelete={onDeleteCombatAction} /> : null}
      <section className="campaign-scenarios" aria-labelledby="encounter-list-title">
        <div className="campaign-section-heading"><div><div className="eyebrow">{isDm ? "Encounters you run" : "Encounters you play"}</div><h2 id="encounter-list-title">Encounters</h2></div><div className="campaign-section-actions"><span>{encounters.length} {encounters.length === 1 ? "encounter" : "encounters"}</span>{isDm ? <button className="campaign-create-button" type="button" onClick={() => setShowCreator((open) => !open)} aria-expanded={showCreator}>{showCreator ? "Cancel" : "+ New encounter"}</button> : null}</div></div>
        {isDm && showCreator ? <section className="campaign-create-panel" aria-labelledby="create-encounter-title">
          <div><div className="eyebrow">New encounter</div><h2 id="create-encounter-title">Create an encounter</h2><p>Start with the established party, or duplicate an encounter as a preparation shortcut.</p></div>
          <div className="campaign-create-fields"><label>Encounter name<input autoFocus maxLength={64} value={name} onChange={(event) => setName(event.target.value)} placeholder="The Sunken Observatory" disabled={creating} /></label><label>Starting point<select value={mode} onChange={(event) => setMode(event.target.value === "duplicate" ? "duplicate" : "party")} disabled={creating}><option value="party">Fresh encounter — current party only</option><option value="duplicate">Duplicate an existing encounter</option></select></label>{mode === "duplicate" ? <label>Encounter to duplicate<select value={sourceCode || encountersByRecency[0]?.code || ""} onChange={(event) => setSourceCode(event.target.value)} disabled={creating}>{encountersByRecency.map((encounter) => <option key={encounter.code} value={encounter.code}>{encounter.name}</option>)}</select></label> : null}</div>
          <div className="campaign-create-footer"><p>{mode === "duplicate" ? "Map and tokens are copied; combat, initiative, effects, movement, and history start clean." : `${campaign.characters.map((character) => character.name).join(", ") || "The active party"} begin at full health. Map and encounter preparation come next.`}</p><button className="primary-button" type="button" disabled={creating || name.trim().length < 3 || (mode === "duplicate" && encounters.length === 0)} onClick={() => void submit()}>{creating ? "Creating…" : "Create encounter"}</button></div>
        </section> : null}
        {loading ? <div className="campaign-empty">Gathering your encounters…</div> : !selectedEncounter ? <div className="campaign-empty">No encounters are ready for this seat yet.</div> : <div className="encounter-picker-panel">
          <div className="encounter-picker-row">
            <label className="encounter-picker-select"><span>Encounter</span><select aria-label="Selected encounter" value={selectedEncounter.code} onChange={(event) => { setSelectedEncounterCode(event.target.value); setEditingCode(null); }}>{encountersByRecency.map((encounter) => <option key={encounter.code} value={encounter.code}>{encounter.name}</option>)}</select></label>
            <div className="encounter-picker-state"><span className={`scenario-status is-${selectedEncounter.status}`}>{statusLabel(selectedEncounter.status)}</span><small>{formatUpdatedAt(selectedEncounter.updatedAt)}</small></div>
            {!editingSelectedEncounter ? <div className="encounter-picker-actions">{isDm ? <button type="button" onClick={() => { setEditingCode(selectedEncounter.code); setRenameName(selectedEncounter.name); }} disabled={Boolean(openingCode || renamingCode)} aria-label={`Rename ${selectedEncounter.name}`}>Rename</button> : null}{isDm ? <button type="button" onClick={() => onSetupEncounter(selectedEncounter.code)} disabled={Boolean(openingCode || renamingCode)}>{selectedEncounterIsOpening && openingDestination === "setup" ? "Opening setup…" : "Set up"}</button> : null}<button className="is-primary" type="button" onClick={() => onOpenEncounter(selectedEncounter.code)} disabled={Boolean(openingCode || renamingCode)}>{selectedEncounterIsOpening && openingDestination === "map" ? "Opening map…" : isDm ? "Battle map" : "Enter encounter"}<span aria-hidden="true">→</span></button></div> : null}
          </div>
          {isDm && editingSelectedEncounter ? <div className="scenario-rename-form"><label htmlFor={`rename-${selectedEncounter.code}`}>Encounter name</label><input id={`rename-${selectedEncounter.code}`} autoFocus maxLength={64} value={renameName} disabled={Boolean(renamingCode)} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveSelectedEncounterRename(); } else if (event.key === "Escape") setEditingCode(null); }} /><div><button type="button" onClick={() => setEditingCode(null)} disabled={Boolean(renamingCode)}>Cancel</button><button type="button" onClick={() => void saveSelectedEncounterRename()} disabled={Boolean(renamingCode) || renameName.trim().length < 3 || renameName.trim() === selectedEncounter.name}>{renamingCode === selectedEncounter.code ? "Saving…" : "Save name"}</button></div></div> : null}
        </div>}
      </section>

      <section className="campaign-coming-soon" aria-labelledby="campaign-tools-title"><div><div className="eyebrow">Coming next</div><h2 id="campaign-tools-title">Beyond the battle map</h2></div><p>This space is ready for party notes, recaps, character resources, handouts, and other between-session tools as the campaign grows.</p></section>
    </div>
  </main>;
}
