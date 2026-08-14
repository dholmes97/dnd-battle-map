CREATE TABLE `scenario_provisioning_mail_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`reply_id` text NOT NULL,
	`mailbox_key` text NOT NULL,
	`thread_id` text NOT NULL,
	`provider_message_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`reply_id`) REFERENCES `scenario_provisioning_mail_replies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_scenario_provisioning_mail_messages_mailbox_message` ON `scenario_provisioning_mail_messages` (`mailbox_key`,`provider_message_id`);--> statement-breakpoint
CREATE INDEX `idx_scenario_provisioning_mail_messages_reply` ON `scenario_provisioning_mail_messages` (`reply_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `scenario_provisioning_mail_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`mailbox_key` text NOT NULL,
	`thread_id` text NOT NULL,
	`reply_kind` text NOT NULL,
	`response_marker` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `scenario_provisioning_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_scenario_provisioning_mail_replies_job_kind` ON `scenario_provisioning_mail_replies` (`job_id`,`reply_kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_scenario_provisioning_mail_replies_marker` ON `scenario_provisioning_mail_replies` (`response_marker`);--> statement-breakpoint
CREATE INDEX `idx_scenario_provisioning_mail_replies_thread` ON `scenario_provisioning_mail_replies` (`mailbox_key`,`thread_id`,`created_at`);--> statement-breakpoint
INSERT OR REPLACE INTO `app_maintenance` (`id`, `completed_at`)
VALUES ('scenario-mail-provenance-v1', 1800000000002);--> statement-breakpoint
PRAGMA optimize;
