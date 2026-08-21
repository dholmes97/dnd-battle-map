CREATE TABLE `request_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`request_count` integer NOT NULL,
	`window_ends_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_request_rate_limits_expiry` ON `request_rate_limits` (`window_ends_at`);--> statement-breakpoint
CREATE TABLE `operation_leases` (
	`key` text PRIMARY KEY NOT NULL,
	`lease_token` text NOT NULL,
	`expires_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_operation_leases_expiry` ON `operation_leases` (`expires_at`);--> statement-breakpoint

CREATE TRIGGER `limit_encounters_insert`
BEFORE INSERT ON `encounters`
WHEN (SELECT COUNT(*) FROM `encounters`) >= 100
BEGIN
	SELECT RAISE(ABORT, 'resource_limit:encounters');
END;--> statement-breakpoint
CREATE TRIGGER `limit_participants_insert`
BEFORE INSERT ON `participants`
WHEN (SELECT COUNT(*) FROM `participants` WHERE `encounter_id` = NEW.`encounter_id`) >= 64
BEGIN
	SELECT RAISE(ABORT, 'resource_limit:participants');
END;--> statement-breakpoint
CREATE TRIGGER `limit_tokens_insert`
BEFORE INSERT ON `tokens`
WHEN (SELECT COUNT(*) FROM `tokens` WHERE `encounter_id` = NEW.`encounter_id`) >= 256
BEGIN
	SELECT RAISE(ABORT, 'resource_limit:tokens');
END;--> statement-breakpoint
CREATE TRIGGER `limit_effects_insert`
BEFORE INSERT ON `effects`
WHEN (SELECT COUNT(*) FROM `effects` WHERE `encounter_id` = NEW.`encounter_id`) >= 1024
  OR (SELECT COUNT(*) FROM `effects` WHERE `encounter_id` = NEW.`encounter_id` AND `token_id` = NEW.`token_id`) >= 32
BEGIN
	SELECT RAISE(ABORT, 'resource_limit:effects');
END;--> statement-breakpoint
CREATE TRIGGER `limit_annotations_insert`
BEFORE INSERT ON `annotations`
WHEN (SELECT COUNT(*) FROM `annotations` WHERE `encounter_id` = NEW.`encounter_id`) >= 500
BEGIN
	SELECT RAISE(ABORT, 'resource_limit:annotations');
END;--> statement-breakpoint
CREATE TRIGGER `limit_map_presets_insert`
BEFORE INSERT ON `map_presets`
WHEN (SELECT COUNT(*) FROM `map_presets` WHERE `encounter_id` = NEW.`encounter_id`) >= 60
BEGIN
	SELECT RAISE(ABORT, 'resource_limit:map_presets');
END;--> statement-breakpoint
CREATE TRIGGER `limit_handouts_insert`
BEFORE INSERT ON `handouts`
WHEN (SELECT COUNT(*) FROM `handouts` WHERE `encounter_id` = NEW.`encounter_id`) >= 200
BEGIN
	SELECT RAISE(ABORT, 'resource_limit:handouts');
END;--> statement-breakpoint
CREATE TRIGGER `limit_chat_messages_insert`
BEFORE INSERT ON `chat_messages`
WHEN (SELECT COUNT(*) FROM `chat_messages` WHERE `encounter_id` = NEW.`encounter_id`) >= 2000
BEGIN
	SELECT RAISE(ABORT, 'resource_limit:chat_messages');
END;--> statement-breakpoint
CREATE TRIGGER `limit_actions_insert`
BEFORE INSERT ON `actions`
WHEN (SELECT COUNT(*) FROM `actions` WHERE `encounter_id` = NEW.`encounter_id`) >= 20000
BEGIN
	SELECT RAISE(ABORT, 'resource_limit:actions');
END;--> statement-breakpoint
CREATE TRIGGER `limit_creature_catalog_insert`
BEFORE INSERT ON `creature_catalog`
WHEN (SELECT COUNT(*) FROM `creature_catalog`) >= 2000
  AND NOT EXISTS (SELECT 1 FROM `creature_catalog` WHERE `id` = NEW.`id`)
BEGIN
	SELECT RAISE(ABORT, 'resource_limit:creature_catalog');
END;--> statement-breakpoint

INSERT OR REPLACE INTO `app_maintenance` (`id`, `completed_at`)
VALUES ('resource-guardrails-v1', 1800000000003);--> statement-breakpoint
PRAGMA optimize;
