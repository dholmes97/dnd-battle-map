UPDATE `encounters`
SET `map_package_json` = json_set(
      `map_package_json`,
      '$.id',
      CASE json_extract(`map_package_json`, '$.visual.assetUrl')
        WHEN '/map-assets/cliffside-switchbacks-01.jpg' THEN 'cliffside-switchbacks-v2'
        WHEN '/map-assets/underwater-ruins-01.jpg' THEN 'underwater-ruins-v2'
      END,
      '$.seed',
      CASE json_extract(`map_package_json`, '$.visual.assetUrl')
        WHEN '/map-assets/cliffside-switchbacks-01.jpg' THEN 'CLIFFSIDE-SWITCHBACKS-V2'
        WHEN '/map-assets/underwater-ruins-01.jpg' THEN 'UNDERWATER-RUINS-V2'
      END,
      '$.visual.assetUrl',
      CASE json_extract(`map_package_json`, '$.visual.assetUrl')
        WHEN '/map-assets/cliffside-switchbacks-01.jpg' THEN '/map-assets/cliffside-switchbacks-02.jpg'
        WHEN '/map-assets/underwater-ruins-01.jpg' THEN '/map-assets/underwater-ruins-02.jpg'
      END,
      '$.visual.pixelWidth', 5760,
      '$.visual.pixelHeight', 3840
    ),
    `version` = `version` + 1,
    `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE `map_package_json` IS NOT NULL
  AND json_valid(`map_package_json`) = 1
  AND json_extract(`map_package_json`, '$.visual.assetUrl') IN (
    '/map-assets/cliffside-switchbacks-01.jpg',
    '/map-assets/underwater-ruins-01.jpg'
  );
--> statement-breakpoint
UPDATE `map_presets`
SET `package_json` = json_set(
      `package_json`,
      '$.id',
      CASE json_extract(`package_json`, '$.visual.assetUrl')
        WHEN '/map-assets/cliffside-switchbacks-01.jpg' THEN 'cliffside-switchbacks-v2'
        WHEN '/map-assets/underwater-ruins-01.jpg' THEN 'underwater-ruins-v2'
      END,
      '$.seed',
      CASE json_extract(`package_json`, '$.visual.assetUrl')
        WHEN '/map-assets/cliffside-switchbacks-01.jpg' THEN 'CLIFFSIDE-SWITCHBACKS-V2'
        WHEN '/map-assets/underwater-ruins-01.jpg' THEN 'UNDERWATER-RUINS-V2'
      END,
      '$.visual.assetUrl',
      CASE json_extract(`package_json`, '$.visual.assetUrl')
        WHEN '/map-assets/cliffside-switchbacks-01.jpg' THEN '/map-assets/cliffside-switchbacks-02.jpg'
        WHEN '/map-assets/underwater-ruins-01.jpg' THEN '/map-assets/underwater-ruins-02.jpg'
      END,
      '$.visual.pixelWidth', 5760,
      '$.visual.pixelHeight', 3840
    ),
    `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE json_valid(`package_json`) = 1
  AND json_extract(`package_json`, '$.visual.assetUrl') IN (
    '/map-assets/cliffside-switchbacks-01.jpg',
    '/map-assets/underwater-ruins-01.jpg'
  );
