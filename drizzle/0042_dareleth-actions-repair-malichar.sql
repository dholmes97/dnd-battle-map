WITH `dareleth_actions` (
  `id`, `name`, `resolution_mode`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
  `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`,
  `manual_rider_text`, `alternate_damage_json`, `sort_order`
) AS (VALUES
  ('character-dareleth-javelin-of-lightning-v1', 'Javelin of Lightning', 'attack-vs-ac', 8, 'melee', 1, 6, 4,
   'piercing', 5, 30, 1,
   'When activated, also deals 4d6 lightning damage and expends 1 charge. The additional lightning dice are not yet included in the automatic damage roll.', NULL, 10),
  ('character-dareleth-longsword-v1', 'Longsword +1', 'attack-vs-ac', 9, 'melee', 1, 8, 5, 'slashing', 5, NULL, 0, NULL,
   '{"label":"Two-handed","formula":{"count":1,"sides":10,"modifier":5}}', 20),
  ('character-dareleth-guiding-bolt-1-v1', 'Guiding Bolt', 'attack-vs-ac', 8, 'ranged', 4, 6, 0, 'radiant', NULL, 120, 1,
   'The next attack roll against the target has advantage before the end of the caster''s next turn.', NULL, 30),
  ('character-dareleth-guiding-bolt-2-v1', 'Guiding Bolt (2nd level)', 'attack-vs-ac', 8, 'ranged', 5, 6, 0, 'radiant', NULL, 120, 1,
   'The next attack roll against the target has advantage before the end of the caster''s next turn.', NULL, 40),
  ('character-dareleth-guiding-bolt-3-v1', 'Guiding Bolt (3rd level)', 'attack-vs-ac', 8, 'ranged', 6, 6, 0, 'radiant', NULL, 120, 1,
   'The next attack roll against the target has advantage before the end of the caster''s next turn.', NULL, 50),
  ('character-dareleth-unarmed-strike-v1', 'Unarmed Strike', 'attack-vs-ac', 8, 'melee', 0, 6, 5, 'bludgeoning', 5, NULL, 0, NULL, NULL, 60),
  ('character-dareleth-magic-missile-1-v1', 'Magic Missile (1st level, 1 charge)', 'automatic-damage', 0, 'ranged', 3, 4, 3, 'force', NULL, 120, 1,
   'Hits automatically. Uses 1 wand charge. The full volley is rolled against the selected target; split darts among multiple targets through manual DM adjudication.', NULL, 70),
  ('character-dareleth-magic-missile-2-v1', 'Magic Missile (2nd level, 2 charges)', 'automatic-damage', 0, 'ranged', 4, 4, 4, 'force', NULL, 120, 1,
   'Hits automatically. Uses 2 wand charges. The full volley is rolled against the selected target; split darts among multiple targets through manual DM adjudication.', NULL, 80),
  ('character-dareleth-magic-missile-3-v1', 'Magic Missile (3rd level, 3 charges)', 'automatic-damage', 0, 'ranged', 5, 4, 5, 'force', NULL, 120, 1,
   'Hits automatically. Uses 3 wand charges. The full volley is rolled against the selected target; split darts among multiple targets through manual DM adjudication.', NULL, 90),
  ('character-dareleth-magic-missile-4-v1', 'Magic Missile (4th level, 4 charges)', 'automatic-damage', 0, 'ranged', 6, 4, 6, 'force', NULL, 120, 1,
   'Hits automatically. Uses 4 wand charges. The full volley is rolled against the selected target; split darts among multiple targets through manual DM adjudication.', NULL, 100),
  ('character-dareleth-magic-missile-5-v1', 'Magic Missile (5th level, 5 charges)', 'automatic-damage', 0, 'ranged', 7, 4, 7, 'force', NULL, 120, 1,
   'Hits automatically. Uses 5 wand charges. The full volley is rolled against the selected target; split darts among multiple targets through manual DM adjudication.', NULL, 110),
  ('character-dareleth-magic-missile-6-v1', 'Magic Missile (6th level, 6 charges)', 'automatic-damage', 0, 'ranged', 8, 4, 8, 'force', NULL, 120, 1,
   'Hits automatically. Uses 6 wand charges. The full volley is rolled against the selected target; split darts among multiple targets through manual DM adjudication.', NULL, 120),
  ('character-dareleth-magic-missile-7-v1', 'Magic Missile (7th level, 7 charges)', 'automatic-damage', 0, 'ranged', 9, 4, 9, 'force', NULL, 120, 1,
   'Hits automatically. Uses 7 wand charges. The full volley is rolled against the selected target; split darts among multiple targets through manual DM adjudication.', NULL, 130)
)
INSERT OR IGNORE INTO `combat_action_profiles`
(`id`, `campaign_character_id`, `name`, `resolution_mode`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
 `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`, `manual_rider_text`,
 `alternate_damage_json`, `source_kind`, `source_ref`, `sort_order`, `is_enabled`, `created_at`, `updated_at`)
SELECT `id`, 'character-dareleth', `name`, `resolution_mode`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
       `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`, `manual_rider_text`,
       `alternate_damage_json`, 'manual-character', 'dareleth-sheet-2026-08-30', `sort_order`, 1,
       1788119919737, 1788119919737
FROM `dareleth_actions` AS `candidate`
WHERE EXISTS (SELECT 1 FROM `campaign_characters` WHERE `id` = 'character-dareleth')
  AND NOT EXISTS (
    SELECT 1 FROM `combat_action_profiles` AS `existing`
    WHERE `existing`.`campaign_character_id` = 'character-dareleth'
      AND lower(trim(`existing`.`name`)) = lower(trim(`candidate`.`name`))
  );--> statement-breakpoint

WITH `malichar_actions` (
  `id`, `name`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
  `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`,
  `manual_rider_text`, `sort_order`
) AS (VALUES
  ('character-malichar-dagger-v1', 'Dagger', 9, 'melee', 1, 4, 5, 'piercing', 5, 20, 0, NULL, 10),
  ('character-malichar-glimmering-moonbow-v1', 'Glimmering Moonbow, Shortbow', 10, 'ranged', 1, 6, 6,
   'piercing', NULL, 80, 1,
   'Also deals 1d6 radiant damage. The additional radiant die is not yet included in the automatic damage roll.', 20),
  ('character-malichar-rapier-v1', 'Rapier +1', 10, 'melee', 1, 8, 6, 'piercing', 5, NULL, 0, NULL, 30),
  ('character-malichar-fire-bolt-v1', 'Fire Bolt', 6, 'ranged', 2, 10, 0, 'fire', NULL, 120, 0, NULL, 40),
  ('character-malichar-unarmed-strike-v1', 'Unarmed Strike', 3, 'melee', 0, 6, 0, 'bludgeoning', 5, NULL, 0, NULL, 50)
)
INSERT OR IGNORE INTO `combat_action_profiles`
(`id`, `campaign_character_id`, `name`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
 `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`, `manual_rider_text`,
 `alternate_damage_json`, `source_kind`, `source_ref`, `sort_order`, `is_enabled`, `created_at`, `updated_at`)
SELECT `id`, 'character-malichar', `name`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
       `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`, `manual_rider_text`,
       NULL, 'manual-character', 'malichar-sheet-2026-08-30', `sort_order`, 1, 1788116347664, 1788116347664
FROM `malichar_actions` AS `candidate`
WHERE EXISTS (SELECT 1 FROM `campaign_characters` WHERE `id` = 'character-malichar')
  AND NOT EXISTS (
    SELECT 1 FROM `combat_action_profiles` AS `existing`
    WHERE `existing`.`campaign_character_id` = 'character-malichar'
      AND lower(trim(`existing`.`name`)) = lower(trim(`candidate`.`name`))
  );--> statement-breakpoint

INSERT OR IGNORE INTO `app_maintenance` (`id`, `completed_at`)
VALUES ('dareleth-actions-malichar-repair-v1', 1788119919737);
