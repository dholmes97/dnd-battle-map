# Refactor Plan

Last revalidated against `main` at `fab6fc9` on 2026-08-12.

This plan continues the lightweight ports-and-adapters boundary described in
`docs/ARCHITECTURE.md`. The framework-free core is real and useful, but most
feature orchestration still lives in two large adapters.

Nothing here is an emergency. The production build is green, lint is clean, and
100 unit/source-contract tests plus 8 live integration tests pass. The TypeScript
compiler is not yet a gate and currently reports 64 errors. This is debt paydown
intended to keep future feature work from becoming progressively slower. Every
stage should remain independently shippable and safe to stop after.

## Where the code actually is

Measured on the current tree, not estimated:

| Area | Current size |
|---|---:|
| `app/battle-map-prototype.tsx` | 3,790 lines |
| `BattleMapPrototype` component body | 2,392 lines |
| `app/map-workshop.tsx` | 537 lines |
| `worker/index.ts` | 3,492 lines |
| Framework-free modules in `shared/` | 15 files / 1,380 lines |
| Remaining untyped `.mjs` modules in `shared/` | 11 files / 785 lines |
| Hand-written runtime code in `app/`, `worker/`, and `shared/` | 9,275 lines |

`battle-map-prototype.tsx` and `worker/index.ts` contain about 79% of that
runtime code. The shared core has grown from roughly 425 to 1,380 lines, which is
healthy, but the adapters have grown faster.

- `handleCommand` is 1,351 lines. It has 29 top-level branch blocks covering 31
  command names and contains 83 direct `.prepare(...)` calls. The worker as a
  whole contains 187 `.prepare(...)` calls, so business orchestration and D1
  persistence remain tightly fused.
- `ensureSchema` is 513 lines and is reached from six request paths. It performs
  DDL, compatibility alters, data backfills, seed work, and one-time cleanup even
  though 17 checked-in Drizzle migrations also ship with the application. There
  are still two schema-evolution mechanisms.
- The main client component declares 83 `useState` values, 21 `useEffect` hooks,
  and 25 `useRef` values. It has at least 25 shared optimistic-command call sites
  plus bespoke optimistic flows for token moves, creates, and deletes.
- `npx tsc --noEmit` reports 64 errors: 61 in `worker/index.ts` and 3 in the app
  or typed shared modules. Fifty-three are implicit-`any` errors, many cascading
  from unresolved Cloudflare types. The compiler is not run by `npm test`.
- `tests/rendered-html.test.mjs` is 1,147 lines with 677 assertions. Of those,
  637 are `match`/`doesNotMatch` source or CSS assertions rather than behavioral
  tests.
- `npm test` still enumerates 14 test files by hand. A new unit test file is
  silently skipped unless the script is updated.
- `docs/ARCHITECTURE.md` has one stale example: `map-workshop-domain.mjs` no
  longer owns rotation, scene-object bounds, or sticker hit-testing after the
  matched-artwork workflow was retired.

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

## Stage 1 — Make the type checker a gate

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

## Stage 2 — Share and type contracts, then finish typing the core

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

## Stage 3 — Establish one schema-evolution path

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

## Stage 4 — Split Worker orchestration and persistence

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

## Stage 5 — Share deterministic transitions, not all side effects

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

## Stage 6 — Break up the main client component

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

## Stage 7 — Replace source contracts with behavioral UI tests

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

## Sequencing and risk

Stages 1 and 2 are now more valuable than when the plan was first written: new
type errors exist outside the Worker, demonstrating that the missing gate is an
active regression risk rather than theoretical cleanup.

Stage 3 should ship alone because schema changes affect every production request
and must preserve existing D1 data. Stage 4 is mechanical but broad; verify it
with the complete live suite and real multi-client use. Stage 5 is the only stage
with significant design uncertainty and should remain a two-command experiment
until latency, conflict behavior, and code clarity are measured.

The renderer portion of Stage 6 can happen before Stage 5 because it is already
mostly pure. The sync/optimistic extraction should wait for the transition pilot.
Stages 6 and 7 should then interleave: extract one feature and replace its source
assertions with behavioral coverage in the same change.

Feature work can continue throughout. If a feature must land in the current
Worker branch chain or main component before its stage arrives, ship the feature;
this plan exists to reduce future cost, not block present value.

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
