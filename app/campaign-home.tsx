"use client";

import { useState } from "react";
import type { JoinIdentity } from "@/app/join-screen";
import type { EncounterSummary } from "@/app/use-scenario-controls";

function formatUpdatedAt(updatedAt: number) {
  if (!updatedAt) return "Ready to prepare";
  return `Updated ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(updatedAt)}`;
}

function statusLabel(status: EncounterSummary["status"]) {
  if (status === "active") return "In combat";
  if (status === "paused") return "Paused";
  return "Setup";
}

export function CampaignHome({ identity, encounters, loading, openingCode, renamingCode, error, notice, creating, onOpenScenario, onCreateScenario, onRenameScenario, onSignOut }: {
  identity: JoinIdentity;
  encounters: EncounterSummary[];
  loading: boolean;
  openingCode: string | null;
  renamingCode: string | null;
  error: string;
  notice: string;
  creating: boolean;
  onOpenScenario: (code: string) => void;
  onCreateScenario: (input: { name: string; mode: "party" | "duplicate"; sourceCode: string }) => Promise<boolean>;
  onRenameScenario: (code: string, name: string) => Promise<boolean>;
  onSignOut: () => void;
}) {
  const [showCreator, setShowCreator] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"party" | "duplicate">("party");
  const [sourceCode, setSourceCode] = useState(encounters[0]?.code ?? "");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const isDm = identity.role === "dm";
  const submit = async () => {
    const source = sourceCode || encounters[0]?.code || "";
    if (!source || name.trim().length < 3) return;
    if (await onCreateScenario({ name: name.trim(), mode, sourceCode: source })) {
      setName(""); setMode("party"); setShowCreator(false);
    }
  };

  return <main className="campaign-home-shell">
    <header className="campaign-home-header">
      <div><div className="eyebrow">Friday Lunch Crew</div><strong>Campaign Home</strong></div>
      <div className="campaign-person"><span><strong>{identity.participantName}</strong><small>{isDm ? "Dungeon Master" : "Player"}</small></span><button type="button" onClick={onSignOut}>Switch person</button></div>
    </header>
    <div className="campaign-home-content">
      <section className="campaign-welcome">
        <div><div className="eyebrow">{isDm ? "Behind the screen" : "Your place at the table"}</div><h1>Welcome back, {identity.participantName}.</h1><p>{isDm ? "Prepare the next adventure or return to a scenario already underway." : "Choose a scenario to return to the battle map. This campaign home will grow with the things your character needs between sessions."}</p></div>
      </section>

      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {!error && notice ? <div className="campaign-notice" role="status">{notice}</div> : null}
      <section className="campaign-scenarios" aria-labelledby="scenario-list-title">
        <div className="campaign-section-heading"><div><div className="eyebrow">{isDm ? "Adventures you run" : "Adventures you play"}</div><h2 id="scenario-list-title">Scenarios</h2></div><div className="campaign-section-actions"><span>{encounters.length} {encounters.length === 1 ? "scenario" : "scenarios"}</span>{isDm ? <button className="campaign-create-button" type="button" onClick={() => setShowCreator((open) => !open)} aria-expanded={showCreator}>{showCreator ? "Cancel" : "+ New scenario"}</button> : null}</div></div>
        {isDm && showCreator ? <section className="campaign-create-panel" aria-labelledby="create-scenario-title">
          <div><div className="eyebrow">New adventure</div><h2 id="create-scenario-title">Create a scenario</h2><p>Start with the established party, or duplicate a scenario as a preparation shortcut.</p></div>
          <div className="campaign-create-fields"><label>Scenario name<input autoFocus maxLength={64} value={name} onChange={(event) => setName(event.target.value)} placeholder="The Sunken Observatory" disabled={creating} /></label><label>Starting point<select value={mode} onChange={(event) => setMode(event.target.value === "duplicate" ? "duplicate" : "party")} disabled={creating}><option value="party">Fresh scenario — current party only</option><option value="duplicate">Duplicate an existing scenario</option></select></label>{mode === "duplicate" ? <label>Scenario to duplicate<select value={sourceCode || encounters[0]?.code || ""} onChange={(event) => setSourceCode(event.target.value)} disabled={creating}>{encounters.map((encounter) => <option key={encounter.code} value={encounter.code}>{encounter.name}</option>)}</select></label> : null}</div>
          <div className="campaign-create-footer"><p>{mode === "duplicate" ? "Map and tokens are copied; combat, initiative, effects, movement, and history start clean." : "Dar'eleth, Jelton, and Malichar begin at full health. Map and encounter preparation come next."}</p><button className="primary-button" type="button" disabled={creating || name.trim().length < 3 || encounters.length === 0} onClick={() => void submit()}>{creating ? "Creating…" : "Create scenario"}</button></div>
        </section> : null}
        {loading ? <div className="campaign-empty">Gathering your scenarios…</div> : encounters.length === 0 ? <div className="campaign-empty">No scenarios are ready for this seat yet.</div> : <div className="scenario-card-grid">{encounters.map((encounter) => {
          const editing = editingCode === encounter.code;
          const renaming = renamingCode === encounter.code;
          const saveRename = async () => {
            const nextName = renameName.trim();
            if (nextName.length < 3 || nextName === encounter.name) return;
            if (await onRenameScenario(encounter.code, nextName)) setEditingCode(null);
          };
          return <article className="scenario-card" key={encounter.code}><div className="scenario-card-top"><span className={`scenario-status is-${encounter.status}`}>{statusLabel(encounter.status)}</span><small>{formatUpdatedAt(encounter.updatedAt)}</small></div><div><h3>{encounter.name}</h3><p>{isDm ? "Open the table to prepare the map, creatures, and encounter state." : "Return to the shared map, party roster, chat, and handouts."}</p></div>{isDm && editing ? <div className="scenario-rename-form"><label htmlFor={`rename-${encounter.code}`}>Scenario name</label><input id={`rename-${encounter.code}`} autoFocus maxLength={64} value={renameName} disabled={Boolean(renamingCode)} onChange={(event) => setRenameName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveRename(); } else if (event.key === "Escape") setEditingCode(null); }} /><div><button type="button" onClick={() => setEditingCode(null)} disabled={Boolean(renamingCode)}>Cancel</button><button type="button" onClick={() => void saveRename()} disabled={Boolean(renamingCode) || renameName.trim().length < 3 || renameName.trim() === encounter.name}>{renaming ? "Saving…" : "Save name"}</button></div></div> : null}<div className="scenario-card-actions">{isDm && !editing ? <button type="button" onClick={() => { setEditingCode(encounter.code); setRenameName(encounter.name); }} disabled={Boolean(openingCode || renamingCode)} aria-label={`Rename ${encounter.name}`}>Rename</button> : null}<button type="button" onClick={() => onOpenScenario(encounter.code)} disabled={Boolean(openingCode || renamingCode)}>{openingCode === encounter.code ? "Opening…" : isDm ? "Open scenario" : "Enter scenario"}<span aria-hidden="true">→</span></button></div></article>;
        })}</div>}
      </section>

      <section className="campaign-coming-soon" aria-labelledby="campaign-tools-title"><div><div className="eyebrow">Coming next</div><h2 id="campaign-tools-title">Beyond the battle map</h2></div><p>This space is ready for party notes, recaps, character resources, handouts, and other between-session tools as the campaign grows.</p></section>
    </div>
  </main>;
}
