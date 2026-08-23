import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  MAX_ACTIONS_PER_ENCOUNTER,
  MAX_ANNOTATIONS_PER_ENCOUNTER,
  MAX_CHAT_MESSAGES_PER_ENCOUNTER,
  MAX_CATALOG_ENTRIES,
  MAX_EFFECTS_PER_ENCOUNTER,
  MAX_EFFECTS_PER_TOKEN,
  MAX_HANDOUT_ROWS_PER_ENCOUNTER,
  MAX_MAP_PRESETS_PER_ENCOUNTER,
  MAX_PARTICIPANTS_PER_ENCOUNTER,
  MAX_SCENARIOS,
  MAX_TOKENS_PER_ENCOUNTER,
} from "../shared/resource-limits.ts";
import { HANDOUT_MAX_PER_SCENARIO } from "../shared/handout-domain.ts";
import { SCENARIO_PROVISIONING_MAX_JOBS_PER_HOUR } from "../shared/scenario-provisioning.ts";

const projectRoot = new URL("../", import.meta.url);
const migrationDirectory = new URL("../drizzle/", import.meta.url);

test("numbered migrations build and seed a fresh database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "battle-map-migrations-"));
  const database = join(directory, "fresh.sqlite3");

  for (const migration of await migrationFiles()) {
    await sqlite(database, await readFile(new URL(migration, migrationDirectory), "utf8"));
  }

  assert.equal(await query(database, "PRAGMA integrity_check;"), "ok");
  assert.equal(await query(database, "SELECT COUNT(*) FROM encounters;"), "1");
  assert.equal(await query(database, "SELECT COUNT(*) FROM tokens;"), "3");
  assert.equal(await query(database, "SELECT COUNT(*) FROM pragma_table_info('tokens') WHERE name = 'armor_class';"), "1");
  assert.equal(await query(database, "SELECT COUNT(*) FROM pragma_table_info('tokens') WHERE name = 'altitude';"), "1");
  assert.equal(await query(database, "SELECT COUNT(*) FROM pragma_table_info('tokens') WHERE name IN ('fly_speed', 'swim_speed', 'climb_speed', 'burrow_speed');"), "4");
  assert.equal(await query(database, "SELECT COUNT(*) FROM creature_catalog;"), "17");
  assert.equal(await query(database, "SELECT COUNT(*) FROM scenario_provisioning_jobs;"), "0");
  assert.equal(await query(database, "SELECT COUNT(*) FROM scenario_provisioning_assets;"), "0");
  assert.equal(await query(database, "SELECT COUNT(*) FROM scenario_provisioning_mail_replies;"), "0");
  assert.equal(await query(database, "SELECT COUNT(*) FROM scenario_provisioning_mail_messages;"), "0");
  assert.equal(await query(database, "SELECT dm_briefing FROM encounters WHERE code = 'EMBER-KEEP';"), "");
  assert.equal(await query(database, "SELECT COUNT(*) FROM app_maintenance WHERE id = 'migration-only-schema-v1';"), "1");
  assert.equal(await query(database, "SELECT COUNT(*) FROM app_maintenance WHERE id = 'scenario-provisioning-v1';"), "1");
  assert.equal(await query(database, "SELECT COUNT(*) FROM app_maintenance WHERE id = 'scenario-provisioning-revision-guard-v1';"), "1");
  assert.equal(await query(database, "SELECT COUNT(*) FROM app_maintenance WHERE id = 'scenario-mail-provenance-v1';"), "1");
  assert.equal(await query(database, "SELECT COUNT(*) FROM app_maintenance WHERE id = 'resource-guardrails-v1';"), "1");
  assert.equal(await query(database, "SELECT COUNT(*) FROM app_maintenance WHERE id = 'state-integrity-v1';"), "1");
  assert.equal(await query(database, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('request_rate_limits', 'operation_leases', 'mutation_assertions', 'storage_write_intents', 'storage_cleanup_outbox');"), "5");
  assert.equal(await query(database, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'limit_%';"), "12");
  assert.match(
    await query(database, "EXPLAIN QUERY PLAN SELECT * FROM scenario_provisioning_mail_messages WHERE mailbox_key = 'primary' AND provider_message_id = 'message-1';"),
    /USING INDEX idx_scenario_provisioning_mail_messages_mailbox_message/,
  );
  assert.match(
    await query(database, "EXPLAIN QUERY PLAN SELECT * FROM scenario_provisioning_mail_replies WHERE job_id = 'job-1' AND reply_kind = 'ready';"),
    /USING INDEX idx_scenario_provisioning_mail_replies_job_kind/,
  );
  assert.match(
    await query(database, "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM scenario_provisioning_jobs WHERE created_at >= 1800000000000 - 3600000;"),
    /USING COVERING INDEX idx_scenario_provisioning_jobs_created/,
  );
  assert.match(
    await query(database, "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM effects WHERE encounter_id = 'encounter' AND token_id = 'token' AND effect_type = 'concentration';"),
    /USING COVERING INDEX idx_effects_encounter_token_type/,
  );
  assert.match(
    await query(database, "EXPLAIN QUERY PLAN SELECT sender_name FROM chat_messages WHERE encounter_id = 'encounter' AND handout_id = 'handout' ORDER BY created_at DESC LIMIT 1;"),
    /USING INDEX idx_chat_messages_encounter_handout_created/,
  );
  assert.match(
    await query(database, "EXPLAIN QUERY PLAN SELECT id FROM actions WHERE encounter_id = 'encounter' AND participant_id = 'participant' ORDER BY created_at DESC, id DESC LIMIT 200;"),
    /USING COVERING INDEX idx_actions_encounter_participant_created/,
  );
  assert.equal(await query(database, "SELECT name FROM encounters WHERE code = 'EMBER-KEEP';"), "Swamp Battle");
  assert.deepEqual(
    (await query(database, "SELECT name FROM tokens ORDER BY name;")).split("\n"),
    ["Dar'eleth", "Jelton", "Malichar"],
  );
  await sqlite(database, `
    WITH RECURSIVE sequence(value) AS (
      SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 500
    )
    INSERT INTO annotations
      (id, encounter_id, annotation_type, x, y, x2, y2, color, label, created_by, expires_at, created_at)
    SELECT 'guardrail-' || value, (SELECT id FROM encounters LIMIT 1), 'drawing', 1, 1, 2, 2,
           '#fff', NULL, 'test', NULL, value FROM sequence;
  `);
  assert.equal(await query(database, "SELECT COUNT(*) FROM annotations WHERE id LIKE 'guardrail-%';"), "500");
  await assert.rejects(sqlite(database, `
    INSERT INTO annotations
      (id, encounter_id, annotation_type, x, y, x2, y2, color, label, created_by, expires_at, created_at)
    VALUES ('guardrail-overflow', (SELECT id FROM encounters LIMIT 1), 'drawing', 1, 1, 2, 2,
            '#fff', NULL, 'test', NULL, 501);
  `), /resource_limit:annotations/);
  await sqlite(database, `
    WITH RECURSIVE sequence(value) AS (
      SELECT 18 UNION ALL SELECT value + 1 FROM sequence WHERE value < 2000
    )
    INSERT INTO creature_catalog
      (id, name, family, creature_type, size, default_hp, armor_class, default_speed,
       walk_speed, source_asset, token_asset, thumbnail_asset, sort_order, is_active, created_at, updated_at)
    SELECT 'guardrail-creature-' || value, 'Guardrail creature ' || value, 'test', 'beast',
           'medium', 10, 10, 30, 30, 'source-' || value, 'token-' || value,
           'thumbnail-' || value, value, 1, value, value
    FROM sequence;
  `);
  assert.equal(await query(database, "SELECT COUNT(*) FROM creature_catalog;"), "2000");
  await assert.rejects(sqlite(database, `
    INSERT INTO creature_catalog
      (id, name, family, creature_type, size, default_hp, armor_class, default_speed,
       walk_speed, source_asset, token_asset, thumbnail_asset, sort_order, is_active, created_at, updated_at)
    VALUES ('guardrail-catalog-overflow', 'Overflow', 'test', 'beast', 'medium', 10, 10,
            30, 30, 'source-overflow', 'token-overflow', 'thumbnail-overflow', 2001, 1, 2001, 2001);
  `), /resource_limit:creature_catalog/);
  await sqlite(database, `
    INSERT INTO creature_catalog
      (id, name, family, creature_type, size, default_hp, armor_class, default_speed,
       walk_speed, source_asset, token_asset, thumbnail_asset, sort_order, is_active, created_at, updated_at)
    VALUES ('guardrail-creature-18', 'Updated at capacity', 'test', 'beast', 'medium', 10, 10,
            30, 30, 'source-18', 'token-18', 'thumbnail-18', 18, 1, 18, 2002)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at;
  `);
  assert.equal(await query(database, "SELECT name FROM creature_catalog WHERE id = 'guardrail-creature-18';"), "Updated at capacity");
});

test("bootstrap migration preserves customized existing records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "battle-map-migration-upgrade-"));
  const database = join(directory, "existing.sqlite3");
  const migrations = await migrationFiles();
  const bootstrapIndex = migrations.findIndex((migration) => migration.startsWith("0017_"));

  assert.notEqual(bootstrapIndex, -1);
  for (const migration of migrations.slice(0, bootstrapIndex)) {
    await sqlite(database, await readFile(new URL(migration, migrationDirectory), "utf8"));
  }

  const customMap = JSON.stringify({
    format: "dnd-battle-map",
    version: 1,
    id: "custom-map",
    name: "Custom map",
    width: 24,
    height: 16,
    walls: [],
    portals: [],
    labels: [],
    notes: [],
    visual: { kind: "generated-scene", assetUrl: "/map-assets/custom.jpg", pixelWidth: 3072, pixelHeight: 2048 },
    source: { kind: "generated-scene" },
    createdAt: 123,
  });
  await sqlite(database, `
    INSERT INTO encounters (id, code, name, version, status, map_asset, map_package_json, grid_width, grid_height, current_round, strict_movement, updated_at)
    VALUES ('custom-encounter', 'CUSTOM', 'Keep This Scenario', 42, 'active', '', '${customMap.replaceAll("'", "''")}', 24, 16, 7, 0, 987654321);
    INSERT INTO tokens (id, encounter_id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden, turn_complete, movement_used, updated_at)
    VALUES ('custom-token', 'custom-encounter', 'Keep This Token', 3, 4, '/custom/token.png', 'monster', 'large', 45, 123, 150, 0, 0, 0, 987654321);
    INSERT INTO creature_catalog (id, name, family, creature_type, size, default_hp, armor_class, default_speed, walk_speed, source_asset, token_asset, thumbnail_asset, sort_order, is_active, created_at, updated_at)
    VALUES ('cave-bat', 'Customized Bat', 'custom', 'beast', 'tiny', 99, 21, 55, 55, '/custom/source.png', '/custom/token.png', '/custom/thumb.png', 999, 0, 1, 2);
  `);

  const before = await query(database, `
    SELECT name || '|' || version || '|' || status || '|' || map_package_json || '|' || updated_at FROM encounters WHERE id = 'custom-encounter';
    SELECT name || '|' || x || '|' || y || '|' || hp || '|' || max_hp || '|' || updated_at FROM tokens WHERE id = 'custom-token';
    SELECT name || '|' || family || '|' || default_hp || '|' || armor_class || '|' || is_active || '|' || updated_at FROM creature_catalog WHERE id = 'cave-bat';
  `);
  for (const migration of migrations.slice(bootstrapIndex)) {
    await sqlite(database, await readFile(new URL(migration, migrationDirectory), "utf8"));
  }
  const after = await query(database, `
    SELECT name || '|' || version || '|' || status || '|' || map_package_json || '|' || updated_at FROM encounters WHERE id = 'custom-encounter';
    SELECT name || '|' || x || '|' || y || '|' || hp || '|' || max_hp || '|' || updated_at FROM tokens WHERE id = 'custom-token';
    SELECT name || '|' || family || '|' || default_hp || '|' || armor_class || '|' || is_active || '|' || updated_at FROM creature_catalog WHERE id = 'cave-bat';
  `);

  assert.equal(after, before);
  assert.equal(await query(database, "SELECT COUNT(*) FROM encounters;"), "2");
  assert.equal(await query(database, "SELECT COUNT(*) FROM tokens;"), "4");
  assert.equal(await query(database, "SELECT COUNT(*) FROM creature_catalog;"), "17");
  assert.equal(await query(database, "SELECT armor_class FROM tokens WHERE id = 'custom-token';"), "21");
  assert.equal(await query(database, "SELECT dm_briefing FROM encounters WHERE id = 'custom-encounter';"), "");
  assert.equal(await query(database, "PRAGMA integrity_check;"), "ok");
});

test("large-map migration upgrades only visual metadata and preserves prepared geometry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "battle-map-large-map-upgrade-"));
  const database = join(directory, "existing.sqlite3");
  const migrations = await migrationFiles();
  const largeMapIndex = migrations.findIndex((migration) => migration.startsWith("0018_"));

  assert.notEqual(largeMapIndex, -1);
  for (const migration of migrations.slice(0, largeMapIndex)) {
    await sqlite(database, await readFile(new URL(migration, migrationDirectory), "utf8"));
  }

  const legacyMap = JSON.stringify({
    format: "dnd-battle-map",
    version: 1,
    id: "cliffside-switchbacks-v1",
    name: "Cliffside Switchbacks",
    description: "Prepared large map",
    biome: "tundra",
    mood: "daylight",
    seed: "CLIFFSIDE-SWITCHBACKS-V1",
    width: 45,
    height: 30,
    walls: [],
    portals: [],
    labels: [{ id: "label-1", x: 11, y: 7, text: "Upper trail", visibility: "everyone" }],
    notes: [{ id: "note-1", x: 27, y: 19, text: "Loose rocks" }],
    fog: {
      mode: "dynamic",
      sharedPolygon: [{ x: 0, y: 0 }, { x: 45, y: 0 }, { x: 45, y: 30 }, { x: 0, y: 30 }],
      walls: [{ id: "wall-1", x1: 1.25, y1: 2.5, x2: 14.75, y2: 9.5 }],
      doors: [{ id: "door-1", x1: 14.75, y1: 9.5, x2: 16, y2: 10.25, open: false }],
      circles: [{ id: "circle-1", x: 31.5, y: 22.25, radius: 1.75 }],
    },
    visual: { kind: "generated-scene", assetUrl: "/map-assets/cliffside-switchbacks-01.jpg", pixelWidth: 3072, pixelHeight: 2048 },
    source: { kind: "generated-scene" },
    createdAt: 123,
  });
  const escaped = legacyMap.replaceAll("'", "''");
  await sqlite(database, `
    INSERT INTO encounters (id, code, name, version, status, map_asset, map_package_json, grid_width, grid_height, current_round, strict_movement, updated_at)
    VALUES ('large-encounter', 'LARGE', 'Large Scenario', 9, 'setup', '', '${escaped}', 45, 30, 0, 0, 123);
    INSERT INTO map_presets (id, encounter_id, name, description, source_prompt, package_json, created_by, created_at, updated_at)
    VALUES ('large-preset', 'large-encounter', 'Prepared Switchbacks', '', NULL, '${escaped}', 'participant-1', 123, 123);
  `);

  await sqlite(database, await readFile(new URL(migrations[largeMapIndex], migrationDirectory), "utf8"));
  const encounterMap = JSON.parse(await query(database, "SELECT map_package_json FROM encounters WHERE id = 'large-encounter';"));
  const presetMap = JSON.parse(await query(database, "SELECT package_json FROM map_presets WHERE id = 'large-preset';"));

  for (const map of [encounterMap, presetMap]) {
    assert.equal(map.id, "cliffside-switchbacks-v2");
    assert.equal(map.seed, "CLIFFSIDE-SWITCHBACKS-V2");
    assert.equal(map.visual.assetUrl, "/map-assets/cliffside-switchbacks-02.jpg");
    assert.equal(map.visual.pixelWidth, 5760);
    assert.equal(map.visual.pixelHeight, 3840);
    assert.deepEqual(map.fog, JSON.parse(legacyMap).fog);
    assert.deepEqual(map.labels, JSON.parse(legacyMap).labels);
    assert.deepEqual(map.notes, JSON.parse(legacyMap).notes);
  }
  assert.equal(await query(database, "SELECT version FROM encounters WHERE id = 'large-encounter';"), "10");
  for (const migration of migrations.slice(largeMapIndex + 1)) {
    await sqlite(database, await readFile(new URL(migration, migrationDirectory), "utf8"));
  }
  assert.equal(await query(database, "SELECT dm_briefing FROM encounters WHERE id = 'large-encounter';"), "");
  assert.equal(await query(database, "PRAGMA integrity_check;"), "ok");
});

test("the Worker only performs a read-only migration readiness check", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const block = worker.match(/const REQUIRED_SCHEMA_MIGRATION[\s\S]+?async function handleCreatureCatalog/)?.[0] ?? "";
  assert.match(block, /SELECT 1 AS ready FROM app_maintenance/);
  assert.match(block, /state-integrity-v1/);
  assert.doesNotMatch(block, /CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE INDEX|DELETE FROM|UPDATE |INSERT INTO|\.run\(|\.batch\(/);
});

test("resource-limit migration constants stay aligned with application policies", async () => {
  const migration = await readFile(new URL("../drizzle/0025_resource_guardrails.sql", import.meta.url), "utf8");
  for (const [table, limit] of [
    ["encounters", MAX_SCENARIOS],
    ["participants", MAX_PARTICIPANTS_PER_ENCOUNTER],
    ["tokens", MAX_TOKENS_PER_ENCOUNTER],
    ["annotations", MAX_ANNOTATIONS_PER_ENCOUNTER],
    ["map_presets", MAX_MAP_PRESETS_PER_ENCOUNTER],
    ["handouts", MAX_HANDOUT_ROWS_PER_ENCOUNTER],
    ["chat_messages", MAX_CHAT_MESSAGES_PER_ENCOUNTER],
    ["actions", MAX_ACTIONS_PER_ENCOUNTER],
  ]) {
    assert.match(migration, new RegExp("FROM `" + table + "`[^;]+>= " + limit));
  }
  assert.match(migration, new RegExp("FROM `effects` WHERE `encounter_id` = NEW\\.`encounter_id`\\) >= " + MAX_EFFECTS_PER_ENCOUNTER));
  assert.match(migration, new RegExp("AND `token_id` = NEW\\.`token_id`\\) >= " + MAX_EFFECTS_PER_TOKEN));
  assert.match(migration, new RegExp("FROM `creature_catalog`\\) >= " + MAX_CATALOG_ENTRIES));
});

test("state-integrity migration aligns atomic quotas and outbox schema", async () => {
  const migration = await readFile(new URL("../drizzle/0026_state_integrity_outbox.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE `mutation_assertions`/);
  assert.match(migration, /CREATE TABLE `storage_write_intents`/);
  assert.match(migration, /CREATE TABLE `storage_cleanup_outbox`/);
  assert.match(migration, /CREATE INDEX `idx_scenario_provisioning_jobs_created` ON `scenario_provisioning_jobs` \(`created_at`\)/);
  assert.match(migration, new RegExp("deleted_at` IS NULL[\\s\\S]+>= " + HANDOUT_MAX_PER_SCENARIO));
  assert.match(migration, new RegExp("scenario_provisioning_jobs[\\s\\S]+>= " + SCENARIO_PROVISIONING_MAX_JOBS_PER_HOUR));
});

test("Drizzle snapshots form a complete no-op generation baseline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "battle-map-drizzle-snapshots-"));
  const output = join(directory, "drizzle");
  await cp(migrationDirectory, output, { recursive: true });
  const expectedMigrations = (await readdir(output)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();

  await runProcess(process.execPath, [
    fileURLToPath(new URL("../node_modules/drizzle-kit/bin.cjs", import.meta.url)),
    "generate",
    "--schema",
    fileURLToPath(new URL("../db/schema.ts", import.meta.url)),
    "--out",
    "drizzle",
    "--dialect",
    "sqlite",
    "--name",
    "snapshot-probe",
  ], directory);

  const actualMigrations = (await readdir(output)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  assert.deepEqual(actualMigrations, expectedMigrations);
  const snapshots = await Promise.all([22, 23, 24, 25, 26].map(async (index) =>
    JSON.parse(await readFile(join(output, "meta", `${String(index).padStart(4, "0")}_snapshot.json`), "utf8"))
  ));
  for (let index = 1; index < snapshots.length; index += 1) {
    assert.equal(snapshots[index].prevId, snapshots[index - 1].id);
  }
});

async function migrationFiles() {
  return (await readdir(migrationDirectory, { encoding: "utf8" }))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

function sqlite(database, sql) {
  return runSqlite(database, [], sql).then(() => undefined);
}

function query(database, sql) {
  return runSqlite(database, ["-batch", "-noheader"], sql).then((value) => value.trim());
}

function runSqlite(database, arguments_, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("sqlite3", [...arguments_, database], {
      cwd: new URL(projectRoot),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(`sqlite3 failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    child.stdin.end(input);
  });
}

function runProcess(command, arguments_, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(`command failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
  });
}
