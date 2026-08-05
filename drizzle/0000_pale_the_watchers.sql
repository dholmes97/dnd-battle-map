CREATE TABLE `actions` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`action_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_actions_encounter_created_at` ON `actions` (`encounter_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `encounters` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encounters_code_unique` ON `encounters` (`code`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`name` text NOT NULL,
	`session_secret` text NOT NULL,
	`joined_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_session_secret_unique` ON `participants` (`session_secret`);--> statement-breakpoint
CREATE INDEX `idx_participants_encounter_id` ON `participants` (`encounter_id`);--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`name` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`lock_owner_id` text,
	`lock_owner_name` text,
	`lock_expires_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tokens_encounter_id` ON `tokens` (`encounter_id`);--> statement-breakpoint
PRAGMA optimize;
