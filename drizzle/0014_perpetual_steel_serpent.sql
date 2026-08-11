CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`sender_name` text NOT NULL,
	`sender_role` text NOT NULL,
	`recipient_name` text,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_encounter_created` ON `chat_messages` (`encounter_id`,`created_at`,`id`);