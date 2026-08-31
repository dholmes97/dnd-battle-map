UPDATE `identities`
SET `can_use_qa_sessions` = 1, `updated_at` = 1788214010960
WHERE `id` IN ('identity-dan', 'identity-barry', 'identity-scott', 'identity-kevin');--> statement-breakpoint

INSERT OR IGNORE INTO `app_maintenance` (`id`, `completed_at`)
VALUES ('all-trusted-humans-interaction-qa-v1', 1788214010960);
