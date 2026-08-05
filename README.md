# D&D Battle Map — real-time movement proof

This repository contains the deliberately narrow phase-one prototype described
in `BATTLE-MAP-DESIGN.md`. It proves that two accountless browser participants
can join one encounter, contend for one short-lived server-authoritative token
lock, and see confirmed movement converge promptly.

## What the prototype includes

- one shared 16 × 11 canvas grid and one token;
- server-issued participant sessions kept only in browser memory;
- a fixed 12-second token lease with an on-screen countdown;
- choose, confirm, cancel, and automatic-expiry movement states;
- Server-Sent Events for prompt shared-state updates and reconnect handling;
- durable encounter, participant, token, and append-only action records in D1;
- generated Drizzle migrations packaged for Sites deployment.

Everything beyond that synchronization proof—including initiative, ownership
rules, HP, conditions, fog, annotations, map authoring, and undo—is intentionally
out of scope for this phase.

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

With the development server running, exercise the complete two-participant API
and event-stream path against its printed local URL:

```bash
BATTLE_MAP_BASE_URL=http://localhost:3000 npm run test:live
```

Replace port `3000` when the development server selected another port.

The worker creates and seeds the single prototype encounter if it is absent.
The same schema is represented in `db/schema.ts` and the checked-in migration
under `drizzle/`; Sites owns the deployed D1 binding declared as `DB` in
`.openai/hosting.json`.
