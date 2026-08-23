import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/provision-scenario.mjs", import.meta.url));

test("scenario client requires its dedicated secret and never falls back to catalog or backup credentials", async () => {
  const environment = {
    ...process.env,
    CATALOG_IMPORT_TOKEN: "test-catalog-token-0000000000000001",
    PRODUCTION_BACKUP_TOKEN: "test-backup-token-0000000000000001",
    BATTLE_MAP_SITE_URL: "https://example.com",
  };
  delete environment.SCENARIO_PROVISIONING_TOKEN;
  const result = await run([script, "missing-envelope.json"], environment);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Set SCENARIO_PROVISIONING_TOKEN/);
  assert.doesNotMatch(result.stderr, /CATALOG_IMPORT_TOKEN|PRODUCTION_BACKUP_TOKEN/);
});

test("scenario client rejects a site URL containing credentials or a path", async () => {
  const result = await run([script, "missing-envelope.json"], {
    ...process.env,
    SCENARIO_PROVISIONING_TOKEN: "test-scenario-provisioning-token-000001",
    BATTLE_MAP_SITE_URL: "https://user:password@example.com/not-the-origin",
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Set BATTLE_MAP_SITE_URL/);
  assert.doesNotMatch(result.stderr, /password/);
});

test("scenario client stages only parser-derived assets and finalizes the returned job", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scenario-client-"));
  const envelopePath = join(directory, "envelope.json");
  const mapPath = join(directory, "map.jpg");
  await writeFile(mapPath, jpeg(3072, 2048));
  await writeFile(envelopePath, JSON.stringify({ manifest: manifest(), assets: { "map-main": { path: "map.jpg", contentType: "image/jpeg" } } }));
  const calls = [];
  const original = {
    argv: process.argv,
    fetch: globalThis.fetch,
    token: process.env.SCENARIO_PROVISIONING_TOKEN,
    site: process.env.BATTLE_MAP_SITE_URL,
  };
  try {
    process.argv = [process.execPath, script, envelopePath];
    process.env.SCENARIO_PROVISIONING_TOKEN = "test-scenario-provisioning-token-000001";
    process.env.BATTLE_MAP_SITE_URL = "https://battle-map.example";
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/api/scenario-provisioning/jobs")) return response({ created: true, job: { id: "job-1", status: "received" } }, 201);
      if (url.endsWith("/assets/map-main")) return response({ asset: { id: "map-main" } });
      if (url.endsWith("/finalize")) return response({ result: { scenario: { name: "Sunken Chapel", code: "SUNKEN-CHAPEL" }, mapImageId: "map-image-1", handoutIds: [], placedTokenIds: [], createdCatalogIds: [], reusedCatalogIds: [], reviewWarnings: [] } });
      if (url.endsWith("/jobs/job-1")) return response({ job: { id: "job-1", status: "validating" } });
      throw new Error(`Unexpected request ${url}`);
    };
    const moduleUrl = new URL("../scripts/provision-scenario.mjs", import.meta.url);
    moduleUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
    await import(moduleUrl.href);
    assert.deepEqual(calls.map((call) => [new URL(call.url).pathname, call.init.method]), [
      ["/api/scenario-provisioning/jobs", "POST"],
      ["/api/scenario-provisioning/jobs/job-1", "PATCH"],
      ["/api/scenario-provisioning/jobs/job-1/assets/map-main", "PUT"],
      ["/api/scenario-provisioning/jobs/job-1/finalize", "POST"],
    ]);
    assert.ok(calls.every((call) => call.init.headers.authorization === "Bearer test-scenario-provisioning-token-000001"));
    assert.equal(calls[2].init.headers["content-type"], "image/jpeg");
  } finally {
    process.argv = original.argv;
    globalThis.fetch = original.fetch;
    if (original.token === undefined) delete process.env.SCENARIO_PROVISIONING_TOKEN; else process.env.SCENARIO_PROVISIONING_TOKEN = original.token;
    if (original.site === undefined) delete process.env.BATTLE_MAP_SITE_URL; else process.env.BATTLE_MAP_SITE_URL = original.site;
    await rm(directory, { recursive: true, force: true });
  }
});

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function manifest() {
  return {
    version: 1, idempotencyKey: "gmail-primary-message-1-revision-1", revision: 1, operation: "create", targetScenarioCode: null,
    source: { provider: "gmail", mailboxKey: "primary", messageId: "message-1", threadId: "thread-1", sender: "kevin@example.com" },
    scenario: { name: "Sunken Chapel", briefing: "Briefing" },
    settings: { strictMovement: false }, party: { include: true, sourceScenarioCode: "EMBER-KEEP", placements: [] },
    map: { id: "sunken-chapel-v1", assetId: "map-main", name: "Sunken Chapel", description: "Flooded chapel", biome: "dungeon", mood: "torchlight", width: 24, height: 16, fog: { mode: "off", sharedPolygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }], walls: [], doors: [], circles: [] }, labels: [], notes: [] },
    handouts: [], creatures: [], assumptions: [], reviewWarnings: [],
  };
}

function jpeg(width, height) {
  const bytes = new Uint8Array(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03]);
  return bytes;
}

function run(arguments_, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, arguments_, { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
  });
}
