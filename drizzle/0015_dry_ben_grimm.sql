CREATE TABLE `handouts` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`title` text NOT NULL,
	`display_key` text NOT NULL,
	`thumbnail_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`display_bytes` integer NOT NULL,
	`thumbnail_bytes` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_handouts_encounter_created` ON `handouts` (`encounter_id`,`created_at`,`id`);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `handout_id` text REFERENCES handouts(id) ON DELETE SET NULL;
