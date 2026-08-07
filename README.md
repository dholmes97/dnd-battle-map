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
npm run db:generate
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

With the development server running, exercise the authoritative multi-client
API path against its printed local URL:

```bash
BATTLE_MAP_BASE_URL=http://localhost:3000 npm run test:live
```

Replace port `3000` when the development server selected another port.

The worker creates and seeds the shared prototype encounter if it is absent.
The same schema is represented in `db/schema.ts` and the checked-in migration
under `drizzle/`; Sites owns the deployed D1 binding declared as `DB` in
`.openai/hosting.json`.
