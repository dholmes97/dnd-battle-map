INSERT OR IGNORE INTO `combat_action_profiles`
(`id`, `campaign_character_id`, `name`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
 `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`, `alternate_damage_json`,
 `source_kind`, `source_ref`, `sort_order`, `is_enabled`, `created_at`, `updated_at`) VALUES
('character-combat-qa-guiding-bolt-v1', 'character-combat-qa-player', 'Guiding Bolt', 8, 'ranged', 4, 6, 0,
 'radiant', NULL, 120, 1, NULL, 'manual-character', 'qa-fixture-v1', 20, 1, 1787965200000, 1787965200000);--> statement-breakpoint

INSERT OR IGNORE INTO `app_maintenance` (`id`, `completed_at`)
VALUES ('combat-qa-guiding-bolt-v1', 1787965200000);
