import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms for using Friday Lunch Crew Battle Map.",
};

export default function TermsPage() {
  return <LegalPage eyebrow="Terms" title="Terms of Service" introduction="These terms cover the private, experimental Friday Lunch Crew Battle Map service. By signing in or using the application, you agree to use it responsibly and only within your invitation and campaign permissions.">
    <section>
      <h2>Invitation and accounts</h2>
      <p>Access is limited to invited Google accounts. You may use only your own account and must not attempt to impersonate another participant, bypass campaign permissions, or provide access to an uninvited person. Campaign roles, controlled characters, and encounter access are determined by the application’s durable campaign memberships.</p>
    </section>
    <section>
      <h2>Acceptable use</h2>
      <p>Use the service for lawful tabletop gaming and related campaign preparation. Do not disrupt the service, probe for unauthorized data, evade security controls, upload malicious material, or submit content that violates another person’s rights. Respect private DM information and player communications exposed to you through the application.</p>
    </section>
    <section>
      <h2>Your content</h2>
      <p>You retain responsibility for campaign text, chat, handouts, images, maps, and other material you submit. You represent that you have the right to use that material. You permit the application to store, process, resize, display, and share it with authorized campaign participants as necessary to operate the service.</p>
    </section>
    <section>
      <h2>Experimental service</h2>
      <p>This is a small, evolving application provided for the Friday Lunch Crew. Features may change, malfunction, or become temporarily unavailable. Encounter state and campaign content may be corrected or restored when necessary to maintain the shared game. The application is not a substitute for independently retaining important campaign records.</p>
    </section>
    <section>
      <h2>Third-party services</h2>
      <p>Google authentication and Cloudflare infrastructure are governed by their respective terms and policies. The application is an independent fan-made tool and is not affiliated with or endorsed by Google, Cloudflare, Wizards of the Coast, or Hasbro.</p>
    </section>
    <section>
      <h2>Suspension and termination</h2>
      <p>Access may be suspended or removed to protect the application, its data, or its participants, or when an invitation or campaign membership ends. You may stop using the service at any time and may contact the administrator about removal of your account association.</p>
    </section>
    <section>
      <h2>Disclaimer and limitation</h2>
      <p>The service is provided “as is” and “as available,” without warranties of uninterrupted operation, data preservation, fitness for a particular purpose, or non-infringement. To the fullest extent permitted by applicable law, the administrator will not be liable for indirect, incidental, special, consequential, or punitive damages arising from use of the service.</p>
    </section>
    <section>
      <h2>Changes and contact</h2>
      <p>These terms may be revised as the application evolves. Continued use after an update means you accept the revised terms. Questions can be sent to <a href="mailto:dholmes97@gmail.com">dholmes97@gmail.com</a>.</p>
    </section>
  </LegalPage>;
}
