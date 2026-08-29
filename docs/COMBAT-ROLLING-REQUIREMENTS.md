# Combat Rolling and Damage Adjudication Requirements

## Status and authority

This document records the approved product direction for shared attack rolling,
DM damage adjudication, and the multi-client testing support used to build and
verify that workflow. The feature is deployed in production in `qa` mode, so
only the isolated Combat QA campaign can create new rolls and proposals.

These requirements refine the broad product boundaries in
`docs/FEATURE-BACKLOG.md`. D&D Beyond remains the authority for complete
character sheets and rules content. The battle map may retain a deliberately
small set of final, roll-ready action values so attacks can resolve against live
encounter tokens without becoming a second character-sheet or rules engine.

## Product intent

Combat rolling should remove the repeated handoff between a dice roller and the
battle map:

1. A participant identifies an attacking token and a visible target.
2. The participant selects one of the attacker's small set of configured
   actions.
3. The application rolls the attack and damage authoritatively.
4. The server resolves the attack against private encounter data without
   disclosing that data to an unauthorized viewer.
5. The DM adjudicates proposed damage with one compact action.
6. Accepted damage enters the existing authoritative HP, concentration, live
   synchronization, and Undo/Redo paths.

The experience should feel like a shared tabletop dice roll, not an automated
combat simulator. The DM remains the final rules authority.

## Goals

- Let a player attack a visible monster directly from the map with minimal
  interaction.
- Let the DM use the same workflow for a monster attacking a player character
  or summon.
- Keep private armor class, exact HP, and hidden tokens server-filtered.
- Make player-originated damage a durable request that the DM can apply,
  reduce, increase, nullify, adjust, or reject.
- Reuse campaign characters, creature catalog records, token ownership,
  initiative groups, effects, HP transitions, action history, and optimistic
  live synchronization.
- Store only final roll-ready action values rather than reconstructing them
  from ability scores, classes, equipment, proficiency, feats, or rules text.
- Automatically include Bless's attack-roll d4 when the authoritative attacker
  currently carries the existing durable Bless effect.
- Make a bounded initial subset of catalog creatures attack-ready with reusable
  basic action profiles.
- Give the DM a structured ad hoc Attack fallback when a creature has no
  configured action data.
- Produce deterministic domain decisions that can be tested without React,
  Worker APIs, D1, or browser APIs.
- Support realistic two-client development tests without weakening production
  Google identity binding.
- Allow the complete rolling workflow to ship disabled, run only in QA, or run
  for all eligible campaigns without changing unrelated encounter behavior.

## Non-goals

The initial feature does not:

- recreate a D&D Beyond character sheet;
- calculate attack bonuses from attributes, proficiency, equipment, class
  levels, feats, or inventory;
- track spell slots, ammunition, limited uses, rests, or other character-sheet
  resources;
- import, scrape, or synchronize D&D Beyond data through an unofficial API,
  browser extension, or page parser;
- reproduce D&D Beyond rules text or licensed compendium content;
- require complete attack coverage for the entire creature catalog before the
  first release;
- infer resistance, vulnerability, immunity, cover, reactions, or situational
  rules automatically, except for the explicitly supported Bless attack bonus;
- enforce weapon reach, spell range, line of sight, or cover automatically;
- become a complete D&D rules engine; or
- grant a production administrator a general ability to impersonate Dan,
  Barry, Scott, Kevin, or an arbitrary application identity.

## Terminology

- **Authenticated identity:** The durable human identity bound to a Google
  `sub`, such as Dan. This identity never changes because a testing view or
  encounter role changes.
- **Attacker:** The controlled creature token performing the action.
- **Target:** The visible creature token against which the action is resolved.
- **Combat action profile:** A bounded, structured record containing final
  values needed to roll one action.
- **Roll record:** The immutable server-generated dice and resolution result.
- **Damage proposal:** The durable pending request created from a successful
  damaging roll.
- **Adjudication:** The DM's decision to apply, modify, nullify, or reject a
  damage proposal.
- **QA persona:** A synthetic, non-login participant usable only in an isolated
  production test campaign by an explicitly authorized human tester.

## MVP scope

### Supported action class

The MVP supports a single-target attack roll against armor class. This covers
ordinary weapon attacks and spell attacks such as Guiding Bolt.

Each use supports:

- normal, advantage, or disadvantage attack rolling;
- the configured final attack bonus;
- natural 1 as an automatic miss;
- natural 20 as an automatic hit and critical hit;
- one primary damage component;
- one standard damage type or untyped damage;
- a server-rolled damage result;
- critical damage that rolls damage dice twice while adding the flat modifier
  once;
- an optional single alternate damage mode, such as a versatile longsword's
  one-handed and two-handed formulas;
- one additional d4 on the attack roll when the attacker has the authoritative
  Bless effect; and
- one attacker and one target.

The participant may repeat an action for Extra Attack or Multiattack. Bundled
multiattack automation is deferred.

A configured combat action profile is the normal source of roll values. When a
creature has no configured actions, the DM may instead use the bounded generic
Attack workflow defined below. Players may not invent ad hoc action values.

### Explicitly deferred action classes

- Saving-throw spells and abilities
- Automatic-hit actions such as Magic Missile
- Area and multi-target attacks
- Healing rolls
- Contested checks
- Mixed damage components such as slashing plus fire
- Optional on-hit additions such as Divine Smite or Sneak Attack
- Damage-over-time and start/end-of-turn automatic rolls
- Expanded critical ranges or feature-specific critical formulas
- Reroll mechanics and minimum-die rules
- Automatically interpreted effects other than Bless, such as Haste, cover,
  prone, or invisibility
- Resource consumption and recharge rolls

The stored model should be extensible to additional resolution modes and
multiple damage components later, but adapters must not expose incomplete
future behavior in the MVP.

## Three-mode feature gate

Combat rolling is controlled by one server-owned deployment mode with exactly
three values:

- **`off`:** No participant can create a new roll. Ordinary rolling entry
  points and action-profile maintenance surfaces are hidden.
- **`qa`:** Rolling is enabled only in the designated isolated QA campaign for
  its authorized QA sessions. Ordinary campaigns behave exactly as `off`.
- **`all`:** Rolling is enabled for eligible ordinary campaigns as well as the
  QA campaign.

The browser receives a derived capability in its authenticated server
projection. It never selects, submits, or overrides the authoritative mode,
campaign classification, or eligibility decision. Both configured action rolls
and the DM generic Attack command must enforce the mode in the Worker even when
a client calls their endpoints directly.

### Safe disablement and data preservation

Changing from `all` or `qa` to `off` stops new roll creation immediately without
rolling back schema or deleting data.

- Action profiles, immutable roll records, resolved proposals, and HP history
  remain durable and unchanged while disabled.
- Previously accepted damage remains an ordinary HP/history result and retains
  its existing Undo/Redo behavior.
- A mode change never undoes HP, removes Bless, resets initiative, changes token
  ownership, or mutates an encounter.
- Pending proposals enter a bounded drain state. The initiating participant and
  DM can still see them, and the DM can apply, adjust, nullify, reject, or cancel
  them, but no replacement roll can be created.
- Once no pending proposals remain, disabled ordinary encounter polling must
  skip loading roll/action collections and calculating roll projections.
- Re-enabling the mode restores preserved profiles and history without a data
  migration, repair step, or client-authored recovery action.
- Existing movement, direct HP controls, initiative, effects, Bless VFX, spells,
  chat, handouts, map interactions, and Undo/Redo remain operational in every
  mode.

Feature-gate checks belong at the rolling command, projection, and presentation
boundaries. Existing feature repositories and commands must not acquire a
dependency on the combat-roll repository or feature mode.

## Minimum copied character and creature data

The battle map needs final action values, not the facts used to derive them.
For a basic attack, the required copied data is:

- action name;
- final attack bonus;
- damage die count and die size, or a static damage value;
- flat damage modifier;
- damage type; and
- optional alternate damage label and formula.

For example, a campaign character could carry:

| Action | Attack bonus | Damage | Type | Alternate |
| --- | ---: | ---: | --- | --- |
| Longsword +1 | +9 | 1d8+5 | Slashing | Two-handed 1d10+5 |
| Javelin of Lightning | +8 | 1d6+4 | Piercing | None |
| Guiding Bolt | +8 | 4d6 | Radiant | None |
| Unarmed Strike | +8 | 5 | Bludgeoning | None |

Ability scores, proficiency bonus, class, level, spellcasting ability, item
bonuses, inventory state, and explanatory notes are not required to roll these
actions. When a level, item, or other character-sheet change alters a final
number, a controller or DM updates the affected combat action profile manually.

Bless does not add another copied action-profile value. Its d4 comes from the
attacker's existing encounter-scoped effect state at the moment the Worker
creates the roll.

The encounter already supplies the defender-side values required by the MVP:
token identity, visibility, ownership, armor class, current HP, maximum HP,
effects, and initiative state.

### Structured data requirement

Dice expressions must be stored and validated as structured values. Neither
the Worker nor the browser may evaluate an arbitrary expression string.
Human-readable forms such as `1d8+5` are presentation generated from the
structured record.

A combat action profile needs, at minimum:

- stable action ID;
- bounded display name;
- enabled state and stable display order;
- resolution mode, initially `attack-vs-ac` only;
- bounded integer attack bonus;
- primary damage dice count, die size, flat modifier, and damage type;
- melee or ranged classification plus optional display-only reach/range;
- an explicit manual-rider indicator when the primary attack has additional
  effects the MVP cannot resolve;
- optional alternate damage label and structured formula; and
- durable owner reference.

Resource limits must bound profiles per owner, name lengths, integer ranges,
dice counts, supported die sizes, alternate variants, and total projected
records. New D1 collections require both adapter-level quotas and trigger
backstops consistent with `shared/resource-limits.ts`.

### Ownership and lifecycle

- Character action profiles are campaign-scoped and belong to a durable
  `campaign_character`, not a browser session, human display name, or encounter
  token ID.
- The character's controller and the campaign DM may maintain that character's
  action profiles.
- Creature action profiles are reusable catalog metadata and are loaded lazily
  with the creature workflow rather than projected as the entire catalog in
  every encounter poll.
- A summon created from the creature catalog may use the catalog action profile
  while control continues to derive from its root campaign character.
- A placed monster must retain a stable relationship to the catalog action data
  or a bounded placement-time snapshot. The implementation design must choose
  one explicit policy before schema work. Whichever policy is chosen, later
  catalog edits must not silently rewrite an immutable historical roll record.
- Every roll record snapshots the action name, attack bonus, formula, damage
  type, and individual dice actually used. Editing an action affects only
  future rolls.

### Action maintenance surface

Character action profiles should be maintained with campaign character combat
details, outside the live battle-map interaction path. The live token card may
display and invoke actions but should not expand into a full character editor.

Creature actions belong to the storage-backed creature catalog preparation
workflow. The initial implementation may seed only the creatures needed for
the active campaign rather than attempting to populate a complete bestiary.

## Creature attack readiness

### Initial catalog enrichment

Basic creature actions are part of the MVP because the DM-to-player workflow
cannot function without roll-ready monster values. Complete catalog coverage is
incremental rather than a release gate.

The initial attack-ready subset must include:

- every catalog creature placed in the QA encounter;
- a bounded selection of monsters currently used or expected soon in Force of
  Nature encounters; and
- enough representative melee and ranged actions to exercise both presentation
  paths.

Each enriched creature stores only the basic action values needed by this
feature: action name, final attack bonus, melee/ranged classification, primary
damage formula, damage type, optional display-only reach/range, source
provenance, and whether manual rider resolution is required.

Creature action enrichment is an offline catalog preparation/import operation,
not a live browser or Worker download during combat. Source data must follow the
same rules version and licensed provenance as the existing creature record.
SRD and other open-license attribution remains preserved. The importer must not
scrape ordinary D&D Beyond pages or silently substitute a similarly named
creature from another rules version.

New or revised production catalog actions use the existing secret-protected
batch importer in groups of at most ten. Attack-profile validation must complete
before the creature is described as attack-ready.

### Complex source actions

The importer must not present a partial action as fully automated.

- An ordinary attack with one primary damage component can be attack-ready.
- An attack with an additional save, condition, grapple, poison, secondary
  damage component, or similar rider may import the supported attack and
  primary damage only if it is visibly marked `Manual rider`.
- The DM review surface must then state that additional stat-block resolution
  is required before applying or adjusting the final damage/effect.
- Multiattack is not imported as one executable roll. The DM repeats its basic
  constituent attacks individually.
- Saving-throw-only actions, breath weapons, and other unsupported resolution
  modes remain unavailable until their dedicated expansion.

### DM generic Attack fallback

When the selected attacking creature has no configured combat action profiles,
the DM receives a generic **Attack** action. It opens a compact structured form
for:

- optional bounded attack label, defaulting to `Attack`;
- final attack bonus;
- damage die count and supported die size, or static damage;
- flat damage modifier;
- damage type; and
- normal, advantage, or disadvantage.

The fallback uses the selected attacker and target and otherwise follows the
same server-authoritative roll, private AC resolution, Bless modifier, damage
proposal, adjudication, history, and HP paths as a configured action.

- Generic values are accepted only from the authenticated campaign DM.
- Values are bounded and transported as structured fields, never parsed or
  evaluated as arbitrary expressions.
- The resulting immutable roll records the entered values and identifies its
  action source as `dm-ad-hoc`.
- The ad hoc submission does not mutate the creature catalog or silently create
  a durable action profile.
- The UI clearly labels it as an unsaved generic attack. Durable catalog
  maintenance remains a preparation workflow.
- Players and summons controlled by players do not receive this fallback; they
  need a maintained character or creature action profile.
- The ordinary explicit HP controls remain available when the DM chooses not to
  create a roll.

## Attacker and target selection

The workflow requires an unambiguous source and target.

- A controlled selected creature token is the attacker.
- If a player has no controlled creature selected, their locked campaign
  character is the default attacker.
- Selecting a controlled summon makes that summon the attacker.
- The DM selects the monster that is attacking before invoking an action on a
  player target.
- If the active initiative group contains multiple possible attackers and none
  is selected, the UI requires an attacker choice rather than guessing.
- Persistent spell entities cannot act as the attacker in the MVP.
- The target must be a creature token visible to the initiating viewer.
- The client offers only projected visible tokens as targets. The Worker verifies
  that the submitted target exists in the encounter but deliberately does not
  rebuild visibility or reject a previously known hidden-token ID; this trusted-
  group edge case is left to mandatory DM damage adjudication.
- Selection remains independent from movement authority. Strict movement does
  not alter attack selection or roll permissions.

The action surface must restate the relationship before rolling, for example:
`Dar'eleth attacks Orc Warrior`, followed by the available actions.

## Interaction requirements

### Desktop pointer flow

Right-clicking or otherwise invoking the context action on a visible target
opens a compact target-anchored attack chooser when a valid attacker is
available. The browser's native context menu should be suppressed only for
that handled map interaction.

Right-click is a shortcut, not a requirement for using the map. The existing
left-drag map navigation convention remains unchanged.

### Keyboard, touch, and fallback flow

- The selected or locked token card exposes an accessible Attack action that
  enters a target-selection flow or opens the same action chooser for an
  already selected target.
- Every context-menu operation is keyboard reachable with clear focus order,
  Escape behavior, and exact focus restoration.
- Coarse-pointer and phone layouts provide an explicit action rather than
  depending on right-click or a long press that conflicts with map navigation.
- Native context-menu suppression must not affect ordinary form fields or the
  rest of the application.

### Roll options and feedback

Before commitment, the chooser displays:

- attacker and target names;
- selected action and damage formula;
- normal, advantage, and disadvantage choice; and
- alternate damage choice when configured.

The chooser remains a compact decision strip over the map: one concise
attacker-to-target header, one action selector, visibly native radio selectors
for normal/advantage/disadvantage, compact automatic modifiers, and one submit
action. It must not resemble a full character-sheet form or style the three
mutually exclusive roll modes as competing command buttons.

When Bless is active on the attacker, the chooser also shows a non-editable
`Bless +1d4` contribution. The participant does not manually enable, disable,
or choose the value of that die in the roll surface.

After a successful submission, the compact attack chooser closes and the
initiating participant sees the individual dice, total, hit/miss/critical
outcome, and pending adjudication state in a compact non-modal combat card at
the edge of the viewport. The map remains visible and interactive around it.
The card has enough room for later dice animation and reads chronologically
from top to bottom: a narrative header naming who is attacking whom with which
action, the attack roll and total, the Hit/Miss/Critical verdict, and only then
the damage roll when the attack landed.
Within that sequence, authoritative die values reveal from left to right with
a short landing beat. Advantage and disadvantage d20s land neutrally; only
after both are visible does a short beat identify the kept die. The verdict
appears one second after the attack total;
on a hit, damage dice then reveal left to right before the damage total. This
is presentation only—the client never generates or changes a server result—and
reduced-motion preference reveals the completed result immediately.
Closing the card removes only that result; another attack requires a fresh
target interaction rather than reusing the prior chooser. Dice animation is
local presentation that lands on the server-provided results; animation frames
never cross the network and animation cannot generate or change the result.

For a DM-originated damaging hit, the roll-result card and already-pending
damage-approval card may appear together in the combat activity tray. They are
independent non-modal cards and never obscure the entire battlefield.

An initiating participant's roll-result card follows its linked damage proposal
through resolution. Pending text changes in place to `Damage applied.` for an
accepted resolution or `No damage was applied.` for rejection or cancellation,
without revealing resistance, vulnerability, immunity, or a custom DM
adjustment. A resolved card remains visible for approximately three seconds and
then dismisses automatically. Hover or keyboard focus pauses that countdown;
reduced-motion preference removes visual transitions but preserves the same
reading time.

The initiating surface must not globally block token movement or unrelated map
interactions while the roll or adjudication is pending.

## Turn and permission policy

- A player may initiate an attack only from a creature token they control.
- The DM may initiate an attack from any visible creature token.
- A player may target any creature token visible in their server projection.
- A roll is not hard-blocked merely because its attacker is outside the active
  initiative slot. Reactions, opportunity attacks, held actions, DM corrections,
  and setup testing make strict turn enforcement incorrect.
- The roll record captures whether the attacker belonged to the active turn
  window when the roll was created. The UI may mark an out-of-turn roll without
  preventing it.
- Group initiative does not choose a specific acting member. The actual token
  selected by the participant remains the attacker.
- Only the DM may adjudicate and apply a player's damage proposal.
- Players cannot alter server-generated dice, the snapshotted action formula,
  target identity, or adjudication result after submission.

## Authoritative roll resolution

### Randomness and retry behavior

- Dice are generated by the Worker using an appropriate server-side random
  source supplied to the framework-free domain as data.
- Domain functions accept explicit die results and return deterministic attack,
  critical, and damage decisions.
- Individual die faces are recorded, not only totals.
- The operation ID/idempotency boundary ensures that retries, timeouts, double
  clicks, and restored sessions cannot create a second roll for the same
  logical submission.
- A client never silently rerolls after a failed response. It either recovers
  the original authoritative result or reports that the operation could not be
  confirmed.

### Bless attack modifier

Bless is the MVP's one automatic effect-to-roll rule.

- The Worker determines Bless from the attacker's authoritative durable effects
  when it creates the roll. Client-supplied effect state is never trusted.
- An effect whose trimmed, case-insensitive canonical name is exactly `Bless`
  counts as Bless, matching the existing token VFX behavior. The implementation
  should centralize this canonical effect check rather than leave separate
  renderer and combat interpretations.
- The presence of one or more Bless records adds exactly one server-generated
  d4 to the attack total. Duplicate effects never stack additional d4s.
- The calculation is `kept d20 + final attack bonus + Bless d4`.
- Advantage or disadvantage changes only which d20 is kept; Bless rolls once.
- A natural 1 remains an automatic miss regardless of the Bless die. A natural
  20 remains an automatic hit and critical hit regardless of the Bless die.
- The Bless die never contributes to damage and is never doubled on a critical
  hit.
- Presence of the durable effect is authoritative until that effect is removed.
  A due reminder does not silently remove or disable it.
- The immutable roll snapshot records that Bless applied and records its
  individual d4 result. Removing Bless after roll creation does not rewrite the
  roll or its damage proposal.
- The MVP applies Bless only to supported attack rolls. Its saving-throw benefit
  belongs to the later saving-throw expansion.

### Armor class privacy

The Worker resolves the attack against the target's authoritative armor class.
A player response may contain `hit`, `miss`, or `critical`, but must not reveal
the target's exact AC, exact HP, or any hidden defensive record. A missing AC is
an explicit DM-review/configuration outcome rather than an assumed value.

### Damage timing

For speed, an attack submission may roll attack and damage together in one
authoritative operation. Damage dice are retained in the immutable roll record
even if the attack misses, but a miss does not create an applicable damage
proposal. Presentation need not emphasize unused damage.

On a natural 20, the MVP doubles each configured damage die count and applies
the flat modifier once. A static-damage action with no dice does not gain extra
damage from the generic critical rule.

## Damage proposal and DM adjudication

A successful damaging player roll creates a durable encounter-scoped proposal.
It is not a transient toast. A new proposal automatically adds an adjudication
card to the DM's edge-aligned combat activity tray; review controls must not be
buried in the initiative sidebar. Pending cards are ordered oldest first, with
up to three visible at once and a queued-count summary for overflow, such as:

`Dar'eleth hit Orc Warrior with Longsword +1 — 11 slashing damage.`

The DM can choose:

- **Apply:** Apply the rolled amount.
- **Resistant:** Apply half the rolled amount, rounded down.
- **Vulnerable:** Apply twice the rolled amount.
- **Immune:** Apply zero damage while recording the adjudication.
- **Adjust:** Enter an explicit non-negative final damage amount and optionally
  retain a short bounded reason/category.
- **Reject:** Apply no damage and mark the proposal rejected.

The DM may choose **Decide later** or dismiss an individual card without
changing the proposal. Deferred proposals remain pending and a prominent
map-level launcher shows the pending count and restores the ordered card queue.
Resolving one proposal removes only that card and reveals the next queued item,
so simultaneous attacks remain independently actionable.

Resistance, vulnerability, and immunity are DM decisions in the MVP; the
system does not infer them from a stat block or effect.

The DM uses the same review surface for a monster attacking a character. The
DM-originated path should be streamlined, but the MVP still requires explicit
application rather than immediately changing HP. This preserves the opportunity
to handle Shield, resistance, temporary HP, a mistaken target, or another
table ruling.

### Proposal lifecycle

The durable lifecycle is:

`pending -> applied | adjusted | immune | rejected | cancelled`

`resistant` and `vulnerable` are recorded adjudication methods on an applied
proposal. Terminal proposals are immutable. Only one terminal transition can
win.

- Pending proposals survive polling, refresh, and brief disconnects.
- Duplicate adjudication requests are idempotent.
- Pause preserves pending proposals.
- Restarting or resetting combat closes unresolved proposals as cancelled while
  retaining their roll records for audit.
- An explicit DM dismissal closes a stale proposal without mutating HP.
- A bounded retention policy may compact old resolved proposal projections,
  but the active encounter must retain enough readable roll history for the
  agreed combat-history window.

### Atomic application

Adjudication that changes HP must commit the following in one request-scoped D1
unit of work:

- optimistic encounter-version assertion;
- proposal terminal state and final damage amount;
- target HP and temporary HP transition;
- encounter version increment; and
- the HP history row used by Undo/Redo.

The roll/proposal record itself is outside participant Undo/Redo. The accepted
HP mutation is undoable and redoable through the existing feature-owned HP
history path. Undoing HP does not erase or rewrite the historical roll or DM
decision.

## Temporary HP prerequisite

Reliable automatic damage to player characters requires encounter-scoped
temporary HP. The MVP should add it rather than silently subtracting damage
from current HP when temporary HP is present on the authoritative character
sheet.

Temporary HP is explicitly outside the combat-rolling feature gate. Once
introduced, it is ordinary core encounter and HP state in `off`, `qa`, and
`all` modes.

- Temporary HP is a non-negative whole number distinct from current and
  maximum HP.
- Applied damage consumes temporary HP before current HP.
- Healing does not restore temporary HP.
- The existing explicit HP controls gain an equally explicit way for a
  controller or DM to set/replace temporary HP.
- Direct manual damage consumes temporary HP correctly even when combat rolling
  is disabled for that campaign.
- Exact temporary HP follows the same projection privacy as exact HP.
- A combined temporary-HP/current-HP damage transition is one undoable action.
- A positive final adjudicated damage amount counts as taking damage for
  concentration even when temporary HP absorbs all of it; the existing required
  concentration acknowledgement remains authoritative.
- Adjudicated combat damage routes the required concentration acknowledgement
  to the controller of the damaged token, not to the DM who approved the damage.
- The controller sees the dismissible damage-summary card first. Dismissing it
  opens the blocking concentration acknowledgement before the next queued
  combat update, so the card and modal never compete for focus.
- Manual damage remains independent of the combat-rolling feature gate. When a
  player applies damage manually to their concentrating character, the existing
  immediate blocking concentration acknowledgement still appears even in
  `off` mode.

## Live synchronization and presentation

- Creating a roll, creating or closing a proposal, and applying HP all advance
  encounter state through bounded operation IDs and server request IDs.
- Pending roll/proposal reducers must survive ordinary live refreshes and roll
  back only the rejected operation.
- A target token and the rest of the map never become globally disabled while
  awaiting a roll or adjudication.
- The DM sees a pending count without a blocking modal. Review can use a compact
  panel or popover that does not displace the visually dominant map.
- The actor receives a clear acknowledgement when the DM applies, modifies,
  nullifies, or rejects the proposal.
- A player-facing damage notification states only the final damage applied. It
  does not disclose whether the DM applied resistance, vulnerability, immunity,
  or a manual adjustment. Adjudication method and notes remain DM-private in
  live projections and history.
- Participants who cannot see a target must not learn that target's identity,
  action, HP, AC, or result through roll projection or notifications.
- Exact post-damage monster HP remains private; players receive only their
  existing permitted health representation.

The initial projection should guarantee full roll and proposal visibility to
the initiating participant, the DM, and the target's controller. Whether
non-involved players also see public dice animations is an open presentation
choice listed below; it must not delay the core actor-to-DM workflow.

## Roll and adjudication history

The feature needs a readable, encounter-scoped combat record separate from
Undo/Redo stack semantics. Each record should preserve:

- timestamp and stable roll ID;
- real participant/session actor;
- attacker and target token IDs plus snapshotted display names;
- action snapshot;
- roll mode;
- applied roll modifiers, including the snapshotted Bless effect and d4;
- individual attack and damage die results;
- every damage die as its own labeled visual result rather than a combined
  subtotal, including all four d6 results for the QA character's Guiding Bolt;
- the snapshotted attack bonus and chosen damage modifier as explicit visible
  terms, so each displayed total can be reconciled without consulting the
  character sheet;
- totals and hit/miss/critical result;
- whether the roll was in the active turn window;
- proposal status;
- adjudicating DM;
- adjudication method and final applied amount; and
- linkage to the HP history action when one exists.

History shown to a participant must be server-filtered using the same encounter
visibility and private-stat rules as live state. Diagnostic logs remain
privacy-safe and must not emit complete private combat records.

## Character-sheet authority and maintenance

D&D Beyond remains the source the group consults for complete character data,
features, spells, equipment, and rule explanations. The battle map's action
profile is a small manually maintained tactical mirror.

The UI should make this boundary explicit with language such as “Final values
from your character sheet.” It should not imply that the battle map will notice
a level-up or equipment change automatically.

The initial feature should favor quick manual entry of the small action set the
character commonly uses. An official supported import path can be evaluated in
the future, but no unofficial D&D Beyond integration is a prerequisite or
approved implementation technique.

## Saving-throw expansion boundary

Supporting saving-throw actions later requires additional final values rather
than a full character sheet:

- caster save DC;
- target's final modifier for each supported saving-throw ability;
- damage formula and type;
- success outcome such as half or no damage; and
- target selection, including bounded multi-target behavior.

The MVP schema should not force saving throws into an attack-bonus field. A
future resolution-mode discriminator should allow a dedicated save model.

## Production QA sessions

### Decision

Do not introduce a broad `admin` role or arbitrary identity impersonation.
Campaign role remains campaign-scoped, and the authenticated Google identity
continues to identify the real human.

Add a narrow durable identity capability such as `can_use_qa_sessions` to Dan's
human identity for live production verification. This is a testing capability,
not a campaign role and not permission to become another trusted human.

### QA session requirements

- QA sessions operate only in an explicitly designated disposable test
  campaign and its encounters.
- The production endpoint offers a small fixed set of server-owned personas,
  initially `QA DM` and `QA Player`. It never accepts an arbitrary identity ID,
  participant ID, campaign ID, or role supplied as authority by the browser.
- QA personas are synthetic and cannot sign in with Google, appear in the
  ordinary invited-human chooser, or be added to real campaigns.
- The session records both the authenticated actor (`Dan`) and effective QA
  persona on joins, rolls, adjudications, mutations, and audit records.
- Creating a QA session never changes or rebinds Dan's Google account link,
  durable identity, normal memberships, or ordinary auth session.
- QA sessions are short-lived, independently revocable, and subject to strict
  active-session limits.
- Every QA page shows an unmistakable persistent banner naming the effective
  persona and test campaign.
- QA sessions cannot access Force of Nature or any non-QA campaign even if a
  request is manually altered.
- QA session creation is rate-limited, auditable, protected by the normal
  Google-authenticated account, and disabled for identities without the
  capability.
- Two simultaneous views use isolated cookie jars, such as separate browser
  profiles, a private window, or separate automated browser contexts.
- A fixture/reset workflow can recreate a known QA encounter without mutating
  real campaign data.

### Attack-ready QA encounter

The disposable QA campaign includes one deterministic encounter specifically
prepared for the complete rolling and adjudication story. Resetting the fixture
must recreate, at minimum:

- a QA Player character with known AC, HP, temporary HP, and at least one
  configured attack action;
- Bless on the QA Player at the fixture's known starting state, with ordinary
  removal available so consecutive Blessed and unblessed rolls can be tested;
- at least two catalog-backed monster tokens from the initial enriched subset,
  each with authoritative AC and HP;
- an attack-ready monster with a simple melee attack;
- an attack-ready monster with a simple ranged attack, which may be the same
  catalog creature only if it genuinely has both profiles;
- at least one creature token with no configured action data so the DM-only
  generic Attack form is exercised; and
- known initiative values and active-turn state for both in-turn and
  out-of-turn roll checks.

The fixture must obtain configured monster actions through the real catalog and
token action path rather than bypassing it with test-only roll values. Fixture
creation and reset are idempotent, bounded, and isolated from every real
campaign.

Production QA support is for a final deployed-environment smoke test. It is not
the primary development test harness and must not be required to run ordinary
unit, component, or live integration tests.

The production smoke test runs first with combat rolling in `qa` mode. QA
session capability alone does not bypass `off`, and `qa` mode never enables
rolling in Force of Nature or another ordinary campaign.

## Development and verification strategy

### Local dual-client testing

The existing localhost-only identity switcher remains the development login
mechanism. Manual testing uses two isolated browser contexts:

- Kevin/DM in one context; and
- Dan/player in another.

Automated live tests should establish two independently authenticated clients
against one disposable encounter. They must use disposable participant tokens
and guaranteed cleanup consistent with the existing live-suite policy.

### Required domain tests

- Normal, advantage, and disadvantage die selection
- Natural 1 miss and natural 20 critical hit
- Ordinary attack total versus AC
- Blessed normal, advantage, and disadvantage totals use exactly one d4
- Duplicate Bless records still produce one d4
- Bless cannot overcome a natural 1 or change natural-20 critical behavior
- Bless never changes or doubles damage
- Critical damage dice and flat-modifier behavior
- Static-damage critical behavior
- Resistance rounding down, vulnerability doubling, immunity, adjustment, and
  rejection
- Temporary HP consumed before current HP
- Bounded action validation and formatted formula output
- Proposal lifecycle and terminal-state idempotency
- Turn-window metadata without hard turn rejection
- Structured generic Attack validation and formatted snapshot output
- Manual-rider metadata survives validation without being treated as automated
- `off`, `qa`, and `all` mode policy resolves from server-owned campaign context

### Required React/component tests

- Controlled attacker and visible target resolution
- Locked-character fallback and ambiguous group-attacker choice
- Context action plus keyboard/touch-accessible fallback
- Focus management and Escape behavior
- Roll-mode and alternate-damage selection
- Successful rolls close the chooser and add the authoritative result card
- Another attack requires a fresh target interaction after result dismissal
- DM roll results and multiple damage-adjudication cards coexist in the bounded
  combat activity tray without blocking the map
- Non-editable Blessed indicator and authoritative Bless d4 presentation
- DM-only generic Attack form for a creature with no configured profiles
- No generic Attack fallback for a player-controlled attacker
- Visible manual-rider warning on a partially supported creature action
- Rolling controls are absent in `off` and in ordinary campaigns under `qa`
- Pending-proposal drain controls remain available after rolling is disabled
- Temporary HP controls and readouts remain available in every rolling mode
- Pending proposal count, bounded card queue, and DM adjudication controls
- Actor feedback for each terminal DM decision
- No global interaction blocking while operations are pending
- Private values absent from unauthorized rendering
- Dice animation consumes an authoritative result rather than generating one

### Required Worker/repository tests

- Player can roll only from a controlled attacker
- DM can roll from any authorized encounter creature
- Submitted targets must exist in the encounter; target visibility is not
  re-authorized by the roll command
- Exact target AC and HP do not leak in player responses
- Missing AC produces an explicit non-applicable outcome
- Authoritative Bless state adds one server-generated d4 while forged client
  effect state cannot add or suppress it
- Removing Bless after roll creation does not alter the immutable result
- Catalog-backed monster rolls use the authoritative configured action rather
  than client-supplied replacements
- A bounded generic Attack is accepted from the DM for an unconfigured creature
  and rejected from a player
- Creature-action import preserves source/version provenance and rejects an
  incomplete unflagged rider
- The Worker rejects new configured and ad hoc rolls in `off`
- The Worker permits rolls only for the designated QA campaign in `qa` and for
  eligible QA and ordinary campaigns in `all`
- A forged client feature capability cannot bypass the authoritative mode
- Disabled polling skips roll/action collection work after pending proposals
  have drained
- Mode transitions preserve action, roll, proposal, HP, and history records
- Direct HP changes continue consuming temporary HP in every mode
- Roll retries recover one immutable result
- Player cannot forge dice, formulas, target changes, or adjudication
- Only the campaign DM can close a player proposal
- Concurrent or repeated adjudication applies HP at most once
- Proposal state, HP, encounter version, and history commit atomically
- Restart/reset cancellation and pause preservation
- Collection quotas, request bounds, and projection limits
- Roll history projection obeys token visibility and private-stat policy
- QA session capability, campaign isolation, expiry, revocation, and actor/persona
  audit fields

### Required live multi-client stories

1. Player rolls a hit; DM sees one pending proposal; DM applies it; both clients
   converge on the authorized target health representation.
2. Player rolls a hit; DM selects Resistant; odd damage rounds down once; both
   clients see the resolved status.
3. DM rolls a monster attack against a player; the player sees the permitted
   roll/result; no HP changes until the DM applies it.
4. Two rapid player submissions remain distinct and ordered; retrying either
   operation does not create another roll.
5. Two DM Apply attempts race; exactly one HP mutation wins.
6. A refresh while a proposal is pending preserves the request and permits the
   DM to adjudicate it.
7. A target with temporary HP loses temporary HP first and triggers the correct
   existing follow-on behavior.
8. An unauthorized or stale client cannot roll, adjudicate, or learn private
   target data.
9. A Blessed attacker rolls one visible d4, both clients agree on the total,
   and removing Bless affects the next roll without rewriting the first.
10. The QA DM uses configured melee and ranged actions from the attack-ready QA
    monsters, then uses the structured generic Attack on the unconfigured
    creature; each result follows the same adjudication and HP path.
11. With mode `off`, both clients retain movement, effects, initiative, direct
    HP, temporary HP, chat, and Undo/Redo while every new roll path is rejected.
12. With mode `qa`, the same QA clients can complete the rolling story while an
    ordinary campaign cannot; changing to `all` enables the ordinary campaign
    without recreating profiles or repairing data.

Before publication, run the repository's full `npm run verify`, including both
coverage suites and the dependency audit, followed by the isolated live suite
and a manual two-window browser check. Publishing remains explicitly
user-authorized.

## Architectural boundaries

- Attack resolution, canonical Bless detection, effect-derived roll modifiers,
  critical rules, damage adjustment, temporary-HP transitions, proposal
  lifecycle, and projection-safe result shaping belong in framework-free
  `shared/` modules with direct tests.
- Random die faces, current time, identity, and persistence are injected into
  the domain as data.
- React owns context menus, accessible fallback controls, animation, focus,
  panels, and optimistic presentation.
- The Worker owns authenticated membership lookup, authorization, random value
  generation, input bounds, private AC resolution, D1 units of work, and
  server-filtered projections.
- Persistence lives behind a combat-roll feature repository and its D1 adapter.
  Do not add roll-specific SQL or synchronization internals to the root React
  component.
- Roll/proposal commands use the shared typed command registry and the existing
  operation-oriented synchronization boundary.
- The server-owned `off | qa | all` mode gates only rolling commands,
  projections, and UI. Temporary HP and the core HP transition never depend on
  that mode.
- Roll animation state is browser-local. Roll and proposal outcomes are durable
  shared state. HP remains server-authoritative.

## Rollout sequence

1. Define and test the structured combat-action, roll-resolution, damage,
   proposal, and temporary-HP domain contracts.
2. Add bounded additive persistence and repository adapters for action profiles,
   roll records, proposals, temporary HP, and any required catalog relationship.
3. Add character and creature action maintenance surfaces, enrich the bounded
   initial creature subset, and add the DM-only generic Attack fallback.
4. Add authoritative roll and adjudication commands with private projections.
5. Add the desktop context interaction and accessible card-based fallback.
6. Add the DM pending-proposal surface, actor feedback, and local dice
   presentation.
7. Add dual-client live coverage and complete manual local verification.
8. Add the isolated production QA-session capability and its deterministic
   attack-ready encounter fixture.
9. Run full verification and request explicit publication approval.
10. Publish with combat rolling set to `off`, then use `qa` for the isolated
    production smoke test.
11. Change the mode to `all` only after the QA story passes and the user
    explicitly approves enabling it for ordinary campaigns.

All schema changes described here are additive. A production backup is not
required solely for those additive migrations. Any later non-additive migration,
bulk mutation, or persistence refactor with credible data-loss risk follows the
production backup policy before work proceeds.

## Open decisions before implementation

These choices do not change the approved feature boundary but should be settled
before their affected UI or schema is built:

1. **Placed creature action policy:** reference the live catalog profile or copy
   a placement-time action snapshot. Historical roll snapshots are required in
   either case.
2. **General table visibility:** show pending and resolved rolls only to the
   actor, target controller, and DM, or also show public dice animation to every
   participant who can see both tokens. Private AC and HP may never be exposed.
3. **Resolved-history window:** determine the bounded number or age of roll
   records projected to clients before older records move to an on-demand view.
4. **Adjusted-damage note:** decide whether Adjust stores only a structured
   category or also permits a short free-form DM note.

Saving throws, multiple damage components, automatic effects other than Bless,
and unofficial D&D Beyond synchronization are deferred scope, not unresolved
MVP decisions.
