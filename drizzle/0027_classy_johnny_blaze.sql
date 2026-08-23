CREATE INDEX `idx_actions_encounter_participant_created` ON `actions` (`encounter_id`,`participant_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_chat_messages_encounter_handout_created` ON `chat_messages` (`encounter_id`,`handout_id`,`created_at`,`id`) WHERE "chat_messages"."handout_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_effects_encounter_token_type` ON `effects` (`encounter_id`,`token_id`,`effect_type`);--> statement-breakpoint
PRAGMA optimize;
