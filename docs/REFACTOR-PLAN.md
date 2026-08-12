# Refactor Plan

This plan continues the boundary work started in `docs/ARCHITECTURE.md`. That
commit extracted the domain core. This plan addresses the two adapters, which
were not touched and which now hold most of the maintenance cost.

Nothing here is urgent. The build is green, lint is clean, and 78 unit tests plus
8 live integration tests pass. This is debt paydown to keep the cost of the next
ten features flat rather than rising, and every stage is designed to be shippable
on its own and abandonable without stranding the ones before it.

## Where the code actually is

Measured on the current tree, not estimated:

| Area | Size |
|---|---|
| `app/battle-map-prototype.tsx` | 3,026 lines |
| `worker/index.ts` | 2,951 lines |
| All domain modules in `shared/` combined | ~425 lines |

Two files hold roughly 78% of the hand-written code; the domain core is about 5%.

- `handleCommand` is 1,221 lines across 26 `if (command === …)` branches, with SQL
  inlined throughout. There are 107 `env.DB.prepare` calls in the worker and no
  repository boundary, so business rules and persistence are fused.
- `ensureSchema` is 427 lines of DDL invoked on four request paths, in parallel
  with the checked-in `drizzle/` migrations. Two sources of schema truth.
- The client is a single component starting at line 1139 with 31 `useState`,
  17 `useEffect`, and 20 `useRef`, holding roughly 30 inline optimistic reducers.
- `npx tsc --noEmit` reports 53 errors, all in `worker/index.ts`, and nothing runs
  it. 44 are implicit-`any` cascading from unresolved Cloudflare types.
- `tests/rendered-html.test.mjs` contains 534 assertions of which 449 match
  against source text or CSS rather than behavior.
- The domain modules are untyped `.mjs` with no JSDoc and no `.d.ts`, so the
  most-shared code in the repository is also the least type-checked.

## The root problem

The refactor shared decisions but not transitions.

Turn advance is the clearest case. Both adapters correctly call the shared
`nextInitiativeTurn` for ordering arithmetic. The worker then applies the result
as SQL and the client applies the same result as an immutable object spread in
`advanceEncounterTurn`. One rule, two implementations, in two languages, kept in
agreement by hand. That pattern repeats for every optimistic command.

The cost is visible in process rather than in code: `AGENTS.md` carries 47 rules,
six of which exist only to keep optimistic and authoritative state agreed. Those
rules are prose standing in for a missing abstraction. A rule in a markdown file
is enforced by whoever remembers to read it; a shared reducer is enforced by the
compiler and the test suite.

Stage 4 is the fix. Stages 1 through 3 make it safe to attempt.

## Stage 1 — Make the type checker a gate

Smallest change on this list and it makes every later stage safer to attempt.

- Add `@cloudflare/workers-types` as a dev dependency and reference it from
  `tsconfig.json` so `D1Database`, `Fetcher`, and `R2Bucket` resolve. This clears
  44 of the 53 errors on its own.
- Fix the remaining errors, which are real signal rather than missing types:
  - `worker/index.ts:300` calls `.then` on a `Response`.
  - `worker/index.ts:1316-1317` assign `{}[]` where `ActionRow[]` is required.
  - `worker/index.ts:2065` reads `.prompt` on a union member that lacks it.
  - `worker/index.ts:2519` builds a `TokenRow` without `initiative_group_id`.
    Currently benign because `canControlToken` reads only `summoner_token_id`,
    but it is luck rather than design: the initiative-group feature added a field
    and this construction site was missed silently.
  - `worker/index.ts:2937` uses `env.IMAGES` without a presence check.
- Add `tsc --noEmit` to `npm test` ahead of the build.
- Replace the hand-enumerated test file list in `package.json` with a glob. A new
  test file currently runs only if someone remembers to register it, so a
  forgotten entry is an invisible gap rather than a failure.

Exit criteria: `npm test` fails on a new type error, and adding a test file to
`tests/` runs it without editing `package.json`.

## Stage 2 — Type the domain core

The domain is the code most likely to be reused and currently the code least
checked. `allowJs` means every adapter call site receives `any`.

- Add JSDoc `@param`/`@returns` annotations, or sibling `.d.ts` files, to each
  module in `shared/`. Either approach keeps direct `node:test` execution intact.
- Prefer whichever reads better per module: JSDoc for the small policy modules,
  `.d.ts` for `initiative-domain.mjs` and `battle-map-geometry.mjs` where the
  shapes are larger.
- Enable `checkJs` for `shared/` once the annotations land, so the domain is
  verified rather than merely described.

Exit criteria: no `any` at domain call sites in either adapter, and the roster
row and viewport geometry shapes are expressed once rather than restated in each
adapter's local types.

## Stage 3 — Split `handleCommand`

Mechanical, low-risk, and a prerequisite for Stage 4. Do not change behavior here.

- Replace the 26-branch `if` chain with a dispatch map from command name to
  handler function, one handler per command, each in its own module under
  `worker/commands/`.
- Give every handler the same signature so the shared concerns — authorization,
  action recording, response projection — are applied by the dispatcher once
  instead of being repeated per branch.
- Leave SQL where it is for now. Moving persistence and restructuring control
  flow in one step makes review impossible.
- Reconcile the schema duplication: either treat `ensureSchema` as the single
  source and document `drizzle/` as generated, or move to migrations only and
  reduce `ensureSchema` to a version check. Pick one and say which in
  `ARCHITECTURE.md`.

Exit criteria: no function in `worker/` exceeds ~150 lines, the live suite passes
unchanged, and adding a command means adding a file rather than editing a chain.

## Stage 4 — One shared command reducer

The centerpiece. This removes the duplicated-transition problem rather than
documenting it.

- Define `applyCommand(state, command) → state` in `shared/`, pure and total over
  the encounter shape the client already models.
- The client runs it for the optimistic paint, exactly where the ~30 inline
  reducers live today.
- The worker runs it against a materialised encounter, then persists the diff.
  This is the harder half: it trades hand-written targeted `UPDATE` statements
  for load-apply-persist, so measure it before committing to the pattern for
  every command. Movement is the right pilot — highest frequency, smallest state.
- Migrate one command at a time. Both paths can coexist during the transition.
- As each command moves, delete the corresponding consistency rule from
  `AGENTS.md` and cite the reducer test instead. The rule count going down is the
  signal that this stage is working.

Exit criteria: optimistic and authoritative results for a migrated command are
proven identical by a single test over the shared reducer, and no `AGENTS.md`
rule is needed to keep them aligned.

## Stage 5 — Break up the client component

Do this before the next large feature, not after. The current component is where
new state accretes fastest, and 31 `useState` in one scope is 31 opportunities
for two pieces of state to disagree.

Extract in this order, cheapest and most isolated first:

- **Canvas renderer.** `drawMap` and its five effect helpers are already at
  module scope and take explicit arguments; move them to `app/map-renderer.ts`
  more or less as they stand.
- **Sync and optimistic layer.** The pending refs, `acceptAuthoritativeState`,
  `runOptimisticCommand`, and the long-poll loop become a hook or a small store.
  Sequence this after Stage 4 so it wraps the shared reducer rather than 30
  bespoke closures.
- **Roster panel and detail panel.** Presentational components fed by
  `buildRosterRows`, which is already pure and already tested.
- **UI settings and personal display state.** Self-contained, and localStorage
  persistence is easier to reason about outside a 1,884-line body.

Exit criteria: no single file in `app/` exceeds ~600 lines, and the main
component reads as composition rather than implementation.

## Stage 6 — Behavioral tests for the UI

`rendered-html.test.mjs` earns its place today because it is the only thing
holding the UI rules, but 449 source-text assertions is the most expensive
coverage in the repository. Every intentional UI change pays a tax in assertion
rewrites that have nothing to do with behavior changing.

- Add jsdom and a component test runner.
- As each area is extracted in Stage 5, replace its source greps with tests that
  render the component and assert on behavior.
- Keep source assertions only for what cannot be observed at runtime: asset
  packaging, absence of retired code paths, and structural constraints.
- Do not attempt a bulk conversion. Convert per extraction, so each rewrite has a
  behavioral test to replace it rather than a gap.

Exit criteria: source-text assertions in `rendered-html.test.mjs` fall below ~100,
and a deliberate UI change no longer requires editing test assertions to pass.

## Sequencing and risk

Stages 1 and 2 are safe and independently valuable; do them whenever there is a
quiet afternoon. Stage 3 is mechanical but touches every command, so it wants a
full live-suite run and a real session of play afterward. Stage 4 is the only
stage with genuine design risk and should be piloted on movement alone before
committing to the pattern. Stages 5 and 6 interleave: extract a region, then
replace its source assertions with behavioral ones.

Feature work can continue throughout. If a feature would land in
`handleCommand` or the main component before Stage 3 or 5 reaches it, ship the
feature — this plan exists to reduce future cost, not to block present value.

## Explicitly not in scope

- No abstraction framework, dependency-injection container, or class hierarchy.
  The existing plain-functions-over-plain-data boundary is the right one for this
  application's size and should not be replaced.
- No rewrite. Every stage is incremental and leaves the app shippable.
- No change to the public accountless trusted-group model, server-authoritative
  shared state, durable D1 history, or any behavior rule in `AGENTS.md` except the
  optimistic-consistency rules that Stage 4 makes redundant.
- No move away from `node:test` for the domain. It is fast, dependency-free, and
  the new domain suites demonstrate it is sufficient.
