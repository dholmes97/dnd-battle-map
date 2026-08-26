import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export function LegalPage({ eyebrow, title, introduction, children }: {
  eyebrow: string;
  title: string;
  introduction: string;
  children: ReactNode;
}) {
  return <main className="legal-shell">
    <article className="legal-page">
      <header className="legal-header">
        <Link className="legal-brand" href="/" aria-label="Return to Friday Lunch Crew Battle Map">
          <Image src="/assets/friday-lunch-crew-oauth-logo-120-v1.png" alt="" width={56} height={56} priority />
          <span><strong>Friday Lunch Crew</strong><small>Battle Map</small></span>
        </Link>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{introduction}</p>
        <small>Last updated August 25, 2026</small>
      </header>
      <div className="legal-content">{children}</div>
      <footer className="legal-footer">
        <Link href="/">Return to sign in</Link>
        <nav aria-label="Legal pages"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav>
      </footer>
    </article>
  </main>;
}
