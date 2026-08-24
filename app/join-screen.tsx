"use client";

import { useEffect, useRef, useState } from "react";
import type { HumanIdentity } from "@/shared/campaigns";

export type JoinIdentity = HumanIdentity;

export function JoinScreen({ error, identities, onLogin }: {
  error: string;
  identities: JoinIdentity[];
  onLogin: (identity: JoinIdentity) => void;
}) {
  const [ready, setReady] = useState(false);
  const firstIdentityRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { if (ready) firstIdentityRef.current?.focus(); }, [ready]);
  return <main className="join-shell">
    <section className="join-card" aria-labelledby="join-title">
      <div className="eyebrow">Friday Lunch Crew · Campaign table</div>
      <h1 id="join-title">Choose your seat</h1>
      <p>Sign in to reach your campaign home. Credentials will come later; for now, one click gets you to the table.</p>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="join-options" role="group" aria-label="Choose participant">
        {identities.map((identity, index) => <button key={identity.id} ref={index === 0 ? firstIdentityRef : undefined} className="join-option-button" disabled={!ready} onClick={() => onLogin(identity)}>
          <span>{identity.displayName}</span>
          <small>Continue as this person</small>
        </button>)}
      </div>
    </section>
  </main>;
}
