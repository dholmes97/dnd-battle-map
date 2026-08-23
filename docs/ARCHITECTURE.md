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
- Existing health, token-control, action-history, map-package, spell-effect, and creature modules follow the same boundary.

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
write only the records and fields affected by a command. Every encounter
mutation nevertheless uses one request-scoped D1 unit of work: affected feature
records, the optimistic version assertion, encounter version increment, and
history row either commit together or all roll back. Undo/redo discovers its
stack through the history adapter, then delegates replay to the feature adapter
that owns the affected records instead of duplicating persistence rules.

D1 and R2 cannot share a transaction. Storage-backed workflows therefore record
idempotent write intents before an R2 put and commit D1 visibility plus cleanup
outbox rows atomically. Reconciliation is reference-aware, treats deletion as
idempotent, retries partial failures with backoff, and expires abandoned writes
and provisioning jobs. R2 deletion never precedes the D1 tombstone that makes an
object unreachable.

New work should extend the existing feature boundary, command family,
repository port, or shared transition that owns the behavior instead of adding
new root-component or request-router branches.

## Encounter maps

`map_images` is the canonical catalog for immutable image identity and metadata:
name, description, biome, mood, asset path, grid and pixel dimensions, and
source provenance. Each entry represents one cohesive high-resolution full-scene
map. Encounter rows reference that catalog separately for their active map and
their private Map Workshop draft. Each reference has a compact
`MapSetup` JSON document containing only prepared walls, portals, labels, notes,
and fog geometry. The Worker hydrates a full `MapPackage` transport DTO at the
adapter boundary so the canvas does not need to join persistence records.

Applying a draft atomically replaces the active image/setup pair, keeps the
draft aligned with it, resizes the encounter grid, and clamps tokens to the new
footprint. Saving a draft does not change player state; discarding it replaces
the draft pair with the active pair. Legacy package columns and preset rows are
retained as rollout recovery data. Current map commands never write them; the
Worker reads the old active package only as a bounded migration fallback.

## Live synchronization

Clients use short conditional requests keyed by encounter version. Unchanged
responses stop before loading encounter collections or calculating vision. The
initiating client paints optimistic operations immediately and keeps pending
reducers across refreshes; the Worker remains authoritative and confirms or
rolls back only the affected operation. The browser retains the last accepted
authoritative snapshot separately from visible state, projects one monotonically
ordered operation ledger over it, and serializes optimistic requests in that same
order. Success, rejection, timeout, and stale responses remove the matching
operation and reproject immediately; a failed recovery request cannot leave
rejected paint behind or delay pending-control cleanup. Session generations
isolate late responses and cancel unsent queued work after scenario navigation.
Browser requests use a composed default deadline through response
consumption, with caller cancellation preserved. For optimistic operations the
deadline begins when the reducer paints, so time spent waiting in the serialized
request queue consumes the same bounded budget instead of restarting it.

Unchanged visible polls use deterministic participant-specific jitter and an
activity-aware ceiling: approximately three seconds during active combat and
eight seconds during setup or a deliberate DM pause. A changed encounter
version, page focus, or restored visibility returns the client to the fast 250ms
cadence. This keeps active play responsive without making every idle participant
spend one Worker request and D1 version lookup per second.

Every browser encounter request carries a bounded operation ID and every Worker
response carries a server-generated request ID, echoes the operation ID, and
reports total and projection duration through `Server-Timing`. The Worker emits
privacy-safe structured completion records that classify conflicts, rate limits,
client and server failures, bounded projection collection sizes, and latency.
Unchanged polls are deterministically sampled at 1:32; changed responses and
failures remain observable. Unexpected client notices include a short server
reference so a report can be correlated without exposing sensitive state.

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
Finalization checks both job state and the target scenario version at the final
D1 batch boundary. Content-addressed assets remain protected by active write
intents and live-reference checks until their metadata wins or durable cleanup
work is queued.

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
