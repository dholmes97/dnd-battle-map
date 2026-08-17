ALTER TABLE `tokens` ADD `armor_class` integer;--> statement-breakpoint
UPDATE `tokens`
SET `armor_class` = (
  SELECT `creature_catalog`.`armor_class`
  FROM `creature_catalog`
  WHERE `creature_catalog`.`token_asset` = `tokens`.`art_asset`
  LIMIT 1
)
WHERE `armor_class` IS NULL
  AND EXISTS (
    SELECT 1
    FROM `creature_catalog`
    WHERE `creature_catalog`.`token_asset` = `tokens`.`art_asset`
  );
