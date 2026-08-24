CREATE INDEX `idx_encounters_campaign_updated` ON `encounters` (`campaign_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_participants_identity_encounter` ON `participants` (`identity_id`,`encounter_id`);--> statement-breakpoint
CREATE INDEX `idx_participants_membership_encounter` ON `participants` (`campaign_membership_id`,`encounter_id`);