CREATE TABLE `map_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`source_prompt` text,
	`package_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_map_presets_encounter_updated` ON `map_presets` (`encounter_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `encounters` ADD `map_package_json` text;--> statement-breakpoint
ALTER TABLE `encounters` ADD `active_map_preset_id` text;--> statement-breakpoint
ALTER TABLE `encounters` ADD `grid_width` integer DEFAULT 16 NOT NULL;--> statement-breakpoint
ALTER TABLE `encounters` ADD `grid_height` integer DEFAULT 11 NOT NULL;