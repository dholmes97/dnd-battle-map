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
- Resolve competing authorized token movement with server-authoritative last-write-wins updates; movement has no reservation phase.
- Render the battle map with a tile-based canvas renderer.
- Validate real-time multiplayer before committing to a specific synchronization provider. The first prototype must prove that two browsers can join one encounter, move a shared token without a reservation round trip, and promptly converge on the server-confirmed position.
- If Sites provides the required native live-session capability in that prototype, keep the entire solution in Sites. Otherwise, retain Sites for the app and durable database and add a small managed real-time service solely for live synchronization.

### Verified phase-one implementation

The phase-one proof remains inside the Sites stack: a vinext Worker owns the API, D1 stores encounter state and append-only actions, and clients conditionally poll for authoritative version changes. No separate real-time provider is part of the prototype.

Joining creates a server-issued participant ID and secret that exist only in the current browser memory; reloading requires joining again. Token movement has no lock or reservation operation: pointer drag begins immediately, the token follows at sub-cell precision, and release submits the fractional destination directly to the authoritative server. Token centers use continuous map-space coordinates stored as relational `REAL` values, so the grid measures distance but does not constrain landing positions. When a controlling player and the DM move the same token, both accepted actions remain in history and the latest accepted database update defines the shared position.

Local verification on August 6, 2026 exercised direct movement from three API clients against one D1-backed server without any reservation request. Two owned tokens moved concurrently and the observing client converged on both fractional drops in 22 milliseconds. A separate player-plus-DM test moved one shared token twice and confirmed that the second accepted position was canonical; the retired lock route returned `404`.

The free-position drag implementation was separately verified by dragging the token from `6.14, 2.41` to `10.48, 6.68`, spanning multiple grid cells and ending between grid lines. The second browser converged on the fractional drop in 180 milliseconds with no console warnings or errors.

Production verification on August 5, 2026 found that Sites buffered the original Server-Sent Events body until the 55-second response closed; a forced initial state and five keep-alives arrived together after 56.3 seconds. A server-side long-poll attempt also failed to observe cross-request D1 changes reliably within its wait window. The verified Sites-compatible transport therefore uses fresh conditional requests with a short client pause, while all shared state remains server-authoritative and durable in D1. Against the public deployment, the two-client API test measured confirmed movement propagation at 1,304 milliseconds, and two joined browser sessions converged on the same moved token and server version in 845 milliseconds with no console errors.

### Verified phase-two implementation

The next vertical slice expands `EMBER-KEEP` to three durable tokens. Token
ownership is stored in D1, each participant may own at most one token, and every
movement operation is scoped to a token ID. This permits different owners to
move separate tokens concurrently while the server still rejects unowned
movement. The DM and owning player may both move the same token, with the last
accepted movement becoming authoritative. Relinquishing a
token returns it to the shared pool. For this accountless trusted-group
prototype, rejoining with the same display name can explicitly reconnect that
character to the new browser session; the previous session immediately loses
movement authority.

The multi-client verification suite confirms concurrent movement of separate
owned tokens, direct last-write-wins movement of the same token by its player
and the DM, same-name ownership transfer, denial of the superseded session, and
durable claim, reconnect, move, and relinquish actions. The server returns no
movement-lock state and exposes no lock or unlock route.

Production verification on August 5, 2026 repeated the three-client API flow
against Sites version 6 and observed both concurrent fractional moves in 1.6
seconds. Three public browser sessions then claimed separate tokens and
converged on a direct drag to `10.65, 6.01`, with no console warnings or errors.

Token ownership now uses a presence lease to prevent a closed browser from
stranding a character indefinitely. An active browser sends an authenticated
heartbeat every twenty seconds. After two minutes without a valid heartbeat,
the server atomically releases that participant's claim, bumps encounter state,
and appends a `token_claim_expired` action. Same-name
reconnect still transfers ownership immediately and does not wait for expiry.
Local verification forced a participant beyond the grace period and confirmed
the ownership, shared version, and action-history changes while the normal
three-client movement test continued to pass.

### Verified initiative-through-collaboration implementation

The remaining V1 roadmap was implemented locally on August 5, 2026. D1 now
stores encounter status and terrain, initiative and rounds, token movement/HP/
visibility, summons, effects, and tactical annotations. The Worker remains the
authority for every shared mutation. The browser retains only session identity,
the current drag origin and preview, tool choice, and its independent pan/zoom viewport.

Initiative is manually entered, fixed into durable turn groups when the DM
starts combat, and advanced by server-validated End Turn actions. A summon or
familiar inherits its summoner's owner and initiative group; each group member
must finish before the timeline advances. Starting an active group resets its
movement, while DM timeline correction remains available.
Tokens without an initiative entry remain freely movable during an active
encounter; turn-order enforcement applies only after a token has been assigned
to an initiative group. Permission and turn-order rejections are shown directly
over the map.
Returning to setup clears the combat round and order without deleting the
entered initiative rolls.

Free-position movement uses only the token's starting point and current
destination. During drag, the canvas leaves a dot at the origin, draws one
straight dotted ruler to the token, and labels the direct equal-cost-diagonal
distance on the line. The ruler and label turn red when the move would exceed
the token's remaining movement, but this warning is advisory and never blocks
the drop. The server independently recalculates the same direct distance,
accumulates movement used even beyond the nominal speed, and records the
confirmed endpoints and distance in action history. Local verification on
August 6, 2026 confirmed that a move taking movement from 10 to 40 feet was
accepted and marked over budget. Pointer drag confirms on release; the
discarded keyboard-step control is intentionally absent because direct dragging
is the sole movement interaction. Pointer release also freezes the confirmed
destination immediately and submits it without a reservation request, so later
pointer motion cannot alter the drop point. A personal ten-action undo stack applies
compensating mutations for reversible actions and appends each undo to the
audit history rather than deleting history.

The tactical UI supports DM map selection and token configuration, twenty
transparent portrait assets, summons/familiars, a small Bless/Poisoned/Stunned
effect preset set, custom effects and reminder timing, manual HP changes,
concentration-check reminders, hidden tokens, compact audible pings that pulse
exactly three times and then disappear, drawings, and DM
spotlights. Personalized state responses filter hidden tokens and exact HP on
the server. This is still an accountless trusted-group tool: participants
self-select the DM role, so the role boundary is coordination rather than
strong authentication.

Automated local verification covered three concurrent token clients, the full
initiative/movement/setup/tactical flow, and an eight-client collaboration
run. The latest run observed two-token convergence in 20 ms, eight-client
annotation convergence in 133 ms, and 27.6 idle conditional requests per second
across eight clients. Two browser tabs separately joined as player and DM;
claim, movement, cross-tab convergence, local-only zoom, portrait placement,
and UI undo passed with no new console errors. Conditional polling remains the
verified Sites-compatible POC transport. Its measured idle request rate is
acceptable for this small trusted group, but a managed push transport should be
reconsidered before materially larger groups or longer-running deployments.

### Verified creature-palette implementation

The DM placement flow was replaced on August 5, 2026 with an overlay palette of
seventeen creature templates. A creature can be dragged to an exact map point,
or armed once and placed repeatedly by clicking the map. The palette remains
open between placements, automatically numbers duplicate names, and permits a
controller context to be chosen once for a batch: DM-controlled or summoned by
an existing primary token. Name, HP, speed, portrait, visibility, and size can
all be completed or revised after the authoritative placement is confirmed.

Token size is now durable D1 state and part of the action history. The standard
footprint defaults are Tiny (half a square), Small/Medium (one square), Large
(two squares), Huge (three squares), and Gargantuan (four squares). Rendering,
hit testing, client drag bounds, server placement bounds, later resizing, and
server-confirmed movement all use the selected size. Changing size near a map
edge safely reclamps the token center instead of allowing the enlarged token to
extend off the board; movement remains continuously positioned between grid
lines.

The expanded library adds fourteen original transparent tactical cutouts to the
six existing portraits. Local browser verification opened the palette, rendered
all seventeen templates without warnings, placed a Small goblin at `11.88,
6.55`, changed it to Large through the post-placement editor, and removed it
again. API verification confirmed Large placement-edge clamping, Huge resize
clamping, summon ownership inheritance, two-token convergence in 19 ms, and
eight-client annotation convergence in 149 ms.

### Verified map-workshop implementation

The pre-session authoring workflow is a separate DM-only workshop. Its draft is
browser-temporary and invisible to players until the DM explicitly applies the
complete map package; Discard restores the last authoritative package. Saved
presets are durable D1 records but are returned only in DM-personalized state.
The applied package, its grid dimensions, and the resulting action are durable
and authoritative. Applying a differently sized map reclamps existing tokens
inside the new bounds.

The local/offline generator supports forest, dungeon, cave, ruins, swamp,
desert, tundra, volcanic, and coastal starters,
three sizes, density, landmark count, paths, water, atmosphere, and deterministic
seeds. Generated maps remain editable as exact terrain cells plus movable,
rotatable, flippable multi-cell and irregular stamps. The initial palette has
twenty-eight biome-aware pieces, including dedicated nature, structure,
furnishing, detail, and hazard options. Every palette definition now requires a
dedicated transparent RGBA raster asset; generated and saved maps no longer
depend on letter tiles or generic palette previews. Walls, doors, windows, public or DM-only
labels, and DM notes share the package format and can be added or deleted in the
workshop. Terrain corrections support click-drag painting; wall placement shows
a live grid-intersection preview; and stamps support duplicate and front/back
layer ordering in addition to move, rotate, flip, and delete. A fifty-step
private undo/redo history never mutates player state.

Organic terrain boundaries are a presentation layer over exact cell ownership:
the renderer builds deterministic irregular masks and softly composites the
same terrain textures, while the faint tactical grid remains above the map.
This avoids an edge-tile permutation library and preserves predictable painting
and package data.

The prompt path intentionally has no deployed LLM dependency. A deterministic
local interpreter turns plain-language biome, mood, water, density, and feature
cues into the same editable package, while JSON import/export is the boundary
for richer Codex-assisted maps prepared before a session. Six original prompt
fixtures and twenty additional theme tests are saved in the local preset
library. The added themes span swamp, desert, tundra, volcanic, coastal, and fey
forest maps and use five new generated terrain textures. Local verification on
August 7, 2026 passed lint, a production build, nineteen package/rendering tests,
an independent 20/20 durable-preset read-back, and five live
authoritative API scenarios; the edited draft supplied during Apply was visible
to the player client and was not replaced by its older saved preset.

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
- Movement is permission-aware and shows a live origin-to-token ruler with its direct distance.
- V1 uses five-foot grid-based diagonal costing: a diagonal square costs the same as a horizontal or vertical square.
- The live ruler and authoritative movement record use the same direct rules distance calculated in grid squares.
- Drag release confirms a move; pointer cancellation safely discards the temporary preview.
- Token ownership and active-turn permissions remain enforced. Movement allowance is advisory: excess distance turns the ruler red but is still accepted.

### Encounter setup

- V1 uses a DM creature palette for rapid drag/drop or repeated click placement; detailed configuration is intentionally optional until after placement.

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

## Resolved implementation decisions

- Movement allowance resets automatically when a turn group becomes active;
  exceeding that allowance is visibly warned but never blocks movement, and the
  DM retains timeline correction controls.

## Maintenance note

Treat this document as the living product-interview record for the standalone D&D Battle Map project. Update it when product decisions are made; do not mix its scope with the Old School Mustangs campaign journal.
