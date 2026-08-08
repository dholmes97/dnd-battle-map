ALTER TABLE `creature_catalog` ADD `creature_type` text DEFAULT 'monstrosity' NOT NULL;--> statement-breakpoint
ALTER TABLE `creature_catalog` ADD `default_hp` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `creature_catalog` ADD `hit_dice` text;--> statement-breakpoint
ALTER TABLE `creature_catalog` ADD `armor_class` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `creature_catalog` ADD `challenge_rating` text;--> statement-breakpoint
ALTER TABLE `creature_catalog` ADD `walk_speed` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `creature_catalog` ADD `fly_speed` integer;--> statement-breakpoint
ALTER TABLE `creature_catalog` ADD `swim_speed` integer;--> statement-breakpoint
ALTER TABLE `creature_catalog` ADD `climb_speed` integer;--> statement-breakpoint
ALTER TABLE `creature_catalog` ADD `burrow_speed` integer;
