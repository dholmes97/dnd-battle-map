WITH `jelton_actions` (
  `id`, `name`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
  `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`,
  `manual_rider_text`, `alternate_damage_json`, `sort_order`
) AS (VALUES
  ('character-jelton-quarterstaff-v1', 'Quarterstaff +1', 6, 'melee', 1, 6, 2, 'bludgeoning', 5, NULL, 0, NULL,
   '{"label":"Two-handed","formula":{"count":1,"sides":8,"modifier":2}}', 10),
  ('character-jelton-thorn-whip-v1', 'Thorn Whip', 9, 'melee', 2, 6, 0, 'piercing', NULL, 60, 1,
   'The target can be pulled up to 10 feet closer to the caster.', NULL, 20),
  ('character-jelton-produce-flame-v1', 'Produce Flame', 9, 'ranged', 2, 8, 0, 'fire', NULL, 60, 0, NULL, NULL, 30),
  ('character-jelton-ray-of-frost-v1', 'Ray of Frost', 7, 'ranged', 2, 8, 0, 'cold', NULL, 120, 1,
   'The target''s speed is reduced by 10 feet until the start of the caster''s next turn.', NULL, 40),
  ('character-jelton-witch-bolt-v1', 'Witch Bolt', 7, 'ranged', 1, 12, 0, 'lightning', NULL, 60, 1,
   'Concentration, up to 1 minute; the spell can deal its damage again on later turns while maintained.', NULL, 50),
  ('character-jelton-guiding-bolt-2-v1', 'Guiding Bolt (2nd level)', 9, 'ranged', 5, 6, 0, 'radiant', NULL, 240, 1,
   'The next attack roll against the target has advantage before the end of the caster''s next turn.', NULL, 70),
  ('character-jelton-guiding-bolt-3-v1', 'Guiding Bolt (3rd level)', 9, 'ranged', 6, 6, 0, 'radiant', NULL, 240, 1,
   'The next attack roll against the target has advantage before the end of the caster''s next turn.', NULL, 80),
  ('character-jelton-guiding-bolt-4-v1', 'Guiding Bolt (4th level)', 9, 'ranged', 7, 6, 0, 'radiant', NULL, 240, 1,
   'The next attack roll against the target has advantage before the end of the caster''s next turn.', NULL, 90),
  ('character-jelton-guiding-bolt-5-v1', 'Guiding Bolt (5th level)', 9, 'ranged', 8, 6, 0, 'radiant', NULL, 240, 1,
   'The next attack roll against the target has advantage before the end of the caster''s next turn.', NULL, 100),
  ('character-jelton-unarmed-strike-v1', 'Unarmed Strike', 5, 'melee', 0, 6, 2, 'bludgeoning', 5, NULL, 0, NULL, NULL, 110)
)
INSERT OR IGNORE INTO `combat_action_profiles`
(`id`, `campaign_character_id`, `name`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
 `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`, `manual_rider_text`,
 `alternate_damage_json`, `source_kind`, `source_ref`, `sort_order`, `is_enabled`, `created_at`, `updated_at`)
SELECT `id`, 'character-jelton', `name`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
       `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`, `manual_rider_text`,
       `alternate_damage_json`, 'manual-character', 'jelton-sheet-2026-08-30', `sort_order`, 1,
       1788115969808, 1788115969808
FROM `jelton_actions` AS `candidate`
WHERE EXISTS (SELECT 1 FROM `campaign_characters` WHERE `id` = 'character-jelton')
  AND NOT EXISTS (
    SELECT 1 FROM `combat_action_profiles` AS `existing`
    WHERE `existing`.`campaign_character_id` = 'character-jelton'
      AND lower(trim(`existing`.`name`)) = lower(trim(`candidate`.`name`))
  );--> statement-breakpoint

INSERT OR IGNORE INTO `app_maintenance` (`id`, `completed_at`)
VALUES ('jelton-character-sheet-actions-v1', 1788115969808);
