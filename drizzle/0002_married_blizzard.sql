ALTER TABLE `tokens` ADD `owner_participant_id` text REFERENCES participants(id);--> statement-breakpoint
ALTER TABLE `tokens` ADD `owner_name` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_owner_participant_id_unique` ON `tokens` (`owner_participant_id`);