ALTER TABLE `combat_rolls` ADD `damage_rolled_at` integer;--> statement-breakpoint
UPDATE `combat_rolls`
SET `damage_rolled_at` = `created_at`
WHERE EXISTS (
  SELECT 1 FROM `damage_proposals`
  WHERE `damage_proposals`.`roll_id` = `combat_rolls`.`id`
);
