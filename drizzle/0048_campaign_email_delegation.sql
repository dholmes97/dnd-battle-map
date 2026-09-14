ALTER TABLE `campaign_memberships` ADD `can_provision_scenarios` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- One-time, explicitly requested delegation; subsequent revocation remains durable.
UPDATE campaign_memberships SET can_provision_scenarios = 1
WHERE campaign_id = 'campaign-force-of-nature' AND identity_id = 'identity-dan';
