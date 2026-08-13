import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CREATURE_CATALOG_SEED, CHARACTER_ART_ASSETS } from "../shared/creature-library.ts";
import { FULL_SCENE_MAPS, createFullSceneMap } from "../shared/full-scene-maps.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = join(projectRoot, "drizzle", "0017_blushing_moondragon.sql");
const defaultScene = { ...createFullSceneMap(FULL_SCENE_MAPS[0]), createdAt: 0 };
const now = "CAST(strftime('%s', 'now') AS INTEGER) * 1000";
const statements = [
  `CREATE TABLE IF NOT EXISTS \`app_maintenance\` (\`id\` text PRIMARY KEY NOT NULL, \`completed_at\` integer NOT NULL)`,
  `INSERT OR IGNORE INTO \`encounters\` (\`id\`, \`code\`, \`name\`, \`version\`, \`status\`, \`map_asset\`, \`map_package_json\`, \`active_map_preset_id\`, \`grid_width\`, \`grid_height\`, \`current_round\`, \`active_initiative_order\`, \`strict_movement\`, \`updated_at\`) VALUES ('encounter-ember-keep', 'EMBER-KEEP', 'Swamp Battle', 1, 'setup', '', ${sql(JSON.stringify(defaultScene))}, NULL, ${defaultScene.width}, ${defaultScene.height}, 0, NULL, 1, ${now})`,
  `INSERT OR IGNORE INTO \`tokens\` (\`id\`, \`encounter_id\`, \`name\`, \`x\`, \`y\`, \`art_asset\`, \`kind\`, \`size\`, \`speed\`, \`hp\`, \`max_hp\`, \`is_hidden\`, \`summoner_token_id\`, \`initiative\`, \`initiative_group_id\`, \`initiative_order\`, \`turn_complete\`, \`movement_used\`, \`movement_origin_x\`, \`movement_origin_y\`, \`owner_participant_id\`, \`owner_name\`, \`updated_at\`) VALUES ('token-bronze-warden', 'encounter-ember-keep', 'Dar''eleth', 7, 5, ${sql(CHARACTER_ART_ASSETS[0])}, 'character', 'medium', 30, NULL, NULL, 0, NULL, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, NULL, ${now}), ('token-ember-scout', 'encounter-ember-keep', 'Malichar', 5.5, 3.5, ${sql(CHARACTER_ART_ASSETS[1])}, 'character', 'medium', 30, NULL, NULL, 0, NULL, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, NULL, ${now}), ('token-ash-mystic', 'encounter-ember-keep', 'Jelton', 10.5, 7.5, ${sql(CHARACTER_ART_ASSETS[2])}, 'character', 'medium', 30, NULL, NULL, 0, NULL, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, NULL, ${now})`,
];

for (let offset = 0; offset < CREATURE_CATALOG_SEED.length; offset += 10) {
  const values = CREATURE_CATALOG_SEED.slice(offset, offset + 10).map((creature) => `(${[
    creature.id, creature.name, creature.family, creature.creatureType, creature.size,
    creature.defaultHp, creature.hitDice, creature.armorClass, creature.challengeRating,
    creature.defaultSpeed, creature.speeds.walk, creature.speeds.fly, creature.speeds.swim,
    creature.speeds.climb, creature.speeds.burrow, creature.sourceAsset, creature.artAsset,
    creature.thumbnailAsset, creature.sortOrder,
  ].map(sql).join(", ")}, 1, ${now}, ${now})`).join(",\n");
  statements.push(`INSERT OR IGNORE INTO \`creature_catalog\` (\`id\`, \`name\`, \`family\`, \`creature_type\`, \`size\`, \`default_hp\`, \`hit_dice\`, \`armor_class\`, \`challenge_rating\`, \`default_speed\`, \`walk_speed\`, \`fly_speed\`, \`swim_speed\`, \`climb_speed\`, \`burrow_speed\`, \`source_asset\`, \`token_asset\`, \`thumbnail_asset\`, \`sort_order\`, \`is_active\`, \`created_at\`, \`updated_at\`) VALUES\n${values}`);
}

for (let offset = 0; offset < CREATURE_CATALOG_SEED.length; offset += 20) {
  const creatures = CREATURE_CATALOG_SEED.slice(offset, offset + 20);
  const cases = creatures.map((creature) => `WHEN ${sql(creature.sourceAsset)} THEN ${sql(creature.artAsset)}`).join(" ");
  statements.push(`UPDATE \`tokens\` SET \`art_asset\` = CASE \`art_asset\` ${cases} ELSE \`art_asset\` END WHERE \`art_asset\` IN (${creatures.map((creature) => sql(creature.sourceAsset)).join(", ")})`);
}

statements.push(
  `UPDATE \`tokens\` SET \`hp\` = (SELECT \`default_hp\` FROM \`creature_catalog\` WHERE \`token_asset\` = \`tokens\`.\`art_asset\` AND \`is_active\` = 1 LIMIT 1), \`max_hp\` = (SELECT \`default_hp\` FROM \`creature_catalog\` WHERE \`token_asset\` = \`tokens\`.\`art_asset\` AND \`is_active\` = 1 LIMIT 1), \`updated_at\` = ${now} WHERE \`kind\` = 'monster' AND \`hp\` IS NULL AND \`max_hp\` IS NULL AND EXISTS (SELECT 1 FROM \`creature_catalog\` WHERE \`token_asset\` = \`tokens\`.\`art_asset\` AND \`is_active\` = 1)`,
  `UPDATE \`encounters\` SET \`map_package_json\` = ${sql(JSON.stringify(defaultScene))}, \`active_map_preset_id\` = NULL, \`map_asset\` = '', \`grid_width\` = ${defaultScene.width}, \`grid_height\` = ${defaultScene.height}, \`version\` = \`version\` + 1, \`updated_at\` = ${now} WHERE \`map_package_json\` IS NULL OR instr(\`map_package_json\`, '"visual"') = 0`,
  `DELETE FROM \`map_presets\` WHERE instr(\`package_json\`, '"visual"') = 0`,
  `UPDATE \`encounters\` SET \`map_package_json\` = json_remove(json_remove(\`map_package_json\`, '$.sceneObjects'), '$.visual.sceneKitId'), \`version\` = \`version\` + 1, \`updated_at\` = ${now} WHERE \`map_package_json\` IS NOT NULL AND json_valid(\`map_package_json\`) = 1 AND (json_type(\`map_package_json\`, '$.sceneObjects') IS NOT NULL OR json_type(\`map_package_json\`, '$.visual.sceneKitId') IS NOT NULL)`,
  `UPDATE \`map_presets\` SET \`package_json\` = json_remove(json_remove(\`package_json\`, '$.sceneObjects'), '$.visual.sceneKitId') WHERE json_valid(\`package_json\`) = 1 AND (json_type(\`package_json\`, '$.sceneObjects') IS NOT NULL OR json_type(\`package_json\`, '$.visual.sceneKitId') IS NOT NULL)`,
  `INSERT OR IGNORE INTO \`app_maintenance\` (\`id\`, \`completed_at\`) VALUES ('migration-only-schema-v1', ${now})`,
);

await writeFile(migrationPath, `${statements.join(";--> statement-breakpoint\n")}\n`, "utf8");
console.log(`Generated ${migrationPath} with ${statements.length} statements and ${CREATURE_CATALOG_SEED.length} catalog seeds.`);

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}
