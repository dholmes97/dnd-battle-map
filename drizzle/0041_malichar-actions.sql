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
VALUES ('malichar-character-sheet-actions-v1', 1788116347664);
