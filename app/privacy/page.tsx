import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Friday Lunch Crew Battle Map handles identity and campaign data.",
};

export default function PrivacyPage() {
  return <LegalPage eyebrow="Privacy" title="Privacy Policy" introduction="Friday Lunch Crew Battle Map is a private, invitation-only tabletop gaming tool. This policy explains the limited information it uses to identify players and operate shared campaigns and encounters.">
    <section>
      <h2>Information we collect</h2>
      <p>When you sign in, Google provides your stable Google account identifier, verified email address, display name, and basic profile information made available by the <code>openid</code>, <code>email</code>, and <code>profile</code> scopes. We do not receive your Google password or access your Gmail messages, contacts, Drive files, calendar, or other Google services.</p>
      <p>The application also stores information created while playing: campaign memberships, characters, encounters, maps, tokens, combat state, chat messages, handouts, and related gameplay history. Basic technical records such as session identifiers, request identifiers, timestamps, and bounded diagnostic information may be processed to secure and operate the service.</p>
    </section>
    <section>
      <h2>How we use information</h2>
      <p>We use Google identity information to confirm that you are one of the invited participants, associate you with your durable account, determine your campaign role and character access, maintain your signed-in session, and prevent unauthorized access. Your verified email address is used to establish the initial account link; the stable Google account identifier is used as the permanent link afterward.</p>
      <p>Gameplay information is used to provide campaign management, shared battle maps, encounter preparation, live synchronization, chat, handouts, history, and undo or redo features. Technical information is used for security, reliability, troubleshooting, and abuse prevention.</p>
    </section>
    <section>
      <h2>Sharing and service providers</h2>
      <p>We do not sell personal information or use it for advertising. Campaign information is shared only with the other participants who are authorized for that campaign, subject to in-app visibility rules such as DM-only notes and private chat channels.</p>
      <p>Google provides authentication, and Cloudflare provides application hosting, database, and file-storage infrastructure. These providers process limited information as needed to deliver their services. Information may also be disclosed when reasonably necessary to comply with law, protect users, or secure the application.</p>
    </section>
    <section>
      <h2>Retention and security</h2>
      <p>Identity records are retained while an invitation or campaign relationship remains active. Login sessions expire and can be revoked. Campaign and encounter information is retained to preserve the shared game unless it is deliberately removed. Operational logs and backups may persist for a limited additional period.</p>
      <p>We use server-side authorization, encrypted transport, restricted Google scopes, revocable session cookies, and access controls appropriate to this small private application. No system can guarantee absolute security.</p>
    </section>
    <section>
      <h2>Your choices</h2>
      <p>You may sign out at any time. You can revoke the application’s Google access from your Google Account permissions. To ask about your stored identity data, correct an account association, or request removal, contact the application administrator.</p>
    </section>
    <section>
      <h2>Children and changes</h2>
      <p>This invitation-only application is not directed to children under 13. We may update this policy as the application changes; the revised date will appear at the top of this page.</p>
    </section>
    <section>
      <h2>Contact</h2>
      <p>Questions about privacy or account data can be sent to <a href="mailto:dholmes97@gmail.com">dholmes97@gmail.com</a>.</p>
    </section>
  </LegalPage>;
}
