ALTER TABLE `combat_rolls` ADD `dm_private` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `combat_rolls` ADD `released_outcome` text;--> statement-breakpoint
ALTER TABLE `combat_rolls` ADD `outcome_released_at` integer;