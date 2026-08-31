"use client";

import { useState } from "react";
import type { CampaignAccessSummary, HumanIdentity } from "@/shared/campaigns";

export type QaPersona = "dm" | "player1" | "player2";
export type QaPendingAction = QaPersona | "reset" | null;

export type CampaignPlayerInput = {
  identityId: string;
  character: { name: string; className: string; maxHp: number; armorClass: number; speed: number } | null;
};

function membershipLabel(campaign: CampaignAccessSummary) {
  if (campaign.role === "dm") return "Dungeon Master";
  if (!campaign.characters.length) return "Player";
  return campaign.characters.map((character) =>
    `${character.name}${character.className ? ` · ${character.className}` : ""}`,
  ).join(", ");
}

function QaSessionLauncher({ qaPending, onLaunchQa, onResetQa }: {
  qaPending: QaPendingAction;
  onLaunchQa: (persona: QaPersona) => void;
  onResetQa: () => void;
}) {
  return <details className="qa-session-launcher">
    <summary>
      <span><span className="eyebrow">Testing utility</span><strong>Production QA</strong></span>
      <small>Isolated test tools <span aria-hidden="true">⌄</span></small>
    </summary>
    <div className="qa-session-body">
      <div><h2>Interaction QA</h2><p>Open this page in three windows, then choose the fixed DM, Player 1, and Player 2 personas. These sessions cannot enter ordinary campaigns.</p></div>
      <div><button type="button" disabled={qaPending !== null} aria-busy={qaPending === "dm"} title="Open the isolated DM session in this window" onClick={() => onLaunchQa("dm")}>{qaPending === "dm" ? "Opening QA DM…" : "Open QA DM"}</button><button type="button" disabled={qaPending !== null} aria-busy={qaPending === "player1"} title="Open the isolated Player 1 session in this window" onClick={() => onLaunchQa("player1")}>{qaPending === "player1" ? "Opening Player 1…" : "Open QA Player 1"}</button><button type="button" disabled={qaPending !== null} aria-busy={qaPending === "player2"} title="Open the isolated Player 2 session in this window" onClick={() => onLaunchQa("player2")}>{qaPending === "player2" ? "Opening Player 2…" : "Open QA Player 2"}</button><button type="button" className="is-danger" disabled={qaPending !== null} aria-busy={qaPending === "reset"} title="Restore the shared QA encounter to its starting state" onClick={onResetQa}>{qaPending === "reset" ? "Resetting fixture…" : "Reset QA fixture"}</button></div>
    </div>
  </details>;
}

export function CampaignList({ identity, campaigns, invitedIdentities, loading, mutationPending, qaPending, error, notice, onEnterCampaign, onCreateCampaign, onLaunchQa, onResetQa, onSignOut }: {
  identity: HumanIdentity;
  campaigns: CampaignAccessSummary[];
  invitedIdentities: HumanIdentity[];
  loading: boolean;
  mutationPending: boolean;
  qaPending: QaPendingAction;
  error: string;
  notice: string;
  onEnterCampaign: (campaignId: string) => void;
  onCreateCampaign: (input: { name: string; players: CampaignPlayerInput[] }) => Promise<boolean>;
  onLaunchQa: (persona: QaPersona) => void;
  onResetQa: () => void;
  onSignOut: () => void;
}) {
  const [showCreator, setShowCreator] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [characters, setCharacters] = useState<Record<string, { name: string; className: string; maxHp: string; armorClass: string; speed: string }>>({});
  const candidates = invitedIdentities.filter((candidate) => candidate.id !== identity.id);
  const details = (identityId: string) => characters[identityId] ?? { name: "", className: "", maxHp: "10", armorClass: "10", speed: "30" };
  const changeDetails = (identityId: string, change: Partial<ReturnType<typeof details>>) => setCharacters((current) => ({ ...current, [identityId]: { ...details(identityId), ...change } }));
  const submit = async () => {
    const players = candidates.filter((candidate) => selected[candidate.id]).map((candidate) => {
      const character = details(candidate.id);
      return {
        identityId: candidate.id,
        character: character.name.trim() ? {
          name: character.name.trim(), className: character.className.trim(),
          maxHp: Number(character.maxHp), armorClass: Number(character.armorClass), speed: Number(character.speed),
        } : null,
      };
    });
    if (await onCreateCampaign({ name: name.trim(), players })) {
      setName(""); setSelected({}); setCharacters({}); setShowCreator(false);
    }
  };
  return <main className="campaign-home-shell">
    <header className="campaign-home-header">
      <div><div className="eyebrow">Friday Lunch Crew</div><strong>My Campaigns</strong></div>
      <div className="campaign-person"><span><strong>{identity.displayName}</strong><small>{identity.loginEmail ?? "Google account"}</small></span><button type="button" onClick={onSignOut}>Sign out</button></div>
    </header>
    <div className="campaign-home-content">
      <section className="campaign-welcome">
        <div><div className="eyebrow">Your tables</div><h1>Welcome back, {identity.displayName}.</h1><p>Choose a campaign to see its party, encounters, and between-session resources.</p></div>
      </section>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {!error && notice ? <div className="campaign-notice" role="status">{notice}</div> : null}
      <section className="campaign-scenarios campaign-list-section" aria-labelledby="campaign-list-title">
        <div className="campaign-section-heading"><div><div className="eyebrow">Campaigns you can access</div><h2 id="campaign-list-title">Campaigns</h2></div><div className="campaign-section-actions"><span>{campaigns.length} {campaigns.length === 1 ? "campaign" : "campaigns"}</span>{identity.canCreateCampaigns ? <button className="campaign-create-button" type="button" onClick={() => setShowCreator((open) => !open)} aria-expanded={showCreator}>{showCreator ? "Cancel" : "+ New campaign"}</button> : null}</div></div>
        {showCreator ? <section className="campaign-create-panel campaign-builder" aria-labelledby="create-campaign-title"><div><div className="eyebrow">New campaign</div><h2 id="create-campaign-title">Create a campaign</h2><p>You become its Dungeon Master. Add any invited players now, or manage the party later.</p></div><div className="campaign-create-fields"><label>Campaign name<input autoFocus maxLength={64} value={name} onChange={(event) => setName(event.target.value)} placeholder="The Shattered Crown" disabled={mutationPending} /></label><fieldset className="campaign-player-picker"><legend>Starting players</legend>{candidates.map((candidate) => {
          const checked = Boolean(selected[candidate.id]); const character = details(candidate.id);
          return <div className={`campaign-player-option${checked ? " is-selected" : ""}`} key={candidate.id}><label className="campaign-player-check"><input type="checkbox" checked={checked} disabled={mutationPending} onChange={(event) => setSelected((current) => ({ ...current, [candidate.id]: event.target.checked }))} /><span><strong>{candidate.displayName}</strong><small>Invited Google account</small></span></label>{checked ? <div className="campaign-character-fields"><label>Character name<input value={character.name} maxLength={64} onChange={(event) => changeDetails(candidate.id, { name: event.target.value })} placeholder="Optional for now" /></label><label>Class<input value={character.className} maxLength={64} onChange={(event) => changeDetails(candidate.id, { className: event.target.value })} placeholder="Fighter" /></label><label>Max HP<input inputMode="numeric" value={character.maxHp} onChange={(event) => changeDetails(candidate.id, { maxHp: event.target.value })} /></label><label>AC<input inputMode="numeric" value={character.armorClass} onChange={(event) => changeDetails(candidate.id, { armorClass: event.target.value })} /></label><label>Speed<input inputMode="numeric" value={character.speed} onChange={(event) => changeDetails(candidate.id, { speed: event.target.value })} /></label></div> : null}</div>;
        })}</fieldset></div><div className="campaign-create-footer"><p>Only the four invited Google identities can be added. Campaign roles and characters remain specific to this campaign.</p><button className="primary-button" type="button" disabled={mutationPending || name.trim().length < 3} onClick={() => void submit()}>{mutationPending ? "Creating…" : "Create campaign"}</button></div></section> : null}
        {loading ? <div className="campaign-empty">Gathering your campaigns…</div> : campaigns.length === 0 ? <div className="campaign-empty">No campaigns are available for this person.</div> : <div className="scenario-card-grid campaign-card-grid">{campaigns.map((campaign) => <article className="scenario-card campaign-card" key={campaign.id}>
          <div className="scenario-card-top"><span className="scenario-status is-active">{campaign.role === "dm" ? "DM" : "Player"}</span><small>{campaign.encounters.length} {campaign.encounters.length === 1 ? "encounter" : "encounters"}</small></div>
          <div><h3>{campaign.name}</h3><p>{membershipLabel(campaign)}</p></div>
          <div className="scenario-card-actions"><button type="button" onClick={() => onEnterCampaign(campaign.id)}>Open campaign<span aria-hidden="true">→</span></button></div>
        </article>)}</div>}
      </section>
      {identity.canUseQaSessions ? <QaSessionLauncher qaPending={qaPending} onLaunchQa={onLaunchQa} onResetQa={onResetQa} /> : null}
    </div>
  </main>;
}
