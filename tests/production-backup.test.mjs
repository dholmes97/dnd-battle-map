import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const token = "test-production-backup-token-000001";
const objects = new Map([
  ["handouts/encounter-1/example/display.webp", Buffer.from("display bytes")],
  ["creature-catalog/original/tokens/catalog/owlbear.png", Buffer.from([0, 1, 2, 3, 4])],
]);

test("production backup command creates a verified immutable sibling snapshot", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("backup-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const tables = new Map([
    ["encounters", [{ id: "encounter-1", code: "TEST", name: "Test", version: 1, status: "setup", map_asset: "", map_package_json: null, active_map_preset_id: null, grid_width: 24, grid_height: 16, current_round: 0, active_initiative_order: null, strict_movement: 0, updated_at: 1 }]],
    ["app_maintenance", [{ id: "cleanup", completed_at: 1 }]],
  ]);
  const schema = [
    { type: "table", name: "encounters", tbl_name: "encounters", sql: "CREATE TABLE encounters (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, map_asset TEXT NOT NULL, map_package_json TEXT, active_map_preset_id TEXT, grid_width INTEGER NOT NULL, grid_height INTEGER NOT NULL, current_round INTEGER NOT NULL, active_initiative_order INTEGER, strict_movement INTEGER NOT NULL, updated_at INTEGER NOT NULL)" },
    { type: "table", name: "app_maintenance", tbl_name: "app_maintenance", sql: "CREATE TABLE app_maintenance (id TEXT PRIMARY KEY, completed_at INTEGER NOT NULL)" },
  ];
  const env = {
    PRODUCTION_BACKUP_TOKEN: token,
    DB: fakeD1(tables, schema),
    MAP_ASSETS: fakeR2(objects),
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const root = await mkdtemp(join(tmpdir(), "battle-map-backup-test-"));
  const originalFetch = globalThis.fetch;
  const originalEnvironment = {
    PRODUCTION_BACKUP_TOKEN: process.env.PRODUCTION_BACKUP_TOKEN,
    BATTLE_MAP_SITE_URL: process.env.BATTLE_MAP_SITE_URL,
    BATTLE_MAP_BACKUP_ROOT: process.env.BATTLE_MAP_BACKUP_ROOT,
  };
  try {
    process.env.PRODUCTION_BACKUP_TOKEN = token;
    process.env.BATTLE_MAP_SITE_URL = "http://localhost";
    process.env.BATTLE_MAP_BACKUP_ROOT = root;
    globalThis.fetch = (input, init) => worker.fetch(new Request(input, init), env, { waitUntil() {}, passThroughOnException() {} });
    const backupScript = new URL("../scripts/backup-production.mjs", import.meta.url);
    backupScript.searchParams.set("test", `${process.pid}-${Date.now()}`);
    await import(backupScript.href);
    const [backupName] = await readdir(root);
    const backup = join(root, backupName);
    const manifest = JSON.parse(await readFile(join(backup, "manifest.json"), "utf8"));
    assert.equal(manifest.d1.integrityCheck, "ok");
    assert.equal(manifest.d1.rowCount, 2);
    assert.equal(manifest.r2.objectCount, objects.size);
    assert.equal(manifest.r2.byteCount, [...objects.values()].reduce((sum, bytes) => sum + bytes.length, 0));
    await access(join(backup, "COMPLETE"));
    assert.equal((await stat(join(backup, "d1", "production.sqlite3"))).size > 0, true);
    for (const [key, bytes] of objects) assert.deepEqual(await readFile(join(backup, "r2", "objects", key)), bytes);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

function fakeD1(tables, schema) {
  return {
    prepare(sql) {
      const bindings = [];
      return {
        bind(...values) { bindings.push(...values); return this; },
        async first() {
          const countMatch = sql.match(/^SELECT COUNT\(\*\) AS count FROM "([a-z_]+)"$/);
          if (countMatch) return { count: tables.get(countMatch[1])?.length ?? 0 };
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async all() {
          if (/SELECT name, sql FROM sqlite_master WHERE type = 'table'/.test(sql)) {
            return { results: schema.filter((entry) => entry.type === "table").map((entry) => ({ name: entry.name, sql: entry.sql })) };
          }
          if (/SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master/.test(sql)) {
            return { results: schema.map((entry) => ({ type: entry.type, name: entry.name, tableName: entry.tbl_name, sql: entry.sql })) };
          }
          const rowMatch = sql.match(/^SELECT \* FROM "([a-z_]+)" ORDER BY rowid LIMIT \? OFFSET \?$/);
          if (rowMatch) return { results: (tables.get(rowMatch[1]) ?? []).slice(bindings[1], bindings[1] + bindings[0]) };
          throw new Error(`Unexpected all query: ${sql}`);
        },
      };
    },
  };
}

function fakeR2(entries) {
  return {
    async list({ cursor }) {
      if (cursor) return { objects: [], truncated: false };
      return {
        objects: [...entries].map(([key, bytes], index) => ({ key, size: bytes.length, httpEtag: `\"etag-${index}\"`, uploaded: new Date(1_700_000_000_000 + index), httpMetadata: { contentType: "application/octet-stream" } })),
        truncated: false,
      };
    },
    async get(key) {
      const bytes = entries.get(key);
      return bytes ? { body: bytes, httpEtag: "\"test\"", httpMetadata: { contentType: "application/octet-stream" } } : null;
    },
  };
}
