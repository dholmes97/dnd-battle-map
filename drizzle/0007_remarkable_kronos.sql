CREATE TABLE `creature_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`family` text NOT NULL,
	`size` text NOT NULL,
	`default_speed` integer NOT NULL,
	`source_asset` text NOT NULL,
	`token_asset` text NOT NULL,
	`thumbnail_asset` text NOT NULL,
	`sort_order` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creature_catalog_token_asset_unique` ON `creature_catalog` (`token_asset`);--> statement-breakpoint
CREATE INDEX `idx_creature_catalog_active_sort` ON `creature_catalog` (`is_active`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_creature_catalog_family_sort` ON `creature_catalog` (`family`,`sort_order`);
