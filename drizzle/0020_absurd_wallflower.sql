ALTER TABLE `scenario_provisioning_jobs` ADD `base_scenario_version` integer;--> statement-breakpoint
INSERT OR REPLACE INTO `app_maintenance` (`id`, `completed_at`)
VALUES ('scenario-provisioning-revision-guard-v1', 1800000000001);
