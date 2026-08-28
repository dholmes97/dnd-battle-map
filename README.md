# D&D Battle Map

A desktop-first tactical companion for a trusted D&D group. Invited humans sign
in with Google, while campaign roles and characters remain application-owned. A
vinext Worker owns the authoritative encounter API, D1 stores shared state and
append-only action history, R2 stores map, handout, and creature art, and React
clients converge through short conditional requests. Browser state is temporary.

The application currently supports:

- four invited Google-linked human identities with campaign-scoped roles and characters;
- campaign creation and invited-player management for authorized campaign creators;
- a Force of Nature campaign containing durable encounters with independent maps, tokens, chat, handouts, combat state,
  and history;
- initiative groups, summons, movement tracking, HP, effects, and concentration
  reminders;
- optimistic shared interactions with server-authoritative reconciliation;
- database-backed high-resolution map images and durable per-encounter Map Workshop drafts;
- off, shared DM-controlled, and dynamic player-vision fog modes;
- a storage-backed creature palette and persistent spell effects;
- scenario-scoped public/private chat and image handouts; and
- bounded email-to-scenario provisioning for trusted senders.

## Local development

Node.js 26.7.0 is the pinned development and CI baseline. Use the version in
`.node-version`; `package.json`, `@types/node`, and every GitHub Actions job are
kept aligned with it. This build-and-test baseline is separate from the Sites
runtime, which is governed by the generated Cloudflare Worker compatibility
date and flags.

```bash
npm install
npm run build
npm run db:bootstrap
npm run dev
```

Open the printed local URL. Localhost exposes a development-only identity
switcher so multiple browser windows can exercise different people without
changing Google accounts. To exercise the real Google flow locally, copy
`.dev.vars.example` to `.dev.vars` and supply OAuth credentials.

## Google authentication

Create a Google Cloud OAuth 2.0 **Web application** client and register these
redirect URIs:

```text
http://localhost:3000/api/auth/google/callback
https://dnd.fridaylunchcrew.com/api/auth/google/callback
```

Use the exact local port printed by the development server if it differs from
3000. The application requests only `openid email profile`; it does not request
Gmail access. Production requires the Sites secrets
`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.

The source credentials are stored in macOS Keychain under account
`dnd-battle-map`, using services `dnd-battle-map-google-oauth-client-id` and
`dnd-battle-map-google-oauth-client-secret`. Do not print their values or copy
them into tracked files; transfer them only through masked production-secret
tooling or a process-local environment used for testing.

Use these canonical URLs in Google OAuth branding:

```text
Homepage:       https://dnd.fridaylunchcrew.com/
Privacy policy: https://dnd.fridaylunchcrew.com/privacy
Terms:          https://dnd.fridaylunchcrew.com/terms
```

The privacy and terms routes must remain publicly accessible without signing
in and linked from the sign-in page.

The Google-ready 120-pixel logo is
`public/assets/friday-lunch-crew-oauth-logo-120-v1.png`; its high-resolution
source is `public/assets/friday-lunch-crew-logo-master-v1.png`.

Useful checks:

```bash
npm test
npm run lint
```

With the development server running, exercise the authoritative multi-client
path against its printed URL:

```bash
BATTLE_MAP_BASE_URL=http://localhost:3000 npm run test:live
```

Replace port `3000` if the development server selected another port.

## Production operations

The public application origin is
[dnd.fridaylunchcrew.com](https://dnd.fridaylunchcrew.com). Sites owns the
deployed `DB` and `MAP_ASSETS` bindings declared in `.openai/hosting.json`.

Checked-in numbered SQL files under `drizzle/` are the only schema and data
migration path. See [Database migrations](docs/DATABASE-MIGRATIONS.md).

Run `npm run backup:production` before destructive or non-additive migrations,
bulk data or asset mutations, or persistence refactors with a credible data-loss
risk. Ordinary additive changes and bounded APIs do not require a backup. See
[Production backups](docs/PRODUCTION-BACKUPS.md).

## Scenario provisioning

The trusted email workflow turns a bounded, validated request into one atomic
scenario job through a dedicated API. It uses a separate
`SCENARIO_PROVISIONING_TOKEN` and sender allowlist; it cannot execute arbitrary
commands, SQL, URLs, deployments, or generic production mutations.

The trusted local clients are:

```bash
npm run scenario:provision -- /absolute/path/to/envelope.json
npm run scenario:mail-reply -- reserve <jobId> <clarification|ready|failed>
npm run scenario:mail-reply -- record <jobId> <replyId> <gmailMessageId> <gmailThreadId>
npm run scenario:mail-reply -- classify <mailboxKey> <gmailMessageId> <gmailThreadId> [responseMarker]
```

See [DM email scenario provisioning](docs/DM-EMAIL-SCENARIO-PROVISIONING.md).

## Durable project guidance

- [AGENTS.md](AGENTS.md): current product decisions and implementation rules.
- [Architecture](docs/ARCHITECTURE.md): ports-and-adapters boundaries and test
  conventions.
- [Feature backlog](docs/FEATURE-BACKLOG.md): unshipped product ideas only.
- [Creature catalog](docs/CREATURE-CATALOG.md): catalog data and provenance.
- [Token art provenance](public/assets/tokens/README.md): generated token assets.

Completed plans and superseded design notes are intentionally removed instead
of retained as active context; Git history remains the archive.
