# Battle Map Architecture

The application uses a lightweight ports-and-adapters (hexagonal) boundary. The goal is not a framework of abstractions; it is to make deterministic battle-map decisions executable without React, the browser, HTTP, Workers, or D1.

## Domain core

Framework-free, strictly typed modules live in `shared/`. They accept plain data,
return plain data, and have direct Node unit tests.

- `contracts.ts`: the one transport shape for encounter state and the typed command registry shared by both adapters.
- `battle-map-policies.ts`: movement authorization and stable map-scene identity.
- `battle-map-geometry.ts`: token bounds, distance, drawing hit-testing, and viewport navigation.
- `initiative-domain.ts`: roster grouping, initiative groups, and turn transitions.
- `map-workshop-domain.ts`: map-thumbnail paths, grid snapping, and note hit-testing.
- `encounter-domain.ts`: scenario codes, viewer-safe map projection, and history conflict messages.
- Existing health, token-control, action-history, map-package, spell-effect, creature, and full-scene modules follow the same boundary.

Domain modules must not import React, DOM APIs, Worker APIs, D1, R2, or networking code. If a rule needs the current time, randomness, persistence, or identity, pass that information in as data.

## Adapters

- `app/` is the React/browser adapter. It owns rendering, pointer events, canvas drawing, audio, local storage, and optimistic UI orchestration.
- `worker/` is the HTTP/persistence adapter. It owns request parsing, authorization lookup, D1/R2 queries, transactions, and response projection.

The React adapter is split by cohesive feature boundaries: one owner each for
live synchronization, canvas rendering, canvas gesture orchestration, chat/handouts, token controls,
scenario controls, catalog paging, map assets, personal settings, history
shortcuts, toolbar/palettes, dialogs, and encounter sidebar composition. The
Worker dispatches typed command families through narrow repository ports whose
production adapters live under `worker/adapters/`.

`useEncounterSync` exposes session, command, optimistic token, and history
operations. Its pending mutation maps, sequence counters, and undo/redo storage
are adapter internals and are not shared with React consumers.

Adapters may translate framework-shaped records into domain-shaped data, invoke a domain function, and translate the result back. A decision used by both adapters belongs in `shared/`; it should not be reimplemented in each adapter.

Shared transitions do not imply whole-encounter persistence. Worker handlers
write only the records and fields affected by a command. Side-effect-led
workflows such as chat and handouts, scenario creation, catalog imports, and
history persistence remain adapter orchestrations that call shared policies
where useful rather than being forced through a universal reducer.

New work should extend the existing feature boundary, command family,
repository port, or shared transition that owns the behavior instead of adding
new root-component or request-router branches.

## Live synchronization

Clients use short conditional requests keyed by encounter version. Unchanged
responses stop before loading encounter collections or calculating vision. The
initiating client paints optimistic operations immediately and keeps pending
reducers across refreshes; the Worker remains authoritative and confirms or
rolls back only the affected operation.

This polling adapter is deliberate for the current small trusted group. Earlier
production trials found that the hosting path buffered Server-Sent Events and
did not make cross-request D1 changes dependable inside a long poll. Do not
replace the transport with streaming or push merely by assumption: first prove
cross-client delivery, failure recovery, and request cost on the deployed
platform. The domain and command contracts must remain transport-independent.

## Scenario provisioning

Email scenario provisioning is another adapter around the shared domain, not a
second application control plane. The Gmail workflow converts trusted bounded
intent into the versioned manifest defined by `shared/scenario-provisioning.ts`.
Only the dedicated provisioning API may stage derived assets and atomically
create or revise a scenario. Its token and sender allowlist grant no participant,
backup, catalog-import, deployment, SQL, or arbitrary R2 capability.

Outbound Gmail identity is persisted separately from thread context. Every
candidate message is classified before its content is parsed, and every reply
is reserved, marked, sent, and recorded so a self-addressed workflow cannot
interpret its own response as a new revision. See
`docs/DM-EMAIL-SCENARIO-PROVISIONING.md` for the operational contract.

## Persistence evolution

`db/schema.ts` describes the current D1 shape. Numbered SQL files under
`drizzle/` are the only mechanism that changes deployed or local data. The Sites
deployment adapter and the explicit local bootstrap command apply those files;
ordinary Worker requests perform only a small read-only readiness check. See
`docs/DATABASE-MIGRATIONS.md` for the authoring and release workflow.

## Testing convention

Every extracted rule gets a direct `node:test` contract in `tests/`. Extracted
React behavior gets Vitest and Testing Library contracts under
`tests/components/`. Source assertions in `rendered-html.test.mjs` are reserved
for packaged assets, adapter wiring, retired-path absence, and other structural
constraints that cannot be observed through a focused behavior test.

The validation order is:

1. `npm test` for mandatory typechecking, the production build, every
   automatically discovered direct/unit/source contract in `tests/*.test.mjs`,
   and all Vitest component contracts.
2. `npm run lint` for adapter and test hygiene.
3. `BATTLE_MAP_BASE_URL=http://localhost:3000 npm run test:live` for the isolated
   `tests/live/` Worker/D1 and multi-client integration suite.
4. Use a real browser for release-level canvas pointer, drag/drop, and responsive
   viewport checks that jsdom cannot model credibly.
