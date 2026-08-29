INSERT OR IGNORE INTO `map_images`
  (`id`, `name`, `description`, `biome`, `mood`, `asset_path`, `grid_width`, `grid_height`,
   `pixel_width`, `pixel_height`, `source_kind`, `source_prompt`, `is_active`, `created_at`, `updated_at`)
VALUES
  ('qa-forest-hollow-v1', 'QA Forest Hollow', 'A compact old-growth forest hollow with open mossy ground, natural cover around the rim, and subtle trails to the east and west.', 'forest', 'daylight', '/map-assets/qa-forest-hollow-01.jpg', 16, 12, 2048, 1536, 'built-in', NULL, 1, 1787964300000, 1787964300000);--> statement-breakpoint

UPDATE `encounters`
SET `active_map_image_id` = 'qa-forest-hollow-v1',
    `active_map_setup_json` = '{"format":"dnd-map-setup","version":1,"walls":[],"portals":[],"labels":[],"notes":[],"fog":{"mode":"off","sharedPolygon":[{"x":0,"y":0},{"x":8,"y":0},{"x":16,"y":0},{"x":16,"y":6},{"x":16,"y":12},{"x":8,"y":12},{"x":0,"y":12},{"x":0,"y":6}],"walls":[],"doors":[],"circles":[]}}',
    `draft_map_image_id` = 'qa-forest-hollow-v1',
    `draft_map_setup_json` = '{"format":"dnd-map-setup","version":1,"walls":[],"portals":[],"labels":[],"notes":[],"fog":{"mode":"off","sharedPolygon":[{"x":0,"y":0},{"x":8,"y":0},{"x":16,"y":0},{"x":16,"y":6},{"x":16,"y":12},{"x":8,"y":12},{"x":0,"y":12},{"x":0,"y":6}],"walls":[],"doors":[],"circles":[]}}',
    `draft_updated_at` = 1787964300000,
    `grid_width` = 16,
    `grid_height` = 12,
    `map_asset` = '',
    `map_package_json` = NULL,
    `version` = `version` + 1,
    `updated_at` = 1787964300000
WHERE `id` = 'encounter-combat-rolling-qa';--> statement-breakpoint

INSERT OR IGNORE INTO `app_maintenance` (`id`, `completed_at`)
VALUES ('qa-forest-hollow-v1', 1787964300000);
