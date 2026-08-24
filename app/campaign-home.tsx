"use client";

import { useState } from "react";
import type { JoinIdentity } from "@/app/join-screen";
import type { EncounterSummary } from "@/app/encounter-summary";
import type { CampaignAccessSummary } from "@/shared/campaigns";

function formatUpdatedAt(updatedAt: number) {
  if (!updatedAt) return "Ready to prepare";
  return `Updated ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(updatedAt)}`;
}

function statusLabel(status: EncounterSummary["status"]) {
  if (status === "active") return "In combat";
  if (status === "paused") return "Paused";
  return "Ready";
}

export function CampaignHome({ identity, campaign, loading, openingCode, openingDestination, renamingCode, error, notice, creating, onOpenEncounter, onSetupEncounter, onCreateEncounter, onRenameEncounter, onBackToCampaigns, onSignOut }: {
  identity: JoinIdentity;
  campaign: CampaignAccessSummary;
  loading: boolean;
  openingCode: string | null;
  openingDestination: "map" | "setup" | null;
  renamingCode: string | null;
  error: string;
  notice: string;
  creating: boolean;
  onOpenEncounter: (code: string) => void;
  onSetupEncounter: (code: string) => void;
  onCreateEncounter: (input: { name: string; mode: "party" | "duplicate"; sourceCode: string }) => Promise<boolean>;
  onRenameEncounter: (code: string, name: string) => Promise<boolean>;
  onBackToCampaigns: () => void;
  onSignOut: () => void;
}) {
  const encounters = campaign.encounters;
  const [showCreator, setShowCreator] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"party" | "duplicate">("party");
  const [sourceCode, setSourceCode] = useState(encounters[0]?.code ?? "");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const isDm = campaign.role === "dm";
  const submit = async () => {
    const source = sourceCode || encounters[0]?.code || "";
    if (!source || name.trim().length < 3) return;
    if (await onCreateEncounter({ name: name.trim(), mode, sourceCode: source })) {
      setName(""); setMode("party"); setShowCreator(false);
    }
  };

  return <main className="campaign-home-shell">
    <header className="campaign-home-header">
      <div><div className="eyebrow">Friday Lunch Crew</div><strong>{campaign.name}</strong></div>
      <div className="campaign-person"><button type="button" onClick={onBackToCampaigns}>All campaigns</button><span><strong>{identity.displayName}</strong><small>{isDm ? "Dungeon Master" : "Player"}</small></span><button type="button" onClick={onSignOut}>Switch person</button></div>
    </header>
    <div className="campaign-home-content">
      <section className="campaign-welcome">
        <div><div className="eyebrow">{isDm ? "Behind the screen" : campaign.characters.map((character) => character.name).join(" · ") || "Your place at the table"}</div><h1>{campaign.name}</h1><p>{isDm ? "Prepare an encounter or return to one already underway." : "Choose an encounter to return to the battle map. This campaign home will grow with the things your character needs between sessions."}</p></div>
      </section>

      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {!error && notice ? <div className="campaign-notice" role="status">{notice}</div> : null}
      <section className="campaign-scenarios" aria-labelledby="encounter-list-title">
        <div className="campaign-section-heading"><div><div className="eyebrow">{isDm ? "Encounters you run" : "Encounters you play"}</div><h2 id="encounter-list-title">Encounters</h2></div><div className="campaign-section-actions"><span>{encounters.length} {encounters.length === 1 ? "encounter" : "encounters"}</span>{isDm ? <button className="campaign-create-button" type="button" onClick={() => setShowCreator((open) => !open)} aria-expanded={showCreator}>{showCreator ? "Cancel" : "+ New encounter"}</button> : null}</div></div>
        {isDm && showCreator ? <section className="campaign-create-panel" aria-labelledby="create-encounter-title">
          <div><div className="eyebrow">New encounter</div><h2 id="create-encounter-title">Create an encounter</h2><p>Start with the established party, or duplicate an encounter as a preparation shortcut.</p></div>
          <div className="campaign-create-fields"><label>Encounter name<input autoFocus maxLength={64} value={name} onChange={(event) => setName(event.target.value)} placeholder="The Sunken Observatory" disabled={creating} /></label><label>Starting point<select value={mode} onChange={(event) => setMode(event.target.value === "duplicate" ? "duplicate" : "party")} disabled={creating}><option value="party">Fresh encounter — current party only</option><option value="duplicate">Duplicate an existing encounter</option></select></label>{mode === "duplicate" ? <label>Encounter to duplicate<select value={sourceCode || encounters[0]?.code || ""} onChange={(event) => setSourceCode(event.target.value)} disabled={creating}>{encounters.map((encounter) => <option key={encounter.code} value={encounter.code}>{encounter.name}</option>)}</select></label> : null}</div>
          <div className="campaign-create-footer"><p>{mode === "duplicate" ? "Map and tokens are copied; combat, initiative, effects, movement, and history start clean." : `${campaign.characters.map((character) => character.name).join(", ")} begin at full health. Map and encounter preparation come next.`}</p><button className="primary-button" type="button" disabled={creating || name.trim().length < 3 || encounters.length === 0} onClick={() => void submit()}>{creating ? "Creating…" : "Create encounter"}</button></div>
        </section> : null}
        {loading ? <div className="campaign-empty">Gathering your encounters…</div> : encounters.length === 0 ? <div className="campaign-empty">No encounters are ready for this seat yet.</div> : <div className="scenario-card-grid">{encounters.map((encounter) => {
          const editing = editingCode === encounter.code;
          const renaming = renamingCode === encounter.code;
          const saveRename = async () => {
            const nextName = renameName.trim();
            if (nextName.length < 3 || nextName === encounter.name) return;
            if (await onRenameEncounter(encounter.code, nextName)) setEditingCode(null);
          };
          const isOpening = openingCode === encounter.code;
          return <article className="scenario-card" key={encounter.code}><div className="scenario-card-top"><span className={`scenario-status is-${encounter.status}`}>{statusLabel(encounter.status)}</span><small>{formatUpdatedAt(encounter.updatedAt)}</small></div><div><h3>{encounter.name}</h3><p>{isDm ? "Prepare its private draft, or open the live battle map when the table is ready." : "Return to the shared map, party roster, chat, and handouts."}</p></div>{isDm && editing ? <div className="scenario-rename-form"><label htmlFor={`rename-${encounter.code}`}>Encounter name</label><input id={`rename-${encounter.code}`} autoFocus maxLength={64} value={renameName} disabled={Boolean(renamingCode)} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveRename(); } else if (event.key === "Escape") setEditingCode(null); }} /><div><button type="button" onClick={() => setEditingCode(null)} disabled={Boolean(renamingCode)}>Cancel</button><button type="button" onClick={() => void saveRename()} disabled={Boolean(renamingCode) || renameName.trim().length < 3 || renameName.trim() === encounter.name}>{renaming ? "Saving…" : "Save name"}</button></div></div> : null}<div className="scenario-card-actions">{isDm && !editing ? <button type="button" onClick={() => { setEditingCode(encounter.code); setRenameName(encounter.name); }} disabled={Boolean(openingCode || renamingCode)} aria-label={`Rename ${encounter.name}`}>Rename</button> : null}{isDm && !editing ? <button type="button" onClick={() => onSetupEncounter(encounter.code)} disabled={Boolean(openingCode || renamingCode)}>{isOpening && openingDestination === "setup" ? "Opening setup…" : "Set up"}</button> : null}<button type="button" onClick={() => onOpenEncounter(encounter.code)} disabled={Boolean(openingCode || renamingCode)}>{isOpening && openingDestination === "map" ? "Opening map…" : isDm ? "Battle map" : "Enter encounter"}<span aria-hidden="true">→</span></button></div></article>;
        })}</div>}
      </section>

      <section className="campaign-coming-soon" aria-labelledby="campaign-tools-title"><div><div className="eyebrow">Coming next</div><h2 id="campaign-tools-title">Beyond the battle map</h2></div><p>This space is ready for party notes, recaps, character resources, handouts, and other between-session tools as the campaign grows.</p></section>
    </div>
  </main>;
}
