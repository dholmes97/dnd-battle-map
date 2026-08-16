# Active Feature Backlog

This file contains unshipped product ideas only. It is not committed scope and
does not duplicate completed work, implementation history, or architectural
rules. Remove an item when it ships; Git history is the archive.

## Recommended sequence

1. **Placed-token stat blocks**
   - Copy placement-ready catalog metadata onto tokens: armour class, challenge
     rating, creature type, hit dice, and separate movement speeds.
   - Show the essential values in token details so the DM can answer routine
     combat questions without leaving the map.

2. **Readable combat history**
   - Present the append-only action history as a scenario timeline for movement,
     HP, effects, initiative, placements, and undo/redo.
   - Make it useful for participants returning after looking away or reconnecting.

3. **Richer condition and effect rules**
   - Build on the existing durable effects, reminders, concentration modal, and
     token VFX with a standard condition vocabulary and distinct readable marks.
   - Improve duration and expiry handling without turning the app into a full
     character-sheet or rules engine.

4. **Death-save and unconscious tracking**
   - Offer an optional compact state for zero HP, stabilization, death-save
     successes, and failures.
   - Keep D&D Beyond as the character-sheet authority; this would be a tactical
     mirror for groups that want it.

5. **DM staging and encounter waves**
   - Let the DM privately pre-place groups of monsters and effects, then reveal a
     wave together.
   - Reuse existing token visibility and scenario persistence rather than adding
     a second encounter model.

6. **Measured templates and group outcomes**
   - Add cones, lines, cubes, walls, and coverage highlighting alongside the
     existing persistent spell areas.
   - Apply damage or healing to covered tokens in one action, with per-token and
     half-on-save adjustments.

7. **Finished-map import and grid calibration**
   - Let the DM upload a bounded full-scene image and calibrate dimensions, grid
     scale, and offset.
   - Preserve the cohesive full-scene workflow; do not restore tiles, fragments,
     generic terrain, or scene stickers.

8. **Windowed desktop and touch polish**
   - Treat a half-screen laptop window as a first-class player layout.
   - Improve two-finger navigation, long-press selection, touch targets, and
     Safari memory diagnostics for constrained devices.

9. **Expanded visual-effects palette**
   - Add polished local-rendered treatments for more common spells and
     conditions while keeping durable state small and deterministic.

10. **Creature quick-reference cards**
    - Extend catalog search beyond name/family and show essential actions and
      movement details without attempting a comprehensive rules database.

11. **Encounter preparation snapshots**
    - Save and restore a clean pre-session scenario state after testing.
    - Consider a bounded scenario export for portability and disaster recovery,
      separate from production D1/R2 backups.

## Product boundaries

- D&D Beyond remains the home for complete character sheets, player dice,
  classes, spell slots, and modifiers.
- Do not build against unofficial D&D Beyond browser integrations unless an
  official supported API becomes available.
- Small DM conveniences for monsters remain in scope when they reduce table
  friction without creating a general automated rules engine.
- Hosted runtime AI is not required for play. Pre-session Codex/ImageGen
  preparation may continue through the bounded scenario-provisioning workflow.
