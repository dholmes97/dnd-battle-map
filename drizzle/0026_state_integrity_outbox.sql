CREATE TABLE `mutation_assertions` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `mutation_assertions_valid` CHECK (`valid` = 1)
);--> statement-breakpoint
CREATE TRIGGER `reject_failed_mutation_assertion`
BEFORE INSERT ON `mutation_assertions`
WHEN NEW.`valid` != 1
BEGIN
	SELECT RAISE(ABORT, 'mutation_conflict:encounter_version');
END;--> statement-breakpoint
CREATE TABLE `storage_write_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`object_key` text NOT NULL,
	`created_at` integer NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_storage_write_intents_operation_key` ON `storage_write_intents` (`operation_id`,`object_key`);--> statement-breakpoint
CREATE INDEX `idx_storage_write_intents_created` ON `storage_write_intents` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_storage_write_intents_object_key` ON `storage_write_intents` (`object_key`);--> statement-breakpoint
CREATE TABLE `storage_cleanup_outbox` (
	`object_key` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`available_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	`last_error` text
);--> statement-breakpoint
CREATE INDEX `idx_storage_cleanup_outbox_pending` ON `storage_cleanup_outbox` (`completed_at`,`available_at`);--> statement-breakpoint
CREATE INDEX `idx_scenario_provisioning_jobs_created` ON `scenario_provisioning_jobs` (`created_at`);--> statement-breakpoint

CREATE TRIGGER `limit_active_handouts_insert`
BEFORE INSERT ON `handouts`
WHEN NEW.`deleted_at` IS NULL
 AND (SELECT COUNT(*) FROM `handouts`
      WHERE `encounter_id` = NEW.`encounter_id` AND `deleted_at` IS NULL) >= 50
BEGIN
	SELECT RAISE(ABORT, 'resource_limit:active_handouts');
END;--> statement-breakpoint

CREATE TRIGGER `limit_scenario_provisioning_jobs_hourly`
BEFORE INSERT ON `scenario_provisioning_jobs`
WHEN (SELECT COUNT(*) FROM `scenario_provisioning_jobs`
      WHERE `created_at` >= NEW.`created_at` - 3600000) >= 12
BEGIN
	SELECT RAISE(ABORT, 'resource_limit:scenario_provisioning_jobs_hourly');
END;--> statement-breakpoint

INSERT OR REPLACE INTO `app_maintenance` (`id`, `completed_at`)
VALUES ('state-integrity-v1', 1800000000004);--> statement-breakpoint
PRAGMA optimize;
