"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { HumanIdentity } from "@/shared/campaigns";

export type JoinIdentity = HumanIdentity;

export function JoinScreen({ error, identities, loading, googleConfigured, devLoginAvailable, onDevLogin }: {
  error: string;
  identities: JoinIdentity[];
  loading: boolean;
  googleConfigured: boolean;
  devLoginAvailable: boolean;
  onDevLogin: (identity: JoinIdentity) => void;
}) {
  const [ready, setReady] = useState(false);
  const firstIdentityRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (ready && !loading && devLoginAvailable) firstIdentityRef.current?.focus();
  }, [devLoginAvailable, loading, ready]);
  return <main className="join-shell">
    <section className="join-card" aria-labelledby="join-title">
      <Image className="join-brand-logo" src="/assets/friday-lunch-crew-oauth-logo-120-v1.png" alt="" width={72} height={72} priority />
      <div className="eyebrow">Friday Lunch Crew · Campaign table</div>
      <h1 id="join-title">Welcome to the table</h1>
      <p>Sign in with an invited Google account to reach your campaigns, characters, and encounters.</p>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      {loading ? <div className="join-auth-loading" role="status">Checking your session…</div> : <>
        {googleConfigured ? <a className="google-login-button" href="/api/auth/google/start"><span aria-hidden="true">G</span>Continue with Google</a> : devLoginAvailable ? <div className="join-dev-notice">Google sign-in is not configured in this local environment.</div> : <div className="form-error" role="alert">Google sign-in is temporarily unavailable.</div>}
        {devLoginAvailable ? <section className="join-dev-tools" aria-labelledby="dev-login-title"><div><strong id="dev-login-title">Local testing</strong><small>Development only · bypasses Google</small></div><div className="join-options" role="group" aria-label="Choose local test identity">
          {identities.map((identity, index) => <button key={identity.id} ref={index === 0 ? firstIdentityRef : undefined} className="join-option-button" disabled={!ready} onClick={() => onDevLogin(identity)}>
            <span>{identity.displayName}</span>
            <small>Test as this person</small>
          </button>)}
        </div></section> : null}
      </>}
      <footer className="join-legal-links"><span>Private, invitation-only service</span><nav aria-label="Legal pages"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav></footer>
    </section>
  </main>;
}
