UPDATE `encounters`
SET `name` = 'Swamp Battle',
    `version` = `version` + 1,
    `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE `code` = 'EMBER-KEEP'
  AND `name` = 'The Ember Keep';
