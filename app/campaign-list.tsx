"use client";

import type { CampaignAccessSummary, HumanIdentity } from "@/shared/campaigns";

function membershipLabel(campaign: CampaignAccessSummary) {
  if (campaign.role === "dm") return "Dungeon Master";
  if (!campaign.characters.length) return "Player";
  return campaign.characters.map((character) =>
    `${character.name}${character.className ? ` · ${character.className}` : ""}`,
  ).join(", ");
}

export function CampaignList({ identity, campaigns, loading, error, onEnterCampaign, onSignOut }: {
  identity: HumanIdentity;
  campaigns: CampaignAccessSummary[];
  loading: boolean;
  error: string;
  onEnterCampaign: (campaignId: string) => void;
  onSignOut: () => void;
}) {
  return <main className="campaign-home-shell">
    <header className="campaign-home-header">
      <div><div className="eyebrow">Friday Lunch Crew</div><strong>My Campaigns</strong></div>
      <div className="campaign-person"><span><strong>{identity.displayName}</strong><small>Signed in person</small></span><button type="button" onClick={onSignOut}>Switch person</button></div>
    </header>
    <div className="campaign-home-content">
      <section className="campaign-welcome">
        <div><div className="eyebrow">Your tables</div><h1>Welcome back, {identity.displayName}.</h1><p>Choose a campaign to see its party, encounters, and between-session resources.</p></div>
      </section>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <section className="campaign-scenarios campaign-list-section" aria-labelledby="campaign-list-title">
        <div className="campaign-section-heading"><div><div className="eyebrow">Campaigns you can access</div><h2 id="campaign-list-title">Campaigns</h2></div><div className="campaign-section-actions"><span>{campaigns.length} {campaigns.length === 1 ? "campaign" : "campaigns"}</span></div></div>
        {loading ? <div className="campaign-empty">Gathering your campaigns…</div> : campaigns.length === 0 ? <div className="campaign-empty">No campaigns are available for this person.</div> : <div className="scenario-card-grid campaign-card-grid">{campaigns.map((campaign) => <article className="scenario-card campaign-card" key={campaign.id}>
          <div className="scenario-card-top"><span className="scenario-status is-active">{campaign.role === "dm" ? "DM" : "Player"}</span><small>{campaign.encounters.length} {campaign.encounters.length === 1 ? "encounter" : "encounters"}</small></div>
          <div><h3>{campaign.name}</h3><p>{membershipLabel(campaign)}</p></div>
          <div className="scenario-card-actions"><button type="button" onClick={() => onEnterCampaign(campaign.id)}>Open campaign<span aria-hidden="true">→</span></button></div>
        </article>)}</div>}
      </section>
    </div>
  </main>;
}
