# Refactor Plan

Last revalidated against the completed working tree after `94d3160` on
2026-08-13. All seven stages are complete; this document now records the
result and the constraints that future work should preserve.

This plan continues the lightweight ports-and-adapters boundary described in
`docs/ARCHITECTURE.md`. The framework-free core, typed command families, narrow
persistence ports, and cohesive React feature boundaries are now established.

The production build, lint, typecheck, 92 framework-free/adapter tests, 14 React
component tests, and 8 live integration tests pass. A real-browser smoke test
also covers the join flow, battle-map composition, and square-cell Map Workshop
geometry. TypeScript is a mandatory test gate.

## Where the code actually is

Measured on the current tree, not estimated:

| Area | Current size |
|---|---:|
| `app/battle-map-prototype.tsx` | 1,178 lines |
| `BattleMapPrototype` component body | about 1,020 lines |
| `app/map-workshop.tsx` | 528 lines |
| `worker/index.ts` | 1,666 lines |
| Framework-free modules in `shared/` | 17 typed files / 1,641 lines |
| Remaining untyped `.mjs` modules in `shared/` | 0 files |
| Hand-written runtime code in `app/`, `worker/`, and `shared/` | 10,340 lines |

The two former monoliths now contain about 27% of runtime code rather than about
70%. The additional runtime lines are cohesive feature modules, typed ports,
D1 adapters, command families, and shared transitions rather than duplicated
root-component or request-router logic.

- `handleCommand` uses a typed dispatch map across six command families. SQL is
  isolated behind six narrow repository ports and D1 adapters; `worker/index.ts`
  now has 36 direct `.prepare(...)` calls, limited to HTTP projection and
  remaining request-level persistence concerns.
- Stage 3 moved the 513-line request-time `ensureSchema` body into one
  checked-in migration. The remaining guard is read-only and small enough to
  audit directly.
- The main client component has 16 `useState` and 8 `useEffect` call sites.
  Rendering, synchronization, chat/handouts, token controls, scenarios,
  catalog state, map assets, history shortcuts, personal settings, palettes,
  command bar, dialogs, and encounter sidebar all have explicit owners.
- `npm run typecheck` reports no errors and is the first mandatory step in
  `npm test`.
- `tests/rendered-html.test.mjs` is 96 lines with 31 narrowly structural
  `match`/`doesNotMatch` assertions. User-visible React behavior is covered by
  14 Vitest/Testing Library contracts.
- `npm test` automatically discovers `tests/*.test.mjs`; live tests are isolated
  under `tests/live/`.
- `docs/ARCHITECTURE.md` now describes the typed contracts and current Map
  Workshop responsibilities.

## The root problem

The refactor shared decisions, but it did not yet share enough contracts or
transitions.

Turn advance remains a useful example. Both adapters use shared initiative
arithmetic, but the worker translates the result into SQL while the client
separately reproduces the state transition for optimistic painting. Similar
duplication exists for HP, effects, combat state, annotations, fog, and token
updates. The two implementations are kept aligned partly by tests and partly by
rules in `AGENTS.md`.

There is also no single typed encounter/API contract. The client declares its
own large `EncounterState` shape while the worker declares database rows and
constructs the response separately. Missing fields such as
`initiative_group_id` can therefore survive until an unrelated type-checking
pass finds them.

The eventual fix is shared typed contracts plus shared deterministic transition
functions. A single universal reducer for every command is no longer the right
target: chat, handout/R2 work, scenario creation, catalog imports, and history
recording have materially different side effects. The shared core should own
deterministic decisions; adapters should continue to own authorization, I/O,
transactions, and targeted persistence.

## Stage 1 — Make the type checker a gate (complete)

This remains the smallest and highest-leverage first step.

- Add `@cloudflare/workers-types` as a dev dependency and reference the correct
  Worker runtime types from `tsconfig.json` so `Fetcher`, `D1Database`, and
  `R2Bucket` resolve. Recount the remaining errors afterward instead of assuming
  every implicit `any` was only a missing-library cascade.
- Fix the current non-cascade errors, including:
  - `worker/index.ts:354` calls `.then` on a `Response`.
  - `worker/index.ts:1707-1708` assign untyped rows to `ActionRow[]`.
  - `worker/index.ts:2543` reads `.prompt` from a source union that no longer
    guarantees that property.
  - `worker/index.ts:3043` constructs a `TokenRow` without
    `initiative_group_id`.
  - `worker/index.ts:3478` uses optional `env.IMAGES` without narrowing it.
  - `app/battle-map-prototype.tsx:1655`, `app/map-workshop.tsx:378`, and
    `shared/full-scene-maps.ts:176` contain three newer adapter/shared typing
    errors that did not exist when the first plan was written.
- Add a dedicated `typecheck` script and run it before the production build in
  `npm test`.
- Stop hand-enumerating unit test files. Move the live suite under a distinct
  `tests/live/` path (or otherwise separate it), then let the unit script run a
  directory/glob that automatically includes new unit tests.

Exit criteria: `npm test` fails on a new type error, and a new unit test file is
run without editing `package.json`.

## Stage 2 — Share and type contracts, then finish typing the core (complete)

The typed and untyped parts of `shared/` are now mixed. Four TypeScript modules
already demonstrate that direct Node tests and typed shared code coexist cleanly;
the remaining 11 `.mjs` modules should no longer default every adapter call site
to `any`.

- Define shared transport contracts for encounter state, tokens, effects,
  annotations, chat messages, handouts, map presets, and the command-name/payload
  union. Keep database row types in the Worker adapter; transport/domain types
  should not expose D1 naming.
- Move the client-local `EncounterState` family of types into that shared
  contract and type the worker's response projection against the same shape.
- Convert the remaining `.mjs` domain modules to TypeScript incrementally, or add
  complete JSDoc plus `checkJs` for modules that are clearer as JavaScript.
  Prefer one checked implementation over sibling declarations that can drift.
- Preserve direct `node:test` contracts for each module.
- Correct the stale Map Workshop description in `docs/ARCHITECTURE.md` as part of
  this documentation pass.

Exit criteria: neither adapter receives `any` from a shared domain import, and
the encounter response shape is expressed once and checked on both sides of the
HTTP boundary.

## Stage 3 — Establish one schema-evolution path (complete)

Separate this from command extraction. Schema behavior is important enough to
review and deploy on its own.

- Make checked-in numbered migrations the source of truth for DDL, indexes,
  compatibility alterations, backfills, and one-time production cleanup.
- Keep local/preview bootstrap explicit, but do not run hundreds of lines of
  schema mutation from ordinary state, asset, upload, and command requests.
- Reduce `ensureSchema` to a small readiness/version guard, or remove it once
  every supported environment reliably applies migrations before serving.
- Document how local development, live tests, and Sites production deployment
  apply migrations so there is one intentional workflow rather than two
  accidental truths.

Exit criteria: a schema change is authored once, production requests do not
perform DDL or data migrations, and `ensureSchema` is small enough to audit at a
glance.

## Stage 4 — Split Worker orchestration and persistence (complete)

This is mostly mechanical, but use cohesive command families rather than one
tiny file per command.

- Replace the 29-block chain with a typed dispatch map.
- Group handlers by domain, for example: chat/handouts, history,
  scenarios/maps, initiative/combat, tokens/effects, and annotations/fog.
- Give handlers a consistent typed context for the participant, encounter,
  clock/ID providers, repositories, action recording, and response projection.
- Introduce narrow persistence ports and D1 adapters. SQL belongs in those D1
  adapters; authorization and battle-map decisions do not.
- Centralize common authorization, encounter bumping, action recording, and
  viewer projection in the dispatcher or explicit services instead of copying
  them across branches.
- Do not change command behavior while moving it. Run the eight live tests
  unchanged and do a real multi-client play session before calling this stage
  complete.

Exit criteria: adding a command means registering a typed handler, command
handlers are reviewable (roughly 150 lines or less), and domain handlers can be
tested with fake ports without D1. This limit applies to handlers, not every
Worker utility file.

Implementation result: six cohesive command families register through the typed
dispatcher, six D1 adapters implement narrow repository ports, and handler
behavior is directly tested with fake ports. The unchanged eight-test live suite
passes against the local Worker.

## Stage 5 — Share deterministic transitions, not all side effects (complete)

This is the design-risk stage and should proceed command by command.

- Add small pure transition functions in `shared/` for commands whose visible
  result is deterministic: movement, initiative/turn state, HP, effects, token
  details, annotations, fog settings, and combat status are candidates.
- Inject time, generated IDs, identity, and already-authorized context as input
  data when a transition needs them. Do not let the shared function call browser,
  Worker, D1, or R2 APIs.
- Use the same transition for the initiating client's optimistic paint and the
  Worker's authoritative decision.
- Keep targeted SQL writes. Do not materialize and rewrite the entire encounter
  merely to claim a universal reducer; that would increase conflict and latency
  risk, especially for movement and live polling.
- Leave side-effect-led commands such as handout upload/delete, chat delivery,
  scenario creation, catalog import, and history persistence as adapter
  orchestrations that call shared policies where useful.
- Pilot on movement because it is frequent, latency-sensitive, and already has
  strong live regression coverage. Migrate one additional low-frequency command
  before generalizing the pattern.
- Remove an `AGENTS.md` consistency rule only when a typed shared transition and
  direct parity test actually enforce it.

Exit criteria: the optimistic and authoritative results for a migrated command
are proven identical by one shared transition test, without replacing targeted
D1 updates with whole-state persistence.

Implementation result: movement and HP use shared typed transitions in both the
React and Worker adapters. Parity tests exercise both adapters, while D1 still
performs targeted writes and side-effect-led commands remain orchestration.

## Stage 6 — Break up the main client component (complete)

The file has grown by more than 750 lines since the first plan. Avoid introducing
a global state framework unless extraction proves ordinary hooks and typed
controllers insufficient.

Extract in this order:

- **Canvas renderer.** Move `drawMap`, attached effect rendering, persistent
  spell rendering, fog painting, and spotlight helpers into a renderer module
  with an explicit render input.
- **Live sync and optimistic orchestration.** Move polling,
  `acceptAuthoritativeState`, pending mutation reconciliation, rapid-turn
  serialization, and network command execution into a typed hook/service. Do
  this after the Stage 5 pilot so it wraps shared transitions rather than
  preserving bespoke closures as a new abstraction.
- **Chat and handouts.** Their channel, unread, upload, immediate-view queue, and
  lightbox state form one cohesive feature boundary.
- **Creature and spell palettes.** Their catalog paging, arming, previews,
  summoner selection, and one-shot spell placement form another boundary.
- **Roster, token details, effects, and encounter controls.** Feed
  presentational components from already-tested domain selectors.
- **Scenario controls and personal display settings.** Keep browser-local
  persistence isolated from shared encounter state.

`app/map-workshop.tsx` is already a separate 537-line feature and does not need
to be folded back into the root. Prefer cohesive feature files over forcing every
file below an arbitrary number. A useful target is a root component below about
1,000 lines that reads primarily as composition and orchestration.

Exit criteria: no feature-specific panel is implemented inline in the root, the
sync lifecycle has one owner, and the root component's state is organized by
feature boundary rather than one flat list of 83 hooks.

Implementation result: the root fell from 3,692 to 1,178 lines and now reads as
composition plus map interaction orchestration. Feature panels and their state
live in cohesive components/hooks, while `useEncounterSync` remains the single
owner of authoritative refresh and optimistic reconciliation.

## Stage 7 — Replace source contracts with behavioral UI tests (complete)

`rendered-html.test.mjs` still earns its place because it guards many product
rules, but 637 source-pattern assertions create substantial false coupling to
markup and implementation details.

- Add a React component behavior harness. Vitest plus Testing Library is a
  natural fit for the Vite/React adapter, but a `node:test` plus DOM harness is
  acceptable if it remains readable. Keep the framework-free domain suites on
  `node:test`.
- As each Stage 6 feature is extracted, render it and test user-visible state,
  accessibility, callbacks, and optimistic/pending behavior.
- Use a small real-browser suite only for interactions a DOM emulator cannot
  validate credibly, especially canvas pointer geometry, drag/drop, and viewport
  sizing.
- Keep source assertions for truly structural requirements: packaged assets,
  absence of retired code paths, generated deployment wiring, and constraints
  that cannot be observed at runtime.
- Convert incrementally. Every removed source assertion must be replaced by a
  behavioral contract or explicitly judged redundant.

Exit criteria: source-pattern assertions fall below roughly 100, intentional
markup refactors do not require broad assertion rewrites, and the product rules
remain covered at the domain, component, or browser level appropriate to each.

Implementation result: source-pattern checks fell to 31. Vitest and Testing
Library cover extracted component behavior, the default test gate includes them,
and the remaining canvas/viewport behavior has domain geometry contracts, live
integration coverage, and a real-browser release smoke check.

## Release and ongoing risk

The staged work remained deployable throughout. The final release gate is the
complete unit/component/build/lint/live/browser sequence plus a freshly verified
production D1/R2 backup outside the repository. Future features should extend
the existing feature boundary, command family, repository port, or shared
transition that owns the behavior instead of growing new root-level branches.

## Explicitly not in scope

- No dependency-injection framework, abstract class hierarchy, or enterprise
  architecture layer. Plain functions, typed data, and narrow ports remain the
  intended style.
- No rewrite. Every stage is incremental and leaves the application deployable.
- No relaxation of server-authoritative shared state, durable D1 history,
  private browser drafts, or the public accountless trusted-group model.
- No whole-encounter persistence on every command merely for reducer symmetry.
- No move away from `node:test` for the framework-free domain core.
- No deletion of behavior rules from `AGENTS.md` until executable contracts make
  the corresponding prose unnecessary.
