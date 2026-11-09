-- Force of Nature's level-14 D&D Beyond sheets and Session 97 table rulings.
-- Update maintained presets only. Match prior provenance to preserve later manual edits.
WITH updates (id, character_id, previous_source, attack_bonus) AS (VALUES
  ('character-dareleth-javelin-of-lightning-v1', 'character-dareleth', 'dndbeyond-level-12-2026-09-07', 9),
  ('character-dareleth-javelin-thrown-v1', 'character-dareleth', 'dndbeyond-level-12-2026-09-07', 9),
  ('character-dareleth-unarmed-strike-v1', 'character-dareleth', 'dareleth-sheet-2026-08-30', 9),
  ('character-jelton-quarterstaff-v1', 'character-jelton', 'jelton-sheet-2026-08-30', 7),
  ('character-jelton-thorn-whip-v1', 'character-jelton', 'dndbeyond-level-12-2026-09-07', 13),
  ('character-jelton-produce-flame-v1', 'character-jelton', 'dndbeyond-level-12-2026-09-07', 10),
  ('character-jelton-ray-of-frost-v1', 'character-jelton', 'dndbeyond-level-12-2026-09-07', 8),
  ('character-jelton-witch-bolt-v1', 'character-jelton', 'jelton-sheet-2026-08-30', 8),
  ('character-jelton-guiding-bolt-1-v1', 'character-jelton', 'dndbeyond-level-12-2026-09-07', 13),
  ('character-jelton-guiding-bolt-2-v1', 'character-jelton', 'jelton-sheet-2026-08-30', 13),
  ('character-jelton-guiding-bolt-3-v1', 'character-jelton', 'jelton-sheet-2026-08-30', 13),
  ('character-jelton-guiding-bolt-4-v1', 'character-jelton', 'jelton-sheet-2026-08-30', 13),
  ('character-jelton-guiding-bolt-5-v1', 'character-jelton', 'jelton-sheet-2026-08-30', 13),
  ('character-jelton-guiding-bolt-6-v1', 'character-jelton', 'dndbeyond-level-12-2026-09-07', 13),
  ('character-jelton-unarmed-strike-v1', 'character-jelton', 'jelton-sheet-2026-08-30', 6),
  ('character-jelton-starry-archer-v1', 'character-jelton', 'dndbeyond-level-12-2026-09-07', 10),
  ('character-jelton-shillelagh-v1', 'character-jelton', 'dndbeyond-level-12-2026-09-07', 10),
  ('character-malichar-dagger-v1', 'character-malichar', 'dndbeyond-level-12-2026-09-07', 10),
  ('character-malichar-rapier-v1', 'character-malichar', 'dndbeyond-level-12-2026-09-07', 11),
  ('character-malichar-glimmering-moonbow-v1', 'character-malichar', 'dndbeyond-level-12-2026-09-07', 11),
  ('character-malichar-booming-dagger-v1', 'character-malichar', 'dndbeyond-level-12-2026-09-07', 10),
  ('character-malichar-booming-rapier-v1', 'character-malichar', 'dndbeyond-level-12-2026-09-07', 11),
  ('character-malichar-fire-bolt-v1', 'character-malichar', 'dndbeyond-level-12-2026-09-07', 7),
  ('character-malichar-unarmed-strike-v1', 'character-malichar', 'malichar-sheet-2026-08-30', 4)
)
UPDATE combat_action_profiles AS profile
SET attack_bonus = updates.attack_bonus,
    manual_rider_text = CASE profile.id
      WHEN 'character-dareleth-javelin-of-lightning-v1' THEN
        'Improved Divine Smite is included. Resolve any optional slot-based Divine Smite with the DM.'
      WHEN 'character-jelton-guiding-bolt-1-v1' THEN
        replace(profile.manual_rider_text, 'four Star Map uses', 'five Star Map uses')
      WHEN 'character-jelton-shillelagh-v1' THEN
        'Attack with an already enchanted club or quarterstaff. This is a weapon attack using Wisdom. For the +1 quarterstaff, use +11 to hit and 1d8+6 bludgeoning.'
      ELSE replace(profile.manual_rider_text, 'Sneak Attack adds 6d6 piercing', 'Sneak Attack adds 7d6 piercing')
    END,
    source_ref = 'dndbeyond-level-14-2026-11-09',
    updated_at = 1794265983000
FROM updates
JOIN campaign_characters AS character ON character.id = updates.character_id
WHERE profile.id = updates.id AND profile.campaign_character_id = character.id
  AND character.campaign_id = 'campaign-force-of-nature'
  AND (profile.source_ref = updates.previous_source
    OR (profile.id = 'character-dareleth-javelin-of-lightning-v1'
      AND profile.source_ref IS NULL AND profile.updated_at = 1794265840724));
--> statement-breakpoint
-- The live editor has already saved the Holy Avenger's base values in production.
-- Recognize that exact edit and update its rider, or upgrade the original seed on a fresh install.
UPDATE combat_action_profiles
SET name = 'Holy Avenger Longsword', attack_bonus = 12, damage_modifier = 7,
    alternate_damage_json = '{"label":"Two-handed","formula":{"count":1,"sides":10,"modifier":7}}',
    manual_rider = 1,
    manual_rider_text = 'Improved Divine Smite is included. Against a fiend or undead, resolve the sword''s extra 2d10 radiant with the DM. Resolve any optional slot-based Divine Smite separately.',
    source_ref = 'dndbeyond-level-14-2026-11-09',
    updated_at = 1794265983000
WHERE id = 'character-dareleth-longsword-v1'
  AND campaign_character_id = 'character-dareleth'
  AND campaign_character_id IN (SELECT id FROM campaign_characters WHERE campaign_id = 'campaign-force-of-nature')
  AND (
    source_ref = 'dndbeyond-level-12-2026-09-07'
    OR (source_ref IS NULL AND updated_at = 1794265829661 AND name = 'Holy Avenger Longsword')
  );
--> statement-breakpoint
WITH additions (id, character_id, name, bonus, kind, dice, die, modifier, type, reach, range, rider, alternate, extra, position) AS (VALUES
  ('character-dareleth-guiding-bolt-4-v1', 'character-dareleth', 'Guiding Bolt (4th level)',
   8, 'ranged', 7, 6, 0, 'radiant', NULL, 120,
   'Uses a fourth-level slot. The next attack against the target has advantage before the end of your next turn.',
   NULL, NULL, 55),
  ('character-jelton-guiding-bolt-7-v1', 'character-jelton', 'Guiding Bolt (7th level)',
   13, 'ranged', 10, 6, 0, 'radiant', NULL, 240,
   'Uses a seventh-level slot. The next attack against the target has advantage before the end of your next turn.',
   NULL, NULL, 106),
  ('character-jelton-moon-sickle-v1', 'character-jelton', 'Moon Sickle +3',
   9, 'melee', 1, 4, 4, 'slashing', 5, NULL, NULL, NULL, NULL, 15),
  ('character-malichar-staff-of-the-magi-v1', 'character-malichar', 'Staff of the Magi',
   6, 'melee', 1, 6, 1, 'bludgeoning', 5, NULL, NULL,
   '{"label":"Two-handed","formula":{"count":1,"sides":8,"modifier":1}}', NULL, 35),
  ('character-malichar-fire-bolt-staff-v1', 'character-malichar', 'Fire Bolt (Staff of the Magi held)',
   9, 'ranged', 3, 10, 0, 'fire', NULL, 120, 'Use while holding the Staff of the Magi.',
   NULL, NULL, 45),
  ('character-malichar-booming-staff-v1', 'character-malichar', 'Booming Blade (Staff of the Magi)',
   6, 'melee', 1, 6, 1, 'bludgeoning', 5, NULL,
   'On-hit thunder is included. If the target willingly moves at least 5 feet before your next turn, resolve 3d8 thunder separately.',
   '{"label":"Two-handed","formula":{"count":1,"sides":8,"modifier":1}}',
   '[{"label":"Booming Blade","formula":{"count":2,"sides":8,"modifier":0},"damageType":"thunder"}]', 75)
)
INSERT OR IGNORE INTO combat_action_profiles
  (id, campaign_character_id, name, resolution_mode, attack_bonus, attack_kind,
   damage_dice_count, damage_die_size, damage_modifier, damage_type, reach_feet, range_feet,
   manual_rider, manual_rider_text, alternate_damage_json, extra_damage_json,
   source_kind, source_ref, sort_order, is_enabled, created_at, updated_at)
SELECT additions.id, character.id, additions.name, 'attack-vs-ac', bonus, kind,
       dice, die, modifier, type, reach, range, rider IS NOT NULL, rider, alternate, extra,
       'manual-character', 'dndbeyond-level-14-2026-11-09', position, 1, 1794265983000, 1794265983000
FROM additions
JOIN campaign_characters AS character ON character.id = additions.character_id
WHERE character.campaign_id = 'campaign-force-of-nature'
  AND NOT EXISTS (
    SELECT 1 FROM combat_action_profiles AS existing
    WHERE existing.campaign_character_id = character.id
      AND lower(trim(existing.name)) = lower(trim(additions.name))
  );
--> statement-breakpoint
-- Fresh encounters copy these campaign defaults. Preserve any later edits.
WITH stats (id, prior_max_hp, prior_ac, max_hp, ac, speed) AS (VALUES
  ('character-dareleth', 104, 25, 144, 24, 40),
  ('character-jelton', 93, 10, 129, 22, 30),
  ('character-malichar', 93, 10, 129, 18, 40)
)
UPDATE campaign_characters AS character
SET max_hp = stats.max_hp, armor_class = stats.ac, speed = stats.speed,
    updated_at = max(character.updated_at, 1794265983000)
FROM stats
WHERE character.id = stats.id AND character.campaign_id = 'campaign-force-of-nature'
  AND character.speed = 30
  AND ((character.max_hp = stats.prior_max_hp AND character.armor_class = stats.prior_ac)
    OR (character.updated_at = 0 AND character.max_hp = 10 AND character.armor_class = 10));
--> statement-breakpoint
-- Align the three untouched starting tokens in the newest prepared encounter
-- with the sheets. Match the exact prior token versions and require setup.
WITH starting_stats (id, character_id, prior_updated_at, hp, max_hp, ac, speed) AS (VALUES
  ('7804a94d-3e49-47af-bd74-4f027bad37b5', 'character-dareleth', 1794250285179, 144, 144, 24, 40),
  ('ef214e48-398a-43eb-8fdd-74b9123a1c62', 'character-jelton', 1794250276780, 129, 129, 22, 30),
  ('43c24d31-1ba2-495f-962f-f70d4436e8a2', 'character-malichar', 1794250280412, 109, 129, 18, 40)
)
UPDATE tokens AS token
SET hp = starting_stats.hp, max_hp = starting_stats.max_hp,
    armor_class = starting_stats.ac, speed = starting_stats.speed, updated_at = 1794265983000
FROM starting_stats
JOIN encounters AS encounter ON encounter.id = 'f181b47c-fac0-4d56-ad5c-ab56c70cfa94'
WHERE token.id = starting_stats.id AND token.campaign_character_id = starting_stats.character_id
  AND token.encounter_id = encounter.id AND token.kind = 'character'
  AND encounter.campaign_id = 'campaign-force-of-nature' AND encounter.status = 'setup'
  AND token.updated_at = starting_stats.prior_updated_at;
--> statement-breakpoint
UPDATE encounters SET version = version + 1 WHERE campaign_id = 'campaign-force-of-nature';
