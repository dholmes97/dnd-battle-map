CREATE TABLE `scenario_provisioning_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`byte_length` integer NOT NULL,
	`sha256` text NOT NULL,
	`committed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `scenario_provisioning_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_scenario_provisioning_assets_job_asset` ON `scenario_provisioning_assets` (`job_id`,`asset_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_scenario_provisioning_assets_r2_key` ON `scenario_provisioning_assets` (`r2_key`);--> statement-breakpoint
CREATE INDEX `idx_scenario_provisioning_assets_uncommitted` ON `scenario_provisioning_assets` (`committed_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `scenario_provisioning_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`revision` integer NOT NULL,
	`operation` text NOT NULL,
	`status` text NOT NULL,
	`manifest_json` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`scenario_id` text,
	`scenario_code` text,
	`summary` text DEFAULT '' NOT NULL,
	`error_code` text,
	`result_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_scenario_provisioning_jobs_idempotency` ON `scenario_provisioning_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_scenario_provisioning_jobs_status_updated` ON `scenario_provisioning_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_scenario_provisioning_jobs_scenario` ON `scenario_provisioning_jobs` (`scenario_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `encounters` ADD `dm_briefing` text DEFAULT '' NOT NULL;--> statement-breakpoint
INSERT OR REPLACE INTO `app_maintenance` (`id`, `completed_at`)
VALUES ('scenario-provisioning-v1', 1800000000000);
