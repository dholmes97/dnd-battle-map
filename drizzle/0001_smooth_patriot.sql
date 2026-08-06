PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`name` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`lock_owner_id` text,
	`lock_owner_name` text,
	`lock_expires_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_tokens`("id", "encounter_id", "name", "x", "y", "lock_owner_id", "lock_owner_name", "lock_expires_at", "updated_at") SELECT "id", "encounter_id", "name", "x", "y", "lock_owner_id", "lock_owner_name", "lock_expires_at", "updated_at" FROM `tokens`;--> statement-breakpoint
DROP TABLE `tokens`;--> statement-breakpoint
ALTER TABLE `__new_tokens` RENAME TO `tokens`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_tokens_encounter_id` ON `tokens` (`encounter_id`);