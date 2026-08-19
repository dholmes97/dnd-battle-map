"use client";

import type { Role } from "@/shared/contracts";
import type { EncounterSummary } from "@/app/use-scenario-controls";

export type JoinIdentity = { label: string; participantName: string; role: Role };

export function JoinScreen({ encounters, selectedCode, joiningIdentity, busy, error, identities, onEncounterChange, onJoin }: { encounters: EncounterSummary[]; selectedCode: string; joiningIdentity: string | null; busy: boolean; error: string; identities: JoinIdentity[]; onEncounterChange: (code: string) => void; onJoin: (identity: JoinIdentity) => void }) {
  return <main className="join-shell"><section className="join-card" aria-labelledby="join-title"><div className="eyebrow">Living encounter · Tactical companion</div><h1 id="join-title">Choose a scenario</h1><p>Select the prepared encounter, then choose your seat.</p><label className="scenario-picker">Scenario<select value={selectedCode} onChange={(event) => onEncounterChange(event.target.value)} disabled={busy}>{encounters.map((encounter) => <option key={encounter.code} value={encounter.code}>{encounter.name}</option>)}</select></label>{error ? <div className="form-error" role="alert">{error}</div> : null}<div className="join-options" role="group" aria-label="Choose participant">{identities.map((identity, index) => <button key={identity.label} className="join-option-button" onClick={() => onJoin(identity)} disabled={busy} autoFocus={index === 0}>{joiningIdentity === identity.label ? "Joining…" : identity.label}</button>)}</div></section></main>;
}
