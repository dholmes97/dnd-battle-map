# D&D Battle Map — Implementation Plan

This roadmap turns the product decisions in `BATTLE-MAP-DESIGN.md` into small,
deployable vertical slices. Each milestone must preserve server authority,
durable D1 state, append-only action history, temporary browser state, and
clear reconnect and conflict safety.

## Status

| Phase | Milestone | Status |
| --- | --- | --- |
| 1 | One shared token, durable fractional movement, locking, and two-client synchronization | Complete |
| 2 | Multiple tokens, player claiming/ownership, and independent token locks | Complete |
| 3 | Initiative order, rounds, active turn, and End Turn | Complete |
| 4 | Movement allowance, path distance, and DM override | Complete |
| 5 | DM encounter setup, creature placement, and map selection | Complete |
| 6 | Summons, effects, conditions, concentration reminders, and lightweight HP | Complete |
| 7 | Visibility, pings, tactical annotations, and multiplayer scale hardening | Complete |
| 8 | Private map workshop, procedural starters, editable packages, and staged publication | Complete locally |

## Phase 1 — Real-time movement foundation

Delivered:

- One public encounter with one durable token.
- Continuous map-space placement with no grid snapping.
- Direct grab, drag, and release movement.
- Short server-issued lock leases and server-confirmed movement.
- Durable encounter state and append-only action history in D1.
- Reconnect safety and verified two-client propagation.

## Phase 2 — Multi-token ownership

Goal: make the prototype behave like a small party encounter instead of a
single shared pawn.

Scope:

- Seed at least three durable tokens in `EMBER-KEEP`.
- Let each joined participant claim one available token.
- Allow a participant with the same display name to reclaim that token after a
  reload; this is an explicitly trusted-group recovery rule, not authentication.
- Let a participant relinquish their token.
- Renew active participant presence every twenty seconds and release abandoned
  claims after two minutes without a valid heartbeat.
- Require token ownership for lock and movement operations.
- Scope locks and moves by token ID so different tokens can move concurrently.
- Render all tokens on the shared map and identify their owners in the control
  panel.
- Preserve fractional drag placement and authoritative action history.

Acceptance criteria:

- Three browser sessions join the same encounter and see the same three tokens.
- Two participants claim different tokens; a third cannot claim either one.
- A participant cannot claim a second token without relinquishing the first.
- Each owner can grab and drag only their token.
- Different owned tokens can hold locks and move independently.
- Two clients competing for the same token cannot both acquire its lock.
- Fractional positions, ownership, and action records survive refresh/restart.
- All three clients converge on the same token roster and positions promptly.
- Reconnect, lock expiry, rejected ownership, and reclaim states are explicit.
- A stale claim releases its ownership and lock atomically and records the
  expiry in action history.

Out of scope for this phase:

- DM authentication or override powers.
- Initiative and turn enforcement.
- Movement-speed enforcement.
- Creating arbitrary tokens through the UI.
- Hidden creatures or per-player visibility.

Delivered August 5, 2026. The automated three-client production test observed
two concurrent fractional moves in 1.6 seconds. Three production browser
clients also claimed separate tokens and converged on a direct drag with no
console warnings or errors.

## Phase 3 — Initiative and rounds

- Manual initiative entry with DM audit visibility.
- Fixed combat order, active entry, current round, and elapsed rounds.
- End Turn actions and DM correction/advance controls.
- Server-enforced transitions and durable action history.
- Turn groups for a character plus summons/familiars.

Delivered August 5, 2026. Initiative, round, active-group, movement-reset, End
Turn, forced advance, and DM correction transitions are server-authoritative and
durable. The automated flow verified that a summoner and summon share one slot
and that the global timeline advances only after both finish.

## Phase 4 — Movement rules

- Continuous path preview over the free-position map.
- Equal-cost diagonal distance expressed in five-foot grid units.
- Per-turn movement allowance and reset.
- Server validation with an explicit DM override path.
- Clear rejection and rollback when a drop exceeds legal movement.

Delivered August 5, 2026. The client records a continuous fractional path and
the server independently calculates equal-cost diagonal distance. The automated
flow verified allowance use, over-budget rejection without position drift, and
an explicit DM override.

## Phase 5 — Encounter setup

- DM placement and configuration for players and creatures.
- Map selection and reusable terrain composition.
- Ownership assignment and encounter start controls.
- Persistent pause/resume across sessions.

Delivered August 5, 2026. A DM can select a durable terrain map, place and
configure tokens, pause or resume play, reset to setup, and start combat. The
portrait library includes Dar'eleth, Malichar, Jelton, a shadow dire warg,
Hungry, and a young green dragon.

## Phase 6 — Tactical state

- Summons and familiars tied to their summoner's turn group.
- Conditions, effects, concentration, durations, and reminders.
- Optional exact HP for owner/DM and coarse health states for others.
- Manual synchronization boundaries with D&D Beyond.

Delivered August 5, 2026. Summons inherit owner and initiative group; token HP,
conditions, concentration, duration, and reminder timing are durable. Exact HP
is personalized to the owner and DM, other players receive only a coarse health
state, and damage to a concentrating token returns an explicit reminder.

## Phase 7 — Collaboration and hardening

- DM-controlled visibility.
- Temporary pings, drawings, and attention spotlight.
- Multi-client load tests and D1 request-budget measurements.
- Revisit the polling transport before scaling beyond the trusted small-group
  target; adopt a managed push service if measured latency or load requires it.

Delivered August 5, 2026. Hidden tokens are filtered on the server, pings and DM
spotlights expire automatically, drawings persist until cleared, and pan/zoom
remain local to each browser. A measured eight-client run converged on one
annotation in 133 ms and produced 27.6 idle conditional requests per second in
aggregate. Conditional polling remains suitable for the current trusted-group
POC, but the measured idle request rate warrants a push transport before the
audience or session duration grows materially.

## Phase 8 — Map workshop and procedural authoring

Delivered locally August 6, 2026:

- A separate DM-only workshop that keeps draft changes private until **Apply to
  players** and restores the authoritative map with **Discard**.
- Seeded forest, dungeon, cave, ruins, swamp, desert, tundra, volcanic, and
  coastal starters in three map sizes, with
  density, landmarks, path, water, atmosphere, and reroll controls.
- An editable versioned map-package model containing per-cell terrain,
  irregular multi-cell stamps, walls, doors, windows, labels, and DM notes.
- Twenty-eight searchable, biome-aware palette pieces across nature, structures,
  furnishings, details, and hazards. Procedural generation rotates and flips
  stamps deterministically; manual placement uses drag and drop.
- One-cell terrain correction with optional organic edge rendering. Organic
  edges soften the presentation without changing the exact underlying cells.
- Stamp move/rotate/flip/duplicate/layer/delete, click-drag terrain correction,
  wall previews snapped to grid intersections, structure deletion, and a
  fifty-step private draft undo/redo history.
- A local prompt interpreter with durable saved presets, six original fixtures,
  twenty additional AI-prompt test maps, and JSON import/export for
  Codex-assisted authoring without a live runtime AI dependency.
- Authoritative D1 persistence for applied packages and private DM presets.
  Applying a new map resizes the shared grid and safely reclamps existing token
  centers; players receive only the applied package, never the draft library.

Verified locally with lint, production build, 18 generation/rendering tests,
and five live API scenarios. The latest live run observed two-token convergence
in 22 ms, edited-map application in the shared player state, and eight-client
collaboration convergence in 149 ms. This phase has not been published; local
testing remains the requested workflow.

The August 7 expansion added five generated terrain textures and twenty saved
themes spanning swamp, desert, tundra, volcanic, coast, and fey forest. An
independent state read-back confirmed all 20/20 additional packages are
distinct, editable, durable, and DM-private. `SAVED-MAP-CATALOG.md` records the
complete added set.

## Definition of done for every phase

- The server remains authoritative for every shared mutation.
- Durable state and action history are stored relationally.
- Browser state is temporary and safe to discard.
- Authorization and lock conflicts fail closed with understandable UI states.
- Schema changes include an inspected migration.
- Lint, build, automated tests, and the milestone's real multi-client flow pass.
- The verified source is committed, pushed, and deployed to the public Site.
- `BATTLE-MAP-DESIGN.md` is updated only with verified implementation findings.
