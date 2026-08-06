CREATE TABLE `annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`annotation_type` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`x2` real,
	`y2` real,
	`color` text DEFAULT '#f5c65c' NOT NULL,
	`label` text,
	`created_by` text NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_annotations_encounter_created_at` ON `annotations` (`encounter_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `effects` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`token_id` text NOT NULL,
	`name` text NOT NULL,
	`effect_type` text DEFAULT 'condition' NOT NULL,
	`duration_rounds` integer,
	`expires_round` integer,
	`reminder_timing` text DEFAULT 'end' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_effects_encounter_token` ON `effects` (`encounter_id`,`token_id`);--> statement-breakpoint
DROP INDEX `tokens_owner_participant_id_unique`;--> statement-breakpoint
ALTER TABLE `tokens` ADD `art_asset` text;--> statement-breakpoint
ALTER TABLE `tokens` ADD `kind` text DEFAULT 'character' NOT NULL;--> statement-breakpoint
ALTER TABLE `tokens` ADD `speed` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `tokens` ADD `hp` integer;--> statement-breakpoint
ALTER TABLE `tokens` ADD `max_hp` integer;--> statement-breakpoint
ALTER TABLE `tokens` ADD `is_hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tokens` ADD `summoner_token_id` text;--> statement-breakpoint
ALTER TABLE `tokens` ADD `initiative` integer;--> statement-breakpoint
ALTER TABLE `tokens` ADD `initiative_order` integer;--> statement-breakpoint
ALTER TABLE `tokens` ADD `turn_complete` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tokens` ADD `movement_used` real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_tokens_owner_participant_id` ON `tokens` (`owner_participant_id`);--> statement-breakpoint
ALTER TABLE `encounters` ADD `status` text DEFAULT 'setup' NOT NULL;--> statement-breakpoint
ALTER TABLE `encounters` ADD `map_asset` text DEFAULT '/assets/terrain/terrain-dungeon-flagstone-01.png' NOT NULL;--> statement-breakpoint
ALTER TABLE `encounters` ADD `current_round` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `encounters` ADD `active_initiative_order` integer;--> statement-breakpoint
ALTER TABLE `participants` ADD `role` text DEFAULT 'player' NOT NULL;--> statement-breakpoint
UPDATE `tokens` SET `name` = 'Dar''eleth', `art_asset` = '/assets/tokens/characters/dareleth-paladin-01.png', `kind` = 'character' WHERE `id` = 'token-bronze-warden' AND `name` = 'Bronze Warden';--> statement-breakpoint
UPDATE `tokens` SET `name` = 'Malichar', `art_asset` = '/assets/tokens/characters/malichar-rogue-01.png', `kind` = 'character' WHERE `id` = 'token-ember-scout' AND `name` = 'Ember Scout';--> statement-breakpoint
UPDATE `tokens` SET `name` = 'Jelton', `art_asset` = '/assets/tokens/characters/jelton-druid-01.png', `kind` = 'character' WHERE `id` = 'token-ash-mystic' AND `name` = 'Ash Mystic';--> statement-breakpoint
UPDATE `encounters` SET `version` = `version` + 1, `updated_at` = unixepoch('subsec') * 1000 WHERE `id` = 'encounter-ember-keep';
