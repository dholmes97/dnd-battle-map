# Possible Future Features

This is a product-idea backlog, not committed implementation scope. The order
reflects the current recommended sequence based on usefulness during actual
play, implementation risk, and fit with the existing battle-map experience.

Where an item is cheap because the data or plumbing already exists, that is
recorded with it. Prefer those first: they cost little and several of them
unblock the larger items below.

## Recommended next ten

1. **Token stat blocks on placement**
   - Persist armour class, challenge rating, creature type, hit dice, and the
     separate walk/fly/swim/climb/burrow speeds onto the placed token.
   - Show armour class beside hit points in the roster row and detail panel.
   - The creature catalog already stores every one of these fields; placement
     currently discards them and keeps a single speed integer, so the DM cannot
     answer "does an 18 hit?" without leaving the app. Smallest change on this
     list for the value returned, and it is a prerequisite for item 12.

2. **Combat history panel**
   - Present the durable action history as a readable timeline of movement,
     damage, healing, effects, summons, initiative changes, and undo/redo points.
   - Let a participant scroll back to catch up after looking away.
   - The `actions` table is already append-only and durable, carrying
     participant, action type, payload, and timestamp; today it is read only to
     power undo and redo. This is mostly presentation over existing data, and it
     becomes the natural destination for items 3, 4, and 8.

3. **Conditions and concentration**
   - Replace the free-text effect presets with the standard condition set and
     give each one a distinct marker on the token, rather than the single
     undifferentiated dot that means "has effects".
   - Track round duration and fire reminders at the right point in the turn.
   - Give each token one concentration slot: prompt the saving throw on damage,
     drop the linked effect when concentration breaks, and refuse a second
     concentration spell while one is held.
   - Effects already carry type, duration, expiry round, and reminder timing,
     and the hit-point path already returns a concentration-check flag. This is
     largely a vocabulary, a rendering pass, and one new column.

4. **Death saves and unconscious state**
   - Mark a token unconscious automatically at zero hit points.
   - Track successes and failures, stabilisation, and death.
   - The down health band already renders with a slash and dimming, so the
     visual half exists and only the mechanics are missing. Small, and it comes
     up most sessions.

5. **DM staging layer**
   - Let the DM privately pre-place monsters, spell effects, and encounter waves.
   - Reveal staged entities individually or as a group when players should see them.
   - Per-token hide and reveal already exist; the gap is preparing a wave as a
     unit and revealing it in one action.

6. **Spell-template tools**
   - Support measured circles, cones, lines, cubes, and walls.
   - Highlight which tokens a template currently covers.
   - Allow a completed template to become a persistent, movable effect when appropriate.
   - The only measuring tool today is the straight ruler line, so area placement
     is the most frequent unresolved question at the table. Both the annotation
     system and the persistent spell-effect entity model are available to build on.

7. **Simple fog of war**
   - Add a DM-controlled hide/reveal brush.
   - Keep the first version manual; defer automatic vision and line-of-sight.
   - Token hiding is per-token only, so there is no way to mask unexplored map.
     Pairs naturally with item 5, and it is what makes presentation mode usable
     for exploration rather than only for set-piece combat.

8. **Fast outcome entry and area damage**
   - Apply damage or healing to every token under a spell template in one action,
     with a half-on-save option and a per-token override for anyone who saved.
   - Let the DM click a token on the map and type a number to damage it, without
     first selecting it in the sidebar.
   - Roll initiative for a monster group in one action. This is a DM-side
     convenience for creatures nobody has a character sheet for, not a dice system.
   - The group rolls in D&D Beyond, so the app does not need dice; it needs the
     results to land on the map quickly. `apply-hp` is single-token today, so a
     fireball on five goblins costs five separate select-type-click cycles.
   - Pairs directly with item 6: the template already knows who it covers.

9. **Full-map import and grid calibration**
   - Let the DM upload a finished battle-map image.
   - Provide visual controls for map dimensions, grid scale, and grid offset.
   - Maps are currently limited to the set compiled into the scene library, which
     is the hardest ceiling in the product for a DM bringing prepared material.

10. **Half-screen and touch layouts**
    - Treat a windowed desktop browser as a first-class size. The group plays
      remotely with D&D Beyond open beside the map, so the common player viewport
      is roughly half a laptop screen, not a maximised window. The command bar,
      roster, and detail panel should stay usable at that width without the map
      shrinking to a stamp.
    - Improve two-finger pan and zoom, long-press selection, and touch target
      sizes for players who join from a tablet.
    - At 375px wide the map collapses to roughly a quarter of the screen and the
      page scrolls; that is a layout problem, not a media-query problem, and it
      ranks below the windowed-desktop case for a remote group.
    - Add lightweight-effects controls and Safari-focused memory diagnostics for
      constrained devices.

## After the first ten

11. **Expanded visual-effects palette**
    - Add polished battlefield treatments for spells such as Spirit Guardians,
      Faerie Fire, Spike Growth, Darkness, Web, and Wall of Fire.
    - Preserve the existing rule that animation is rendered locally from shared,
      durable state rather than transmitted frame by frame.
    - Additive polish on a system that already works, which is why it sits below
      the missing mechanics above rather than among them.

12. **Creature quick-reference cards**
    - Search and filter the creature catalog by family, challenge rating,
      environment, size, and movement type.
    - Show essential combat information and actions without attempting to build
      a complete automated D&D rules engine.
    - Reads much better once item 1 has put the same fields on placed tokens.

13. **Encounter preparation hygiene**
    - Organise prepared encounters, save a clean starting state, and restore that
      state after testing.
    - Export a scenario so prepared content survives a bad reset or a lost
      database, and can move between the local and deployed databases.

## Suggested milestones

Start with items 1 and 2. Both are small, both are mostly surfacing data the
schema already holds, and item 2 gives items 3, 4, and 8 somewhere to report.

Follow with items 3 and 4 to close the mechanical gaps that come up every
session, then take items 5, 6, 7, and 8 together as the preparation and tactical
milestone. Templates and area damage in particular should ship as one piece of
work: a template that knows who it covers is most of what area damage needs.
None of this requires a character-sheet system or an automated rules engine.

## Working alongside D&D Beyond

The group plays remotely and uses D&D Beyond for character sheets and dice.
That tool is strong at both, so this app should not try to replace either.
Recorded here so it does not get re-proposed:

- Do not build a player-facing dice roller, and do not model character sheets,
  class features, spell slots, or modifiers.
- The gap worth closing is not rolling; it is the cost of moving an outcome onto
  the map after the roll happens elsewhere. That is item 8, and it is a
  data-entry speed problem rather than a dice problem.
- Small DM-side conveniences for creatures that have no character sheet, such as
  rolling initiative for a monster pack, stay in scope. They do not overlap with
  what D&D Beyond does for the players.
- An automated bridge from D&D Beyond was considered and rejected for now: there
  is no supported public API, and the browser-extension approaches used by other
  tools are unofficial and break often. Revisit only if an official one appears.
- Remote play raises the value of items 2, 5, and 7. With no shared table, the
  map is the only common reality, players cannot glance at the DM's screen, and
  anyone who drops or looks away has no table chatter to catch up from.

## Already shipped

- Scenario duplication, which copies the current map and tokens into a fresh
  scenario with combat, initiative, effects, and history cleared.

## Deliberately deferred

- Full character sheets
- A player-facing dice roller
- An unofficial D&D Beyond integration
- Automatic vision and line-of-sight calculations
- A comprehensive automated D&D rules engine
- In-app AI map generation that requires a hosted LLM

## Merge notes

This list merges an independent review with the original backlog. Recorded so
the reasoning is not lost:

- Conditions and concentration were proposed separately in the review and are
  kept combined here, as the original had them, because they share the effect
  plumbing.
- The combat history panel and a proposed activity log are the same item.
- Spell templates, fog of war, and the touch work each appeared on both lists;
  the entries above take the broader scope of the two.
- Token stat blocks and death saves are new to this backlog.
- Shared dice rolling was proposed and then dropped once it was clear the group
  rolls in D&D Beyond. What survives of it is item 8, which moves outcomes onto
  the map faster instead of producing them.
- The staging layer, expanded effects palette, map import, and quick-reference
  cards came from the original backlog and were absent from the review.
- Scenario duplication was listed under encounter preparation and has since
  shipped; the remaining preparation work is now item 13.
