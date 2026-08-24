CREATE TABLE `campaign_characters` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`controller_membership_id` text NOT NULL,
	`name` text NOT NULL,
	`class_name` text DEFAULT '' NOT NULL,
	`art_asset` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`controller_membership_id`) REFERENCES `campaign_memberships`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_campaign_characters_campaign_name` ON `campaign_characters` (`campaign_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_campaign_characters_controller` ON `campaign_characters` (`controller_membership_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `campaign_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`identity_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`identity_id`) REFERENCES `identities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_campaign_memberships_campaign_identity` ON `campaign_memberships` (`campaign_id`,`identity_id`);--> statement-breakpoint
CREATE INDEX `idx_campaign_memberships_identity_campaign` ON `campaign_memberships` (`identity_id`,`campaign_id`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_campaigns_slug` ON `campaigns` (`slug`);--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_identities_display_name` ON `identities` (`display_name`);--> statement-breakpoint
ALTER TABLE `encounters` ADD `campaign_id` text REFERENCES campaigns(id);--> statement-breakpoint
ALTER TABLE `participants` ADD `identity_id` text REFERENCES identities(id);--> statement-breakpoint
ALTER TABLE `participants` ADD `campaign_membership_id` text REFERENCES campaign_memberships(id);--> statement-breakpoint
ALTER TABLE `tokens` ADD `campaign_character_id` text REFERENCES campaign_characters(id);--> statement-breakpoint
CREATE INDEX `idx_tokens_campaign_character_id` ON `tokens` (`campaign_character_id`);
--> statement-breakpoint

INSERT OR IGNORE INTO `identities` (`id`, `display_name`, `created_at`, `updated_at`) VALUES
  ('identity-dan', 'Dan', 0, 0),
  ('identity-barry', 'Barry', 0, 0),
  ('identity-scott', 'Scott', 0, 0),
  ('identity-kevin', 'Kevin', 0, 0);
--> statement-breakpoint
INSERT OR IGNORE INTO `campaigns` (`id`, `slug`, `name`, `created_at`, `updated_at`) VALUES
  ('campaign-force-of-nature', 'force-of-nature', 'Force of Nature', 0, 0);
--> statement-breakpoint
INSERT OR IGNORE INTO `campaign_memberships`
  (`id`, `campaign_id`, `identity_id`, `role`, `created_at`, `updated_at`) VALUES
  ('membership-force-of-nature-dan', 'campaign-force-of-nature', 'identity-dan', 'player', 0, 0),
  ('membership-force-of-nature-barry', 'campaign-force-of-nature', 'identity-barry', 'player', 0, 0),
  ('membership-force-of-nature-scott', 'campaign-force-of-nature', 'identity-scott', 'player', 0, 0),
  ('membership-force-of-nature-kevin', 'campaign-force-of-nature', 'identity-kevin', 'dm', 0, 0);
--> statement-breakpoint
INSERT OR IGNORE INTO `campaign_characters`
  (`id`, `campaign_id`, `controller_membership_id`, `name`, `class_name`, `art_asset`, `sort_order`, `is_active`, `created_at`, `updated_at`) VALUES
  ('character-dareleth', 'campaign-force-of-nature', 'membership-force-of-nature-dan', 'Dar''eleth', 'Paladin', '/assets/tokens/characters/dareleth-paladin-01.png', 10, 1, 0, 0),
  ('character-jelton', 'campaign-force-of-nature', 'membership-force-of-nature-barry', 'Jelton', 'Druid', '/assets/tokens/characters/jelton-druid-01.png', 20, 1, 0, 0),
  ('character-malichar', 'campaign-force-of-nature', 'membership-force-of-nature-scott', 'Malichar', 'Rogue', '/assets/tokens/characters/malichar-rogue-01.png', 30, 1, 0, 0);
--> statement-breakpoint

UPDATE `encounters` SET `campaign_id` = 'campaign-force-of-nature' WHERE `campaign_id` IS NULL;
--> statement-breakpoint
UPDATE `participants`
SET `identity_id` = CASE lower(`name`)
      WHEN 'dan' THEN 'identity-dan'
      WHEN 'barry' THEN 'identity-barry'
      WHEN 'scott' THEN 'identity-scott'
      WHEN 'kevin' THEN 'identity-kevin'
      ELSE NULL
    END,
    `campaign_membership_id` = CASE lower(`name`)
      WHEN 'dan' THEN 'membership-force-of-nature-dan'
      WHEN 'barry' THEN 'membership-force-of-nature-barry'
      WHEN 'scott' THEN 'membership-force-of-nature-scott'
      WHEN 'kevin' THEN 'membership-force-of-nature-kevin'
      ELSE NULL
    END
WHERE `encounter_id` IN (SELECT `id` FROM `encounters` WHERE `campaign_id` = 'campaign-force-of-nature');
--> statement-breakpoint
UPDATE `tokens`
SET `campaign_character_id` = CASE lower(`name`)
      WHEN 'dar''eleth' THEN 'character-dareleth'
      WHEN 'jelton' THEN 'character-jelton'
      WHEN 'malichar' THEN 'character-malichar'
      WHEN 'malichar jarom' THEN 'character-malichar'
      ELSE NULL
    END
WHERE `encounter_id` IN (SELECT `id` FROM `encounters` WHERE `campaign_id` = 'campaign-force-of-nature')
  AND `summoner_token_id` IS NULL;
--> statement-breakpoint

CREATE TRIGGER `require_encounter_campaign_insert`
BEFORE INSERT ON `encounters`
WHEN NEW.`campaign_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'campaign_required:encounters');
END;
--> statement-breakpoint
CREATE TRIGGER `require_encounter_campaign_update`
BEFORE UPDATE OF `campaign_id` ON `encounters`
WHEN NEW.`campaign_id` IS NULL
BEGIN
  SELECT RAISE(ABORT, 'campaign_required:encounters');
END;
--> statement-breakpoint
CREATE TRIGGER `limit_campaigns_insert`
BEFORE INSERT ON `campaigns`
WHEN (SELECT COUNT(*) FROM `campaigns`) >= 64
BEGIN
  SELECT RAISE(ABORT, 'resource_limit:campaigns');
END;
--> statement-breakpoint
CREATE TRIGGER `limit_identities_insert`
BEFORE INSERT ON `identities`
WHEN (SELECT COUNT(*) FROM `identities`) >= 256
BEGIN
  SELECT RAISE(ABORT, 'resource_limit:identities');
END;
--> statement-breakpoint
CREATE TRIGGER `limit_campaign_memberships_insert`
BEFORE INSERT ON `campaign_memberships`
WHEN (SELECT COUNT(*) FROM `campaign_memberships` WHERE `campaign_id` = NEW.`campaign_id`) >= 64
BEGIN
  SELECT RAISE(ABORT, 'resource_limit:campaign_memberships');
END;
--> statement-breakpoint
CREATE TRIGGER `limit_campaign_characters_insert`
BEFORE INSERT ON `campaign_characters`
WHEN (SELECT COUNT(*) FROM `campaign_characters` WHERE `campaign_id` = NEW.`campaign_id`) >= 64
BEGIN
  SELECT RAISE(ABORT, 'resource_limit:campaign_characters');
END;
--> statement-breakpoint
INSERT OR IGNORE INTO `app_maintenance` (`id`, `completed_at`)
VALUES ('campaign-memberships-v1', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
