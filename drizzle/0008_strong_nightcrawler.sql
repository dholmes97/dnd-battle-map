DROP INDEX `idx_creature_catalog_active_sort`;--> statement-breakpoint
DROP INDEX `idx_creature_catalog_family_sort`;--> statement-breakpoint
CREATE INDEX `idx_creature_catalog_active_sort_id` ON `creature_catalog` (`is_active`,`sort_order`,`id`);--> statement-breakpoint
CREATE INDEX `idx_creature_catalog_family_sort_id` ON `creature_catalog` (`family`,`sort_order`,`id`);