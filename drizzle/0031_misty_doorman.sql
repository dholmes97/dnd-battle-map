CREATE TABLE `auth_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`verified_email` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_auth_accounts_provider_subject` ON `auth_accounts` (`provider`,`provider_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_auth_accounts_identity_provider` ON `auth_accounts` (`identity_id`,`provider`);--> statement-breakpoint
CREATE INDEX `idx_auth_accounts_verified_email` ON `auth_accounts` (`verified_email`);--> statement-breakpoint
CREATE TABLE `auth_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`pkce_verifier` text NOT NULL,
	`nonce` text NOT NULL,
	`return_to` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_auth_oauth_states_expiry` ON `auth_oauth_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`identity_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_identity_expiry` ON `auth_sessions` (`identity_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_expiry` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `campaign_characters` ADD `size` text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaign_characters` ADD `speed` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `campaign_characters` ADD `armor_class` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `campaign_characters` ADD `max_hp` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `identities` ADD `login_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `identities` ADD `can_create_campaigns` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `identities`
SET `login_email` = CASE `id`
  WHEN 'identity-dan' THEN 'dholmes97@gmail.com'
  WHEN 'identity-kevin' THEN 'uncletev@gmail.com'
  WHEN 'identity-barry' THEN 'barry7davies@gmail.com'
  WHEN 'identity-scott' THEN 'rscottparsons2@gmail.com'
  ELSE `login_email`
END,
`can_create_campaigns` = CASE
  WHEN `id` IN ('identity-dan', 'identity-kevin', 'identity-barry', 'identity-scott') THEN 1
  ELSE `can_create_campaigns`
END;--> statement-breakpoint
UPDATE `campaign_characters`
SET `size` = COALESCE((SELECT `size` FROM `tokens` WHERE `campaign_character_id` = `campaign_characters`.`id` AND `size` IS NOT NULL ORDER BY `updated_at` DESC LIMIT 1), `size`),
    `speed` = COALESCE((SELECT `speed` FROM `tokens` WHERE `campaign_character_id` = `campaign_characters`.`id` AND `speed` IS NOT NULL ORDER BY `updated_at` DESC LIMIT 1), `speed`),
    `armor_class` = COALESCE((SELECT `armor_class` FROM `tokens` WHERE `campaign_character_id` = `campaign_characters`.`id` AND `armor_class` IS NOT NULL ORDER BY `updated_at` DESC LIMIT 1), `armor_class`),
    `max_hp` = COALESCE((SELECT `max_hp` FROM `tokens` WHERE `campaign_character_id` = `campaign_characters`.`id` AND `max_hp` IS NOT NULL ORDER BY `updated_at` DESC LIMIT 1), `max_hp`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_identities_login_email` ON `identities` (`login_email`);--> statement-breakpoint
CREATE TRIGGER `limit_auth_sessions_insert`
BEFORE INSERT ON `auth_sessions`
WHEN (SELECT COUNT(*) FROM `auth_sessions` WHERE `identity_id` = NEW.`identity_id` AND `revoked_at` IS NULL AND `expires_at` > CAST(strftime('%s', 'now') AS INTEGER) * 1000) >= 20
BEGIN
  SELECT RAISE(ABORT, 'resource_limit:auth_sessions');
END;--> statement-breakpoint
CREATE TRIGGER `limit_auth_oauth_states_insert`
BEFORE INSERT ON `auth_oauth_states`
WHEN (SELECT COUNT(*) FROM `auth_oauth_states` WHERE `expires_at` > CAST(strftime('%s', 'now') AS INTEGER) * 1000) >= 512
BEGIN
  SELECT RAISE(ABORT, 'resource_limit:auth_oauth_states');
END;--> statement-breakpoint
INSERT OR IGNORE INTO `app_maintenance` (`id`, `completed_at`)
VALUES ('google-auth-campaign-management-v1', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
