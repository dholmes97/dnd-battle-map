# D&D Battle Map — Living Design Record

## Purpose and boundaries

This is a **desktop-first D&D battle companion** used alongside Zoom and D&D Beyond. It is not a replacement for D&D Beyond character sheets: complete character information stays there.

The companion exists to make tactical play easier for the group: a capable shared map, dependable initiative and round tracking, and lightweight management of the temporary battle state that a character sheet does not conveniently hold.

## Problems to solve

The current D&D Beyond map experience does not provide:

- usable initiative and round management;
- rich, custom maps;
- practical tracking for summons, familiars, spell effects, and their relevant stats.

## V1 product direction

### Initiative and encounter state

- Show a real initiative timeline with turn order, the current round, and elapsed rounds.
- At combat start, players manually enter their own initiative rolls from D&D Beyond; the DM can audit every entry.
- Initiative remains fixed during combat in V1. For exceptional cases, the DM has a manual, DM-only correction.
- The owner of the active token has an **End Turn** action that advances to the next initiative entry.
- After the final initiative entry, the app increments the round and triggers relevant start- and end-of-turn reminders.
- The DM can advance or correct the initiative timeline at any time.
- Preserve the active encounter across refreshes and week-to-week pauses.
- Persist map state, token positions, initiative, HP and conditions, summons, effects, fog, and DM-only state.

### Maps

- Support flexible map building from terrain pieces and reusable, themed maps.
- Use Codex-assisted authoring before a session, but require **no live runtime AI dependency**.
- During play, support local/offline procedural map generation from tiles, dimensions, biome, and requested features (for example, a stream).

## Technical architecture

- Build and deploy the battle map with **Sites** as a TypeScript React web application, rather than as a static site-builder project.
- Use durable relational storage for encounter state and an append-only action history. The action history supports a per-user ten-step undo capability.
- Treat the server as authoritative for shared game state. Keep only temporary interface state in each participant's browser.
- Use short-lived token locks to prevent conflicting simultaneous movement.
- Render the battle map with a tile-based canvas renderer.
- Validate real-time multiplayer before committing to a specific synchronization provider. The first prototype must prove that two browsers can join one encounter, one participant can lock and move a token, and the other receives that move immediately.
- If Sites provides the required native live-session capability in that prototype, keep the entire solution in Sites. Otherwise, retain Sites for the app and durable database and add a small managed real-time service solely for live synchronization.

### Verified phase-one implementation

The phase-one proof remains inside the Sites stack: a vinext Worker owns the API, D1 stores encounter state and append-only actions, and clients conditionally poll for authoritative version changes. No separate real-time provider is part of the prototype.

The implemented slice uses a fixed twelve-second server lease for its single token. Joining creates a server-issued participant ID and secret that exist only in the current browser memory; reloading requires joining again. Lock acquisition, expiry, release, and confirmed movement are server operations, and lock expiry is recorded in the action history. Token centers use continuous map-space coordinates stored as relational `REAL` values, so the grid measures distance but does not constrain landing positions. A pointer press on the token acquires the lease implicitly, the token follows the drag at sub-cell precision, and releasing publishes the fractional drop without a separate confirmation step.

Local verification on August 5, 2026 exercised two independent browser windows against one D1-backed server. Both joined `EMBER-KEEP`, the non-owner received the lock state, an abandoned lease expired safely in both windows, and a subsequent confirmed five-foot move converged in both views. The matching token position and action history survived a server-process restart.

The free-position drag implementation was separately verified by dragging the token from `6.14, 2.41` to `10.48, 6.68`, spanning multiple grid cells and ending between grid lines. The second browser converged on the fractional drop in 180 milliseconds with no console warnings or errors.

Production verification on August 5, 2026 found that Sites buffered the original Server-Sent Events body until the 55-second response closed; a forced initial state and five keep-alives arrived together after 56.3 seconds. A server-side long-poll attempt also failed to observe cross-request D1 changes reliably within its wait window. The verified Sites-compatible transport therefore uses fresh conditional requests with a short client pause, while all shared state remains server-authoritative and durable in D1. Against the public deployment, the two-client API test measured confirmed movement propagation at 1,304 milliseconds, and two joined browser sessions converged on the same moved token and server version in 845 milliseconds with no console errors.

### Verified phase-two implementation

The next vertical slice expands `EMBER-KEEP` to three durable tokens. Token
ownership is stored in D1, each participant may own at most one token, and every
lock and movement operation is scoped to a token ID. This permits different
owners to move separate tokens concurrently while the server still rejects
unowned movement and conflicting access to the same token. Relinquishing a
token returns it to the shared pool. For this accountless trusted-group
prototype, rejoining with the same display name can explicitly reconnect that
character to the new browser session; the previous session immediately loses
movement authority.

Local verification on August 5, 2026 exercised three API clients and three
independent browser sessions. Two owners acquired different locks concurrently,
moved both tokens to fractional positions, and the observing client converged
on both confirmed drops in 14 milliseconds. A direct browser drag moved one
token to `10.99, 5.62` and appeared in both other sessions. Same-name reconnect
transferred ownership to a new browser, the superseded session was denied, and
claim, reconnect, lock, move, and relinquish actions were confirmed in the
append-only relational history. The browser run produced no warnings or errors.

Production verification on August 5, 2026 repeated the three-client API flow
against Sites version 6 and observed both concurrent fractional moves in 1.6
seconds. Three public browser sessions then claimed separate tokens and
converged on a direct drag to `10.65, 6.01`, with no console warnings or errors.

Token ownership now uses a presence lease to prevent a closed browser from
stranding a character indefinitely. An active browser sends an authenticated
heartbeat every twenty seconds. After two minutes without a valid heartbeat,
the server atomically releases that participant's claim and any token lock,
bumps encounter state, and appends a `token_claim_expired` action. Same-name
reconnect still transfers ownership immediately and does not wait for expiry.
Local verification forced a participant beyond the grace period and confirmed
the ownership, lock, shared version, and action-history changes while the
normal three-client movement test continued to pass.

### Visibility

- V1 uses simple, DM-controlled visibility rather than fog of war or per-character line-of-sight.
- The DM can reveal or hide information as the encounter requires.

### Map communication

- During combat, players may place temporary pings and draw tactical annotations on the map.
- The DM can clear temporary pings and annotations.
- Each participant independently pans and zooms the map.
- V1 includes a simple DM spotlight or attention ping to draw attention to a map area, without forcing anyone's camera to move.

### Roles and movement

- Players move their own tokens; the DM manages creatures, hidden information, and overrides.
- A summoned creature or familiar defaults to control by the player who owns its summoner; the DM may override that ownership.
- Summons and familiars share their summoner's initiative slot by default, rather than receiving independent initiative entries. That slot is a turn group: each round, the player may take their own turn and each summoned creature/familiar turn in any order, including before or after the summoner.
- Each member of a turn group has its own **End Turn** action; only the group's final **End Turn** advances the global initiative timeline.
- Movement is permission-aware and shows a live path and distance preview.
- V1 uses five-foot grid-based diagonal costing: a diagonal square costs the same as a horizontal or vertical square.
- The live movement preview and movement-allowance validation use rules distance calculated in grid squares.
- A move must support confirm or cancel, with rollback available.
- Start with a modular, DM-configurable rules framework that enforces token ownership and movement allowance, while always allowing a DM override.

### Encounter setup

- V1 uses manual placement and configuration of players and monsters.

### Joining and character scope

- Sessions are accountless: participants join through a shared link or short code and immediately claim an available character, with no DM approval.
- A participant can relinquish their claimed character to return it to the available pool and recover from an accidental selection; no DM approval is needed.
- The intended group is trusted, so abuse prevention and approval workflows are out of scope for V1.
- Store only battle-relevant, transient character state: identity, speed, optional HP, conditions, concentration, and timed effects.
- Keep full character sheets in D&D Beyond.
- In V1, D&D Beyond remains the owner of zero-HP handling, unconsciousness, death saving throws, and their interface; the battle-map app must not duplicate that workflow.

### HP visibility

- Exact HP is visible only to the character's owning player and the DM, never to other players.
- For non-owners, V1 communicates coarse health states instead of numbers, including **Bloodied** fixed at or below 50% HP and **Near Death**.
- **Near Death** defaults to at or below 25% HP; the DM may configure that threshold.
- Players see the same coarse health states for monsters and summons; exact monster and summon HP remains private to the DM.
- V1 has no D&D Beyond integration for HP. When a player takes damage or healing in D&D Beyond, that player manually applies the same change to their optional HP in the battle map.
- Exact HP is intentionally manual, duplicated state between the two apps; D&D Beyond remains the canonical character-sheet source.

### Effects

- Provide a structured manual **Add Effect** action.
- Include a small starter preset library, such as **Bless**, with targets, duration, and concentration.
- Visible conditions, including poisoned, stunned, and concentrating, appear both as compact icons on tokens and in a readable details panel.
- When damage is applied to a concentrating character, V1 reliably prompts the player and DM to consider a concentration check.
- The app need not determine whether a concentration roll is automatically unnecessary or duplicate D&D Beyond's saving-throw interface.
- When a timed effect reaches its expiry round, V1 shows a reminder and requires a player or the DM to confirm removal; it must not silently auto-remove the effect.
- Recurring effects, such as poison, support configurable reminder timing per effect, including the start or end of the affected creature's turn.

## Explicitly deferred (not V1 requirements)

- A large or comprehensive effect preset library.
- D&D Beyond action detection or other automated interpretation of D&D Beyond activity.
- Automated D&D Beyond initiative import.
- Automated D&D Beyond HP synchronization.
- Character-claim approval and abuse-prevention workflows.
- Zero-HP handling, unconsciousness, death saving throws, and their interface.
- Fog of war and per-character line-of-sight/vision.
- Reusable encounter presets.
- A competing Euclidean/geometric ruler. If added later, it must be clearly secondary and must never control legal movement.
- Ready actions, triggers, and reaction notes; these remain a verbal player/DM workflow.
- Rich reveal and teleport animations/effects.

## Open interview questions

1. **Movement reset (next question):** When a token's turn begins, should V1 automatically reset its movement allowance to its configured speed, with the DM able to correct it?

## Maintenance note

Treat this document as the living product-interview record for the standalone D&D Battle Map project. Update it when product decisions are made; do not mix its scope with the Old School Mustangs campaign journal.
