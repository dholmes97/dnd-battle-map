# D&D Battle Map

This is a desktop-first, accountless tactical companion for a trusted D&D
group. A vinext Worker owns the authoritative encounter API, D1 stores shared
state and append-only action history, and React canvas clients converge through
short conditional requests. Browser state is temporary.

The current local implementation includes free-position last-write-wins token
movement, multi-token claiming, initiative and rounds, summons, effects, HP,
visibility, pings, tactical drawings, creature drag/drop, and a DM-only map
workshop. The workshop generates editable forest, dungeon, cave, and ruins
starters, supports cohesive-scene additions and annotations, and keeps drafts
private until the DM applies the complete package. See `BATTLE-MAP-DESIGN.md` for verified
behavior and `IMPLEMENTATION-PLAN.md` for milestone status.

## Local development

Node.js 22.13 or newer is required. Node 24 LTS is recommended.

```bash
npm install
npm run build
npm run db:bootstrap
npm run dev
```

Open the printed local URL in two browser windows. Join both with code
`EMBER-KEEP` and different display names.

Useful checks:

```bash
npm run build
npm run lint
npm test
```

Before a production deployment that changes persistence or storage behavior,
create and verify a local D1/R2 snapshot with `npm run backup:production`. See
[`docs/PRODUCTION-BACKUPS.md`](docs/PRODUCTION-BACKUPS.md) for setup, contents,
and recovery precautions.

With the development server running, exercise the authoritative multi-client
API path against its printed local URL:

```bash
BATTLE_MAP_BASE_URL=http://localhost:3000 npm run test:live
```

Replace port `3000` when the development server selected another port.

The schema is represented in `db/schema.ts`, while checked-in numbered SQL files
under `drizzle/` are the sole schema and data-migration path. See
[`docs/DATABASE-MIGRATIONS.md`](docs/DATABASE-MIGRATIONS.md). Sites owns the
deployed D1 binding declared as `DB` in `.openai/hosting.json`.

## DM email scenario provisioning

The project includes a supervised, purpose-specific provisioning API and local
client for turning a validated DM email request into one atomic scenario job.
Set `BATTLE_MAP_SITE_URL`, a dedicated `SCENARIO_PROVISIONING_TOKEN` of at least
32 characters, and the comma-separated normalized
`SCENARIO_PROVISIONING_SENDERS` allowlist; do not reuse the catalog-import,
backup, or participant credentials. Then run a prepared
private envelope with:

```bash
npm run scenario:provision -- /absolute/path/to/envelope.json
```

See [`docs/DM-EMAIL-SCENARIO-PROVISIONING.md`](docs/DM-EMAIL-SCENARIO-PROVISIONING.md)
for the trust boundary, rollout status, and remaining mailbox configuration.
