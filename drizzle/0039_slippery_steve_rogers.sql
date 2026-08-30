CREATE TABLE `creature_asset_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`creature_catalog_id` text NOT NULL,
	`variant` text NOT NULL,
	`version` integer NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`byte_length` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`creature_catalog_id`) REFERENCES `creature_catalog`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creature_asset_variants_r2_key_unique` ON `creature_asset_variants` (`r2_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_creature_asset_variants_creature_variant_version` ON `creature_asset_variants` (`creature_catalog_id`,`variant`,`version`);--> statement-breakpoint
CREATE INDEX `idx_creature_asset_variants_creature` ON `creature_asset_variants` (`creature_catalog_id`);--> statement-breakpoint
CREATE TRIGGER `limit_creature_asset_variants_insert`
BEFORE INSERT ON `creature_asset_variants`
WHEN (SELECT COUNT(*) FROM `creature_asset_variants`) >= 4000
  AND NOT EXISTS (SELECT 1 FROM `creature_asset_variants` WHERE `id` = NEW.`id`)
BEGIN
	SELECT RAISE(ABORT, 'resource_limit:creature_asset_variants');
END;
