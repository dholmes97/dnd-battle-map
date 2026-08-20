ALTER TABLE `tokens` ADD `fly_speed` integer;
ALTER TABLE `tokens` ADD `swim_speed` integer;
ALTER TABLE `tokens` ADD `climb_speed` integer;
ALTER TABLE `tokens` ADD `burrow_speed` integer;

UPDATE `tokens`
SET `fly_speed` = (SELECT `fly_speed` FROM `creature_catalog` WHERE `token_asset` = `tokens`.`art_asset` LIMIT 1),
    `swim_speed` = (SELECT `swim_speed` FROM `creature_catalog` WHERE `token_asset` = `tokens`.`art_asset` LIMIT 1),
    `climb_speed` = (SELECT `climb_speed` FROM `creature_catalog` WHERE `token_asset` = `tokens`.`art_asset` LIMIT 1),
    `burrow_speed` = (SELECT `burrow_speed` FROM `creature_catalog` WHERE `token_asset` = `tokens`.`art_asset` LIMIT 1)
WHERE EXISTS (SELECT 1 FROM `creature_catalog` WHERE `token_asset` = `tokens`.`art_asset`);
