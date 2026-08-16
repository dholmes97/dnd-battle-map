# D&D Battle Map

A desktop-first, accountless tactical companion for a trusted D&D group. A
vinext Worker owns the authoritative encounter API, D1 stores shared state and
append-only action history, R2 stores map, handout, and creature art, and React
clients converge through short conditional requests. Browser state is temporary.

The application currently supports:

- four fixed identities: Dan, Barry, Scott, and DM Kevin;
- durable scenarios with independent maps, tokens, chat, handouts, combat state,
  and history;
- initiative groups, summons, movement tracking, HP, effects, and concentration
  reminders;
- optimistic shared interactions with server-authoritative reconciliation;
- reusable high-resolution full-scene maps and Map Workshop presets;
- off, shared DM-controlled, and dynamic player-vision fog modes;
- a storage-backed creature palette and persistent spell effects;
- scenario-scoped public/private chat and image handouts; and
- bounded email-to-scenario provisioning for trusted senders.

## Local development

Node.js 22.13 or newer is required. Node 24 LTS is recommended.

```bash
npm install
npm run build
npm run db:bootstrap
npm run dev
```

Open the printed local URL in multiple browser windows, choose a scenario, and
join with different fixed identities.

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
