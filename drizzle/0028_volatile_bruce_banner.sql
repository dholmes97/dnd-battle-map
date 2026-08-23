CREATE TABLE `map_images` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`biome` text NOT NULL,
	`mood` text NOT NULL,
	`asset_path` text NOT NULL,
	`grid_width` integer NOT NULL,
	`grid_height` integer NOT NULL,
	`pixel_width` integer NOT NULL,
	`pixel_height` integer NOT NULL,
	`source_kind` text NOT NULL,
	`source_prompt` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_map_images_asset_path` ON `map_images` (`asset_path`);--> statement-breakpoint
CREATE INDEX `idx_map_images_active_name` ON `map_images` (`is_active`,`name`,`id`);--> statement-breakpoint
CREATE INDEX `idx_map_images_biome_mood` ON `map_images` (`biome`,`mood`);--> statement-breakpoint
ALTER TABLE `encounters` ADD `active_map_image_id` text REFERENCES map_images(id);--> statement-breakpoint
ALTER TABLE `encounters` ADD `active_map_setup_json` text;--> statement-breakpoint
ALTER TABLE `encounters` ADD `draft_map_image_id` text REFERENCES map_images(id);--> statement-breakpoint
ALTER TABLE `encounters` ADD `draft_map_setup_json` text;--> statement-breakpoint
ALTER TABLE `encounters` ADD `draft_updated_at` integer;--> statement-breakpoint

INSERT INTO `map_images`
  (`id`, `name`, `description`, `biome`, `mood`, `asset_path`, `grid_width`, `grid_height`,
   `pixel_width`, `pixel_height`, `source_kind`, `source_prompt`, `is_active`, `created_at`, `updated_at`)
VALUES
  ('grandfather-tree-roots-v1', 'Grandfather Tree Roots', 'The shaded base of the Grandfather Tree, where an immense curved trunk wall and branching, overlapping roots shape the entire battlefield.', 'forest', 'daylight', '/map-assets/grandfather-tree-roots-01.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0),
  ('ancient-forest-clearing-v2', 'Ancient Forest Crossing', 'An old-growth woodland crossing with a mossy ruin, pond, trails, and open tactical ground.', 'forest', 'daylight', '/map-assets/ancient-forest-clearing-02.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0),
  ('ruined-underground-temple-v2', 'Flooded Temple Ruin', 'A torchlit underground temple with side chambers, broken masonry, and a flooded lower edge.', 'dungeon', 'torchlight', '/map-assets/ruined-underground-temple-02.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0),
  ('storm-coast-ruins-v2', 'Storm Coast Ruins', 'A wave-battered island ruin with tide pools, a broken causeway, and multiple approach routes.', 'coast', 'overcast', '/map-assets/storm-coast-ruins-02.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0),
  ('moonlit-fey-glade-v1', 'Moonlit Fey Glade', 'An enchanted woodland spring with stepping stones, luminous mushrooms, ancient roots, and several winding approaches.', 'forest', 'moonlight', '/map-assets/moonlit-fey-glade-01.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0),
  ('crystal-cavern-crossing-v1', 'Crystal Cavern Crossing', 'A luminous subterranean river crossing with natural bridges, a shallow ford, crystal clusters, and mining remnants.', 'cave', 'torchlight', '/map-assets/crystal-cavern-crossing-01.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0),
  ('sunken-swamp-shrine-v1', 'Sunken Swamp Shrine', 'A flooded cypress shrine linked by muddy islands, plank walks, twisted roots, and shallow-water routes.', 'swamp', 'overcast', '/map-assets/sunken-swamp-shrine-01.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0),
  ('desert-caravanserai-ruin-v1', 'Desert Caravanserai', 'A wind-scoured sandstone waystation with a dry courtyard, ruined arcades, broken rooms, and dune approaches.', 'desert', 'daylight', '/map-assets/desert-caravanserai-ruin-01.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0),
  ('frozen-mountain-pass-v1', 'Frozen Mountain Pass', 'A snowy alpine crossing with an icy ravine, timber bridge, frozen ford, switchbacks, and a lonely watch shelter.', 'tundra', 'overcast', '/map-assets/frozen-mountain-pass-01.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0),
  ('volcanic-forge-caldera-v1', 'Volcanic Forge Caldera', 'An ancient basalt forge complex divided by lava channels, heavy bridges, broad stairs, and a central smelting dais.', 'volcanic', 'torchlight', '/map-assets/volcanic-forge-caldera-01.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0),
  ('abandoned-village-square-v1', 'Abandoned Village Square', 'A rain-darkened village crossroads with roofless cottages, a muddy market square, narrow alleys, and four roads.', 'ruins', 'overcast', '/map-assets/abandoned-village-square-01.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0),
  ('goblin-mineworks-v1', 'Goblin Mineworks', 'A torchlit mine stronghold with timber-braced passages, cart rails, loading platforms, pits, and flanking tunnels.', 'cave', 'torchlight', '/map-assets/goblin-mineworks-01.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0),
  ('river-gorge-bridge-v1', 'River Gorge Bridge', 'A forest river crossing with an old stone bridge, fallen-tree route, rocky banks, and ruined tollhouse cover.', 'forest', 'daylight', '/map-assets/river-gorge-bridge-01.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0),
  ('haunted-graveyard-chapel-v1', 'Haunted Graveyard Chapel', 'A moonlit cemetery surrounding a roofless chapel, crypts, broken walls, winding paths, and an open iron gate.', 'ruins', 'moonlight', '/map-assets/haunted-graveyard-chapel-01.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0),
  ('cliffside-switchbacks-v2', 'Cliffside Switchbacks', 'A long mountain descent with broad switchbacks, narrow ledges, rocky cover, and staging areas at the summit and valley floor.', 'tundra', 'daylight', '/map-assets/cliffside-switchbacks-02.jpg', 45, 30, 5760, 3840, 'built-in', NULL, 1, 0, 0),
  ('underwater-ruins-v2', 'Underwater Ruins', 'A submerged reef basin with sandy channels, coral ridges, ancient ruins, a broken shipwreck, rock arches, and deep trenches.', 'coast', 'daylight', '/map-assets/underwater-ruins-02.jpg', 45, 30, 5760, 3840, 'built-in', NULL, 1, 0, 0),
  ('ravenloft-grand-dining-hall-v1', 'Ravenloft Grand Dining Hall', 'A vast gothic banquet chamber with a laden satin-draped table, crystal chandeliers, mirrored walls, and a despairing pipe organ.', 'dungeon', 'torchlight', '/map-assets/ravenloft-grand-dining-hall-01.jpg', 24, 16, 3072, 2048, 'built-in', NULL, 1, 0, 0);--> statement-breakpoint

INSERT OR IGNORE INTO `map_images`
  (`id`, `name`, `description`, `biome`, `mood`, `asset_path`, `grid_width`, `grid_height`,
   `pixel_width`, `pixel_height`, `source_kind`, `source_prompt`, `is_active`, `created_at`, `updated_at`)
SELECT
  'encounter-' || `id`,
  COALESCE(json_extract(`map_package_json`, '$.name'), 'Recovered map'),
  COALESCE(json_extract(`map_package_json`, '$.description'), ''),
  CASE WHEN json_extract(`map_package_json`, '$.biome') IN ('forest','dungeon','cave','ruins','swamp','desert','tundra','volcanic','coast') THEN json_extract(`map_package_json`, '$.biome') ELSE 'forest' END,
  CASE WHEN json_extract(`map_package_json`, '$.mood') IN ('daylight','overcast','moonlight','torchlight') THEN json_extract(`map_package_json`, '$.mood') ELSE 'daylight' END,
  json_extract(`map_package_json`, '$.visual.assetUrl'),
  COALESCE(json_extract(`map_package_json`, '$.width'), `grid_width`),
  COALESCE(json_extract(`map_package_json`, '$.height'), `grid_height`),
  COALESCE(json_extract(`map_package_json`, '$.visual.pixelWidth'), COALESCE(json_extract(`map_package_json`, '$.width'), `grid_width`) * 128),
  COALESCE(json_extract(`map_package_json`, '$.visual.pixelHeight'), COALESCE(json_extract(`map_package_json`, '$.height'), `grid_height`) * 128),
  CASE WHEN json_extract(`map_package_json`, '$.source.kind') = 'imported' THEN 'imported' ELSE 'generated' END,
  NULL, 1, COALESCE(json_extract(`map_package_json`, '$.createdAt'), `updated_at`), `updated_at`
FROM `encounters`
WHERE `map_package_json` IS NOT NULL AND json_valid(`map_package_json`) = 1
  AND json_extract(`map_package_json`, '$.id') IS NOT NULL
  AND json_extract(`map_package_json`, '$.visual.assetUrl') IS NOT NULL;--> statement-breakpoint

INSERT OR IGNORE INTO `map_images`
  (`id`, `name`, `description`, `biome`, `mood`, `asset_path`, `grid_width`, `grid_height`,
   `pixel_width`, `pixel_height`, `source_kind`, `source_prompt`, `is_active`, `created_at`, `updated_at`)
SELECT
  'preset-' || `id`,
  COALESCE(json_extract(`package_json`, '$.name'), 'Recovered map'),
  COALESCE(json_extract(`package_json`, '$.description'), ''),
  CASE WHEN json_extract(`package_json`, '$.biome') IN ('forest','dungeon','cave','ruins','swamp','desert','tundra','volcanic','coast') THEN json_extract(`package_json`, '$.biome') ELSE 'forest' END,
  CASE WHEN json_extract(`package_json`, '$.mood') IN ('daylight','overcast','moonlight','torchlight') THEN json_extract(`package_json`, '$.mood') ELSE 'daylight' END,
  json_extract(`package_json`, '$.visual.assetUrl'),
  json_extract(`package_json`, '$.width'), json_extract(`package_json`, '$.height'),
  COALESCE(json_extract(`package_json`, '$.visual.pixelWidth'), json_extract(`package_json`, '$.width') * 128),
  COALESCE(json_extract(`package_json`, '$.visual.pixelHeight'), json_extract(`package_json`, '$.height') * 128),
  CASE WHEN json_extract(`package_json`, '$.source.kind') = 'imported' THEN 'imported' ELSE 'generated' END,
  `source_prompt`, 1, COALESCE(json_extract(`package_json`, '$.createdAt'), `created_at`), `updated_at`
FROM `map_presets`
WHERE json_valid(`package_json`) = 1
  AND json_extract(`package_json`, '$.id') IS NOT NULL
  AND json_extract(`package_json`, '$.visual.assetUrl') IS NOT NULL;--> statement-breakpoint

UPDATE `map_images`
SET `source_prompt` = (
  SELECT `map_presets`.`source_prompt`
  FROM `map_presets`
  WHERE `map_presets`.`source_prompt` IS NOT NULL
    AND json_valid(`map_presets`.`package_json`) = 1
    AND json_extract(`map_presets`.`package_json`, '$.visual.assetUrl') = `map_images`.`asset_path`
  ORDER BY `map_presets`.`updated_at` DESC, `map_presets`.`id` DESC LIMIT 1
)
WHERE `source_prompt` IS NULL
  AND EXISTS (
    SELECT 1 FROM `map_presets`
    WHERE `map_presets`.`source_prompt` IS NOT NULL
      AND json_valid(`map_presets`.`package_json`) = 1
      AND json_extract(`map_presets`.`package_json`, '$.visual.assetUrl') = `map_images`.`asset_path`
  );--> statement-breakpoint

UPDATE `encounters`
SET `active_map_image_id` = (
      SELECT `id` FROM `map_images`
      WHERE `asset_path` = json_extract(`encounters`.`map_package_json`, '$.visual.assetUrl') LIMIT 1
    ),
    `active_map_setup_json` = json_object(
      'format', 'dnd-map-setup', 'version', 1,
      'walls', json(CASE WHEN json_type(`map_package_json`, '$.walls') = 'array' THEN json_extract(`map_package_json`, '$.walls') ELSE '[]' END),
      'portals', json(CASE WHEN json_type(`map_package_json`, '$.portals') = 'array' THEN json_extract(`map_package_json`, '$.portals') ELSE '[]' END),
      'labels', json(CASE WHEN json_type(`map_package_json`, '$.labels') = 'array' THEN json_extract(`map_package_json`, '$.labels') ELSE '[]' END),
      'notes', json(CASE WHEN json_type(`map_package_json`, '$.notes') = 'array' THEN json_extract(`map_package_json`, '$.notes') ELSE '[]' END),
      'fog', json(CASE WHEN json_type(`map_package_json`, '$.fog') = 'object' THEN json_extract(`map_package_json`, '$.fog') ELSE json_object(
        'mode', 'off',
        'sharedPolygon', json_array(json_object('x',0,'y',0), json_object('x',`grid_width`,'y',0), json_object('x',`grid_width`,'y',`grid_height`), json_object('x',0,'y',`grid_height`)),
        'walls', json_array(), 'doors', json_array(), 'circles', json_array()
      ) END)
    )
WHERE `map_package_json` IS NOT NULL AND json_valid(`map_package_json`) = 1;--> statement-breakpoint

UPDATE `encounters`
SET `draft_map_image_id` = `active_map_image_id`,
    `draft_map_setup_json` = `active_map_setup_json`,
    `draft_updated_at` = `updated_at`
WHERE `active_map_image_id` IS NOT NULL;--> statement-breakpoint

UPDATE `encounters`
SET `draft_map_image_id` = (
      SELECT `map_images`.`id` FROM `map_presets`
      JOIN `map_images` ON `map_images`.`asset_path` = json_extract(`map_presets`.`package_json`, '$.visual.assetUrl')
      WHERE `map_presets`.`encounter_id` = `encounters`.`id`
      ORDER BY `map_presets`.`updated_at` DESC, `map_presets`.`id` DESC LIMIT 1
    ),
    `draft_map_setup_json` = (
      SELECT json_object(
        'format', 'dnd-map-setup', 'version', 1,
        'walls', json(CASE WHEN json_type(`package_json`, '$.walls') = 'array' THEN json_extract(`package_json`, '$.walls') ELSE '[]' END),
        'portals', json(CASE WHEN json_type(`package_json`, '$.portals') = 'array' THEN json_extract(`package_json`, '$.portals') ELSE '[]' END),
        'labels', json(CASE WHEN json_type(`package_json`, '$.labels') = 'array' THEN json_extract(`package_json`, '$.labels') ELSE '[]' END),
        'notes', json(CASE WHEN json_type(`package_json`, '$.notes') = 'array' THEN json_extract(`package_json`, '$.notes') ELSE '[]' END),
        'fog', json(CASE WHEN json_type(`package_json`, '$.fog') = 'object' THEN json_extract(`package_json`, '$.fog') ELSE json_object(
          'mode', 'off',
          'sharedPolygon', json_array(json_object('x',0,'y',0), json_object('x',json_extract(`package_json`,'$.width'),'y',0), json_object('x',json_extract(`package_json`,'$.width'),'y',json_extract(`package_json`,'$.height')), json_object('x',0,'y',json_extract(`package_json`,'$.height'))),
          'walls', json_array(), 'doors', json_array(), 'circles', json_array()
        ) END)
      )
      FROM `map_presets`
      WHERE `map_presets`.`encounter_id` = `encounters`.`id`
      ORDER BY `map_presets`.`updated_at` DESC, `map_presets`.`id` DESC LIMIT 1
    ),
    `draft_updated_at` = (
      SELECT `updated_at` FROM `map_presets`
      WHERE `map_presets`.`encounter_id` = `encounters`.`id`
      ORDER BY `updated_at` DESC, `id` DESC LIMIT 1
    )
WHERE EXISTS (SELECT 1 FROM `map_presets` WHERE `map_presets`.`encounter_id` = `encounters`.`id`);--> statement-breakpoint

CREATE TRIGGER `limit_map_images_insert`
BEFORE INSERT ON `map_images`
WHEN (SELECT COUNT(*) FROM `map_images`) >= 500
BEGIN
	SELECT RAISE(ABORT, 'resource_limit:map_images');
END;--> statement-breakpoint

INSERT OR IGNORE INTO `app_maintenance` (`id`, `completed_at`)
VALUES ('map-images-and-drafts-v1', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
