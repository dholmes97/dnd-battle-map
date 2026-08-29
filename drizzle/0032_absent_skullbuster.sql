CREATE TABLE `combat_action_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_character_id` text,
	`creature_catalog_id` text,
	`name` text NOT NULL,
	`resolution_mode` text DEFAULT 'attack-vs-ac' NOT NULL,
	`attack_bonus` integer NOT NULL,
	`attack_kind` text NOT NULL,
	`damage_dice_count` integer NOT NULL,
	`damage_die_size` integer NOT NULL,
	`damage_modifier` integer NOT NULL,
	`damage_type` text NOT NULL,
	`reach_feet` integer,
	`range_feet` integer,
	`manual_rider` integer DEFAULT false NOT NULL,
	`alternate_damage_json` text,
	`source_kind` text NOT NULL,
	`source_ref` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_character_id`) REFERENCES `campaign_characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creature_catalog_id`) REFERENCES `creature_catalog`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "combat_action_profiles_one_owner" CHECK((
      ("combat_action_profiles"."campaign_character_id" IS NOT NULL AND "combat_action_profiles"."creature_catalog_id" IS NULL) OR
      ("combat_action_profiles"."campaign_character_id" IS NULL AND "combat_action_profiles"."creature_catalog_id" IS NOT NULL)
    ))
);
--> statement-breakpoint
CREATE INDEX `idx_combat_actions_character_sort` ON `combat_action_profiles` (`campaign_character_id`,`sort_order`,`id`);--> statement-breakpoint
CREATE INDEX `idx_combat_actions_creature_sort` ON `combat_action_profiles` (`creature_catalog_id`,`sort_order`,`id`);--> statement-breakpoint
CREATE TABLE `combat_rolls` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`authenticated_actor_identity_id` text,
	`attacker_token_id` text NOT NULL,
	`target_token_id` text NOT NULL,
	`action_profile_id` text,
	`action_source` text NOT NULL,
	`action_snapshot_json` text NOT NULL,
	`roll_mode` text NOT NULL,
	`attack_dice_json` text NOT NULL,
	`kept_d20` integer NOT NULL,
	`bless_die` integer,
	`attack_total` integer NOT NULL,
	`outcome` text NOT NULL,
	`damage_dice_json` text NOT NULL,
	`damage_total` integer NOT NULL,
	`in_turn` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`authenticated_actor_identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attacker_token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`action_profile_id`) REFERENCES `combat_action_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_combat_rolls_encounter_operation` ON `combat_rolls` (`encounter_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `idx_combat_rolls_encounter_created` ON `combat_rolls` (`encounter_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_combat_rolls_participant_created` ON `combat_rolls` (`participant_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `damage_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`roll_id` text NOT NULL,
	`target_token_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`rolled_damage` integer NOT NULL,
	`final_damage` integer,
	`adjudication_method` text,
	`adjudicated_by_participant_id` text,
	`adjudication_note` text,
	`history_action_id` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`roll_id`) REFERENCES `combat_rolls`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`adjudicated_by_participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_damage_proposals_roll` ON `damage_proposals` (`roll_id`);--> statement-breakpoint
CREATE INDEX `idx_damage_proposals_encounter_status_created` ON `damage_proposals` (`encounter_id`,`status`,`created_at`,`id`);--> statement-breakpoint
ALTER TABLE `campaigns` ADD `is_qa` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `identities` ADD `can_use_qa_sessions` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `participants` ADD `authenticated_actor_identity_id` text REFERENCES identities(id);--> statement-breakpoint
ALTER TABLE `participants` ADD `qa_persona` text;--> statement-breakpoint
ALTER TABLE `tokens` ADD `temporary_hp` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tokens` ADD `catalog_creature_id` text REFERENCES creature_catalog(id);--> statement-breakpoint
CREATE INDEX `idx_tokens_catalog_creature_id` ON `tokens` (`catalog_creature_id`);--> statement-breakpoint
CREATE TRIGGER `combat_action_profiles_owner_quota_insert`
BEFORE INSERT ON `combat_action_profiles`
WHEN (SELECT COUNT(*) FROM `combat_action_profiles`
      WHERE (`campaign_character_id` IS NEW.`campaign_character_id` AND NEW.`campaign_character_id` IS NOT NULL)
         OR (`creature_catalog_id` IS NEW.`creature_catalog_id` AND NEW.`creature_catalog_id` IS NOT NULL)) >= 24
BEGIN SELECT RAISE(ABORT, 'combat_action_profile_owner_quota'); END;--> statement-breakpoint
CREATE TRIGGER `combat_rolls_encounter_quota_insert`
BEFORE INSERT ON `combat_rolls`
WHEN (SELECT COUNT(*) FROM `combat_rolls` WHERE `encounter_id` = NEW.`encounter_id`) >= 2000
BEGIN SELECT RAISE(ABORT, 'combat_roll_encounter_quota'); END;--> statement-breakpoint
CREATE TRIGGER `damage_proposals_pending_quota_insert`
BEFORE INSERT ON `damage_proposals`
WHEN NEW.`status` = 'pending' AND
     (SELECT COUNT(*) FROM `damage_proposals` WHERE `encounter_id` = NEW.`encounter_id` AND `status` = 'pending') >= 100
BEGIN SELECT RAISE(ABORT, 'pending_damage_proposal_quota'); END;--> statement-breakpoint
CREATE TRIGGER `tokens_temporary_hp_insert_guard`
BEFORE INSERT ON `tokens`
WHEN NEW.`temporary_hp` < 0 OR NEW.`temporary_hp` > 100000
BEGIN SELECT RAISE(ABORT, 'invalid_temporary_hp'); END;--> statement-breakpoint
CREATE TRIGGER `tokens_temporary_hp_update_guard`
BEFORE UPDATE OF `temporary_hp` ON `tokens`
WHEN NEW.`temporary_hp` < 0 OR NEW.`temporary_hp` > 100000
BEGIN SELECT RAISE(ABORT, 'invalid_temporary_hp'); END;--> statement-breakpoint
UPDATE `identities` SET `can_use_qa_sessions` = 1
WHERE lower(`login_email`) = 'dholmes97@gmail.com';--> statement-breakpoint
INSERT OR IGNORE INTO `combat_action_profiles`
(`id`, `creature_catalog_id`, `name`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
 `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`, `alternate_damage_json`,
 `source_kind`, `source_ref`, `sort_order`, `is_enabled`, `created_at`, `updated_at`)
SELECT 'catalog-goblin-raider-scimitar-v1', `id`, 'Scimitar', 4, 'melee', 1, 6, 2, 'slashing', 5, NULL, 0, NULL,
       'catalog-maintained', 'project-curated-v1', 10, 1, 1787918400000, 1787918400000
FROM `creature_catalog` WHERE `id` = 'goblin-raider';--> statement-breakpoint
INSERT OR IGNORE INTO `combat_action_profiles`
(`id`, `creature_catalog_id`, `name`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
 `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`, `alternate_damage_json`,
 `source_kind`, `source_ref`, `sort_order`, `is_enabled`, `created_at`, `updated_at`)
SELECT 'catalog-goblin-raider-shortbow-v1', `id`, 'Shortbow', 4, 'ranged', 1, 6, 2, 'piercing', NULL, 80, 0, NULL,
       'catalog-maintained', 'project-curated-v1', 20, 1, 1787918400000, 1787918400000
FROM `creature_catalog` WHERE `id` = 'goblin-raider';--> statement-breakpoint
INSERT OR IGNORE INTO `combat_action_profiles`
(`id`, `creature_catalog_id`, `name`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
 `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`, `alternate_damage_json`,
 `source_kind`, `source_ref`, `sort_order`, `is_enabled`, `created_at`, `updated_at`)
SELECT 'catalog-gray-wolf-bite-v1', `id`, 'Bite', 4, 'melee', 2, 4, 2, 'piercing', 5, NULL, 1, NULL,
       'catalog-maintained', 'project-curated-v1', 10, 1, 1787918400000, 1787918400000
FROM `creature_catalog` WHERE `id` = 'gray-wolf';--> statement-breakpoint
INSERT OR IGNORE INTO `combat_action_profiles`
(`id`, `creature_catalog_id`, `name`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
 `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`, `alternate_damage_json`,
 `source_kind`, `source_ref`, `sort_order`, `is_enabled`, `created_at`, `updated_at`)
SELECT 'catalog-skeleton-guard-shortsword-v1', `id`, 'Shortsword', 4, 'melee', 1, 6, 2, 'piercing', 5, NULL, 0, NULL,
       'catalog-maintained', 'project-curated-v1', 10, 1, 1787918400000, 1787918400000
FROM `creature_catalog` WHERE `id` = 'skeleton-guard';--> statement-breakpoint
INSERT OR IGNORE INTO `combat_action_profiles`
(`id`, `creature_catalog_id`, `name`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
 `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`, `alternate_damage_json`,
 `source_kind`, `source_ref`, `sort_order`, `is_enabled`, `created_at`, `updated_at`)
SELECT 'catalog-skeleton-guard-shortbow-v1', `id`, 'Shortbow', 4, 'ranged', 1, 6, 2, 'piercing', NULL, 80, 0, NULL,
       'catalog-maintained', 'project-curated-v1', 20, 1, 1787918400000, 1787918400000
FROM `creature_catalog` WHERE `id` = 'skeleton-guard';
--> statement-breakpoint
INSERT OR IGNORE INTO `identities`
(`id`, `display_name`, `login_email`, `can_create_campaigns`, `can_use_qa_sessions`, `created_at`, `updated_at`) VALUES
('identity-combat-qa-dm', 'QA DM', 'qa-dm@invalid.local', 0, 0, 1787918400000, 1787918400000),
('identity-combat-qa-player', 'QA Player', 'qa-player@invalid.local', 0, 0, 1787918400000, 1787918400000);--> statement-breakpoint
INSERT OR IGNORE INTO `campaigns`
(`id`, `slug`, `name`, `is_qa`, `created_at`, `updated_at`) VALUES
('campaign-combat-rolling-qa', 'combat-rolling-qa', 'Combat Rolling QA', 1, 1787918400000, 1787918400000);--> statement-breakpoint
INSERT OR IGNORE INTO `campaign_memberships`
(`id`, `campaign_id`, `identity_id`, `role`, `created_at`, `updated_at`) VALUES
('membership-combat-qa-dm', 'campaign-combat-rolling-qa', 'identity-combat-qa-dm', 'dm', 1787918400000, 1787918400000),
('membership-combat-qa-player', 'campaign-combat-rolling-qa', 'identity-combat-qa-player', 'player', 1787918400000, 1787918400000);--> statement-breakpoint
INSERT OR IGNORE INTO `campaign_characters`
(`id`, `campaign_id`, `controller_membership_id`, `name`, `class_name`, `art_asset`, `size`, `speed`,
 `armor_class`, `max_hp`, `sort_order`, `is_active`, `created_at`, `updated_at`) VALUES
('character-combat-qa-player', 'campaign-combat-rolling-qa', 'membership-combat-qa-player', 'QA Champion',
 'Paladin', '/assets/tokens/characters/dareleth-paladin-01.png', 'medium', 30, 16, 30, 10, 1, 1787918400000, 1787918400000);--> statement-breakpoint
INSERT OR IGNORE INTO `encounters`
(`id`, `campaign_id`, `code`, `name`, `version`, `status`, `map_asset`, `map_package_json`,
 `grid_width`, `grid_height`, `current_round`, `active_initiative_order`, `strict_movement`, `updated_at`) VALUES
('encounter-combat-rolling-qa', 'campaign-combat-rolling-qa', 'COMBAT-ROLLING-QA', 'Combat Rolling QA Arena',
 1, 'active', '', NULL, 16, 11, 1, 0, 1, 1787918400000);--> statement-breakpoint
INSERT OR IGNORE INTO `tokens`
(`id`, `encounter_id`, `name`, `x`, `y`, `art_asset`, `kind`, `size`, `speed`, `armor_class`, `hp`, `max_hp`,
 `temporary_hp`, `is_hidden`, `campaign_character_id`, `catalog_creature_id`, `initiative`, `initiative_group_id`,
 `initiative_order`, `turn_complete`, `movement_used`, `altitude`, `updated_at`) VALUES
('token-combat-qa-player', 'encounter-combat-rolling-qa', 'QA Champion', 4, 5.5,
 '/assets/tokens/characters/dareleth-paladin-01.png', 'character', 'medium', 30, 16, 30, 30, 5, 0,
 'character-combat-qa-player', NULL, 16, NULL, 1, 0, 0, 0, 1787918400000),
('token-combat-qa-goblin', 'encounter-combat-rolling-qa', 'QA Goblin Raider', 9, 3.5,
 '/creature-assets/tokens/creatures/goblin-raider-01.png', 'monster', 'small', 30, 15, 7, 7, 0, 0,
 NULL, 'goblin-raider', 18, 'initiative-combat-qa-monsters', 0, 0, 0, 0, 1787918400000),
('token-combat-qa-skeleton', 'encounter-combat-rolling-qa', 'QA Skeleton Archer', 10, 5.5,
 '/creature-assets/tokens/creatures/skeleton-guard-01.png', 'monster', 'medium', 30, 13, 13, 13, 0, 0,
 NULL, 'skeleton-guard', 18, 'initiative-combat-qa-monsters', 0, 0, 0, 0, 1787918400000),
('token-combat-qa-unconfigured', 'encounter-combat-rolling-qa', 'QA Unconfigured Rat', 9, 7.5,
 '/creature-assets/tokens/creatures/giant-rat-01.png', 'monster', 'small', 30, 12, 7, 7, 0, 0,
 NULL, NULL, 12, NULL, 2, 0, 0, 0, 1787918400000);--> statement-breakpoint
INSERT OR IGNORE INTO `effects`
(`id`, `encounter_id`, `token_id`, `name`, `effect_type`, `duration_rounds`, `expires_round`, `reminder_timing`, `created_by`, `created_at`) VALUES
('effect-combat-qa-bless', 'encounter-combat-rolling-qa', 'token-combat-qa-player', 'Bless', 'concentration', 10, 11, 'end', 'qa-fixture', 1787918400000);--> statement-breakpoint
INSERT OR IGNORE INTO `combat_action_profiles`
(`id`, `campaign_character_id`, `name`, `attack_bonus`, `attack_kind`, `damage_dice_count`, `damage_die_size`,
 `damage_modifier`, `damage_type`, `reach_feet`, `range_feet`, `manual_rider`, `alternate_damage_json`,
 `source_kind`, `source_ref`, `sort_order`, `is_enabled`, `created_at`, `updated_at`) VALUES
('character-combat-qa-longsword-v1', 'character-combat-qa-player', 'Longsword +1', 7, 'melee', 1, 8, 4,
 'slashing', 5, NULL, 0, '{"label":"Two-handed","formula":{"count":1,"sides":10,"modifier":4}}',
 'manual-character', 'qa-fixture-v1', 10, 1, 1787918400000, 1787918400000);
