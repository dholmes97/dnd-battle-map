import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

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
  assert.equal(await query(database, "SELECT COUNT(*) FROM creature_catalog;"), "17");
  assert.equal(await query(database, "SELECT COUNT(*) FROM app_maintenance WHERE id = 'migration-only-schema-v1';"), "1");
  assert.equal(await query(database, "SELECT name FROM encounters WHERE code = 'EMBER-KEEP';"), "Swamp Battle");
  assert.deepEqual(
    (await query(database, "SELECT name FROM tokens ORDER BY name;")).split("\n"),
    ["Dar'eleth", "Jelton", "Malichar"],
  );
});

test("bootstrap migration preserves customized existing records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "battle-map-migration-upgrade-"));
  const database = join(directory, "existing.sqlite3");
  const migrations = await migrationFiles();

  for (const migration of migrations.slice(0, -1)) {
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
    VALUES ('custom-token', 'custom-encounter', 'Keep This Token', 3, 4, '/creature-assets/custom.png', 'monster', 'large', 45, 123, 150, 0, 0, 0, 987654321);
    INSERT INTO creature_catalog (id, name, family, creature_type, size, default_hp, armor_class, default_speed, walk_speed, source_asset, token_asset, thumbnail_asset, sort_order, is_active, created_at, updated_at)
    VALUES ('cave-bat', 'Customized Bat', 'custom', 'beast', 'tiny', 99, 21, 55, 55, '/custom/source.png', '/custom/token.png', '/custom/thumb.png', 999, 0, 1, 2);
  `);

  const before = await query(database, `
    SELECT name || '|' || version || '|' || status || '|' || map_package_json || '|' || updated_at FROM encounters WHERE id = 'custom-encounter';
    SELECT name || '|' || x || '|' || y || '|' || hp || '|' || max_hp || '|' || updated_at FROM tokens WHERE id = 'custom-token';
    SELECT name || '|' || family || '|' || default_hp || '|' || armor_class || '|' || is_active || '|' || updated_at FROM creature_catalog WHERE id = 'cave-bat';
  `);
  await sqlite(database, await readFile(new URL(migrations.at(-1), migrationDirectory), "utf8"));
  const after = await query(database, `
    SELECT name || '|' || version || '|' || status || '|' || map_package_json || '|' || updated_at FROM encounters WHERE id = 'custom-encounter';
    SELECT name || '|' || x || '|' || y || '|' || hp || '|' || max_hp || '|' || updated_at FROM tokens WHERE id = 'custom-token';
    SELECT name || '|' || family || '|' || default_hp || '|' || armor_class || '|' || is_active || '|' || updated_at FROM creature_catalog WHERE id = 'cave-bat';
  `);

  assert.equal(after, before);
  assert.equal(await query(database, "SELECT COUNT(*) FROM encounters;"), "2");
  assert.equal(await query(database, "SELECT COUNT(*) FROM tokens;"), "4");
  assert.equal(await query(database, "SELECT COUNT(*) FROM creature_catalog;"), "17");
  assert.equal(await query(database, "PRAGMA integrity_check;"), "ok");
});

test("the Worker only performs a read-only migration readiness check", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const block = worker.match(/const REQUIRED_SCHEMA_MIGRATION[\s\S]+?async function handleCreatureCatalog/)?.[0] ?? "";
  assert.match(block, /SELECT 1 AS ready FROM app_maintenance/);
  assert.match(block, /migration-only-schema-v1/);
  assert.doesNotMatch(block, /CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE INDEX|DELETE FROM|UPDATE |INSERT INTO|\.run\(|\.batch\(/);
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
