"use client";

import type { Role } from "@/shared/contracts";

export type JoinIdentity = { label: string; participantName: string; role: Role };

export function JoinScreen({ error, identities, onLogin }: {
  error: string;
  identities: JoinIdentity[];
  onLogin: (identity: JoinIdentity) => void;
}) {
  return <main className="join-shell">
    <section className="join-card" aria-labelledby="join-title">
      <div className="eyebrow">Friday Lunch Crew · Campaign table</div>
      <h1 id="join-title">Choose your seat</h1>
      <p>Sign in to reach your campaign home. Credentials will come later; for now, one click gets you to the table.</p>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="join-options" role="group" aria-label="Choose participant">
        {identities.map((identity, index) => <button key={identity.label} className="join-option-button" onClick={() => onLogin(identity)} autoFocus={index === 0}>
          <span>{identity.participantName}</span>
          <small>{identity.role === "dm" ? "Dungeon Master" : identity.label.replace(/^Continue as /, "")}</small>
        </button>)}
      </div>
    </section>
  </main>;
}
