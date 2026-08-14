import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const token = "test-production-backup-token-000001";
const objects = new Map([
  ["handouts/encounter-1/example/display.webp", Buffer.from("display bytes")],
  ["creature-catalog/original/tokens/catalog/owlbear.png", Buffer.from([0, 1, 2, 3, 4])],
]);

test("production backup endpoints require the dedicated backup token", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("backup-auth-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const catalogToken = "test-catalog-import-token-00000001";
  const backupToken = "test-production-backup-token-000001";
  const request = (path, tokenValue) => new Request(`http://localhost/api/admin/production-backup/${path}`, {
    headers: { authorization: `Bearer ${tokenValue}` },
  });
  const context = { waitUntil() {}, passThroughOnException() {} };
  const assets = { fetch: async () => new Response("Not found", { status: 404 }) };
  const mapAssets = fakeR2(new Map());

  for (const path of ["d1", "r2", "r2/object?key=dGVzdA=="]) {
    const catalogOnlyResponse = await worker.fetch(request(path, catalogToken), {
      CATALOG_IMPORT_TOKEN: catalogToken,
      MAP_ASSETS: mapAssets,
      ASSETS: assets,
    }, context);
    assert.equal(catalogOnlyResponse.status, 401);
  }

  const wrongPrivilegeResponse = await worker.fetch(request("r2", catalogToken), {
    CATALOG_IMPORT_TOKEN: catalogToken,
    PRODUCTION_BACKUP_TOKEN: backupToken,
    MAP_ASSETS: mapAssets,
    ASSETS: assets,
  }, context);
  assert.equal(wrongPrivilegeResponse.status, 401);

  const backupResponse = await worker.fetch(request("r2", backupToken), {
    CATALOG_IMPORT_TOKEN: catalogToken,
    PRODUCTION_BACKUP_TOKEN: backupToken,
    MAP_ASSETS: mapAssets,
    ASSETS: assets,
  }, context);
  assert.equal(backupResponse.status, 200);
});

test("production backup command does not accept the catalog import token", async () => {
  const environment = {
    ...process.env,
    CATALOG_IMPORT_TOKEN: "test-catalog-import-token-00000001",
  };
  delete environment.PRODUCTION_BACKUP_TOKEN;
  const result = await runNodeScript(
    fileURLToPath(new URL("../scripts/backup-production.mjs", import.meta.url)),
    environment,
  );
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Set PRODUCTION_BACKUP_TOKEN to the production backup secret/);
  assert.doesNotMatch(result.stderr, /CATALOG_IMPORT_TOKEN/);
});

test("production backup command creates a verified immutable sibling snapshot", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("backup-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const tables = new Map([
    ["__appgarden_migrations", [{ id: 17, name: "0016_tiny_miek.sql" }]],
    ["encounters", [{ id: "encounter-1", code: "TEST", name: "Test", version: 1, status: "setup", map_asset: "", map_package_json: null, active_map_preset_id: null, grid_width: 24, grid_height: 16, current_round: 0, active_initiative_order: null, strict_movement: 0, updated_at: 1 }]],
    ["app_maintenance", [{ id: "cleanup", completed_at: 1 }]],
  ]);
  const schema = [
    { type: "table", name: "__appgarden_migrations", tbl_name: "__appgarden_migrations", sql: "CREATE TABLE __appgarden_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL)" },
    { type: "table", name: "encounters", tbl_name: "encounters", sql: "CREATE TABLE encounters (id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, map_asset TEXT NOT NULL, map_package_json TEXT, active_map_preset_id TEXT, grid_width INTEGER NOT NULL, grid_height INTEGER NOT NULL, current_round INTEGER NOT NULL, active_initiative_order INTEGER, strict_movement INTEGER NOT NULL, updated_at INTEGER NOT NULL)" },
    { type: "table", name: "app_maintenance", tbl_name: "app_maintenance", sql: "CREATE TABLE app_maintenance (id TEXT PRIMARY KEY, completed_at INTEGER NOT NULL)" },
  ];
  const env = {
    PRODUCTION_BACKUP_TOKEN: token,
    DB: fakeD1(tables, schema),
    MAP_ASSETS: fakeR2(objects),
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  };
  const root = await mkdtemp(join(tmpdir(), "battle map backup test "));
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
    assert.equal(manifest.d1.rowCount, 3);
    assert.equal(manifest.r2.objectCount, objects.size);
    assert.equal(manifest.r2.byteCount, [...objects.values()].reduce((sum, bytes) => sum + bytes.length, 0));
    await access(join(backup, "COMPLETE"));
    assert.equal((await stat(join(backup, "d1", "production.sqlite3"))).size > 0, true);
    for (const [key, bytes] of objects) assert.deepEqual(await readFile(join(backup, "r2", "objects", key)), bytes);
    const originalArgv = process.argv;
    try {
      process.argv = [process.execPath, "scripts/verify-production-backup.mjs", backup];
      const verifyScript = new URL("../scripts/verify-production-backup.mjs", import.meta.url);
      verifyScript.searchParams.set("test", `${process.pid}-${Date.now()}`);
      await import(verifyScript.href);
    } finally {
      process.argv = originalArgv;
    }
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
          const countMatch = sql.match(/^SELECT COUNT\(\*\) AS count FROM "([A-Za-z0-9_]+)"$/);
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
          const rowMatch = sql.match(/^SELECT \* FROM "([A-Za-z0-9_]+)" ORDER BY rowid LIMIT \? OFFSET \?$/);
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

function runNodeScript(path, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [path], { env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({
      code,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}
