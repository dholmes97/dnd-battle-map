UPDATE `identities`
SET `display_name` = 'QA Player 1', `updated_at` = 1788051600000
WHERE `id` = 'identity-combat-qa-player';--> statement-breakpoint

UPDATE `participants`
SET `qa_persona` = 'player1', `name` = 'QA Player 1'
WHERE `encounter_id` = 'encounter-combat-rolling-qa' AND `qa_persona` = 'player';--> statement-breakpoint

UPDATE `campaigns`
SET `name` = 'Interaction QA', `updated_at` = 1788051600000
WHERE `id` = 'campaign-combat-rolling-qa';--> statement-breakpoint

UPDATE `encounters`
SET `name` = 'Interaction QA Arena', `version` = `version` + 1, `updated_at` = 1788051600000
WHERE `id` = 'encounter-combat-rolling-qa';--> statement-breakpoint

INSERT OR IGNORE INTO `identities`
(`id`, `display_name`, `login_email`, `can_create_campaigns`, `can_use_qa_sessions`, `created_at`, `updated_at`) VALUES
('identity-combat-qa-player-2', 'QA Player 2', 'qa-player-2@invalid.local', 0, 0, 1788051600000, 1788051600000);--> statement-breakpoint

INSERT OR IGNORE INTO `campaign_memberships`
(`id`, `campaign_id`, `identity_id`, `role`, `created_at`, `updated_at`) VALUES
('membership-combat-qa-player-2', 'campaign-combat-rolling-qa', 'identity-combat-qa-player-2', 'player', 1788051600000, 1788051600000);--> statement-breakpoint

INSERT OR IGNORE INTO `campaign_characters`
(`id`, `campaign_id`, `controller_membership_id`, `name`, `class_name`, `art_asset`, `size`, `speed`,
 `armor_class`, `max_hp`, `sort_order`, `is_active`, `created_at`, `updated_at`) VALUES
('character-combat-qa-player-2', 'campaign-combat-rolling-qa', 'membership-combat-qa-player-2', 'QA Scout',
 'Rogue', '/assets/tokens/characters/malichar-rogue-01.png', 'medium', 30, 15, 24, 20, 1, 1788051600000, 1788051600000);--> statement-breakpoint

UPDATE `tokens`
SET `initiative_order` = 3, `updated_at` = 1788051600000
WHERE `id` = 'token-combat-qa-unconfigured';--> statement-breakpoint

INSERT OR IGNORE INTO `tokens`
(`id`, `encounter_id`, `name`, `x`, `y`, `art_asset`, `kind`, `size`, `speed`, `armor_class`, `hp`, `max_hp`,
 `temporary_hp`, `is_hidden`, `campaign_character_id`, `catalog_creature_id`, `initiative`, `initiative_group_id`,
 `initiative_order`, `turn_complete`, `movement_used`, `altitude`, `updated_at`) VALUES
('token-combat-qa-player-2', 'encounter-combat-rolling-qa', 'QA Scout', 5.5, 7.5,
 '/assets/tokens/characters/malichar-rogue-01.png', 'character', 'medium', 30, 15, 24, 24, 0, 0,
 'character-combat-qa-player-2', NULL, 14, NULL, 2, 0, 0, 0, 1788051600000);--> statement-breakpoint

INSERT OR IGNORE INTO `combat_action_profiles`
(`id`, `campaign_character_id`, `name`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
 `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`, `manual_rider_text`, `alternate_damage_json`,
 `source_kind`, `source_ref`, `sort_order`, `is_enabled`, `created_at`, `updated_at`) VALUES
('character-combat-qa-player-2-rapier-v1', 'character-combat-qa-player-2', 'Rapier', 5, 'melee', 1, 8, 3,
 'piercing', 5, NULL, 0, '', NULL, 'manual-character', 'qa-fixture-v2', 10, 1, 1788051600000, 1788051600000),
('character-combat-qa-player-2-shortbow-v1', 'character-combat-qa-player-2', 'Shortbow', 5, 'ranged', 1, 6, 3,
 'piercing', NULL, 80, 0, '', NULL, 'manual-character', 'qa-fixture-v2', 20, 1, 1788051600000, 1788051600000);--> statement-breakpoint

INSERT OR IGNORE INTO `app_maintenance` (`id`, `completed_at`)
VALUES ('interaction-qa-two-players-v1', 1788051600000);
