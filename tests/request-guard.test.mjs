import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";

import {
  acquireOperationLease,
  consumeRateLimit,
  releaseOperationLease,
} from "../worker/adapters/d1-request-guard.ts";

test("D1 rate limits are atomic and reset on a later window", async () => {
  await withDatabase(async (db) => {
    const policy = { limit: 2, windowMs: 1_000 };
    assert.equal((await consumeRateLimit(db, "client", policy, 1_000)).allowed, true);
    assert.equal((await consumeRateLimit(db, "client", policy, 1_001)).allowed, true);
    const denied = await consumeRateLimit(db, "client", policy, 1_002);
    assert.equal(denied.allowed, false);
    assert.equal(denied.retryAfterSeconds, 1);
    assert.equal((await consumeRateLimit(db, "client", policy, 2_000)).allowed, true);
  });
});

test("concurrent rate-limit attempts cannot oversubscribe the window", async () => {
  await withDatabase(async (db) => {
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      consumeRateLimit(db, "concurrent-client", { limit: 5, windowMs: 60_000 }, 1_000)));
    assert.equal(results.filter((result) => result.allowed).length, 5);
    assert.equal(results.filter((result) => !result.allowed).length, 15);
  });
});

test("only one concurrent caller acquires a named operation lease", async () => {
  await withDatabase(async (db) => {
    const leases = await Promise.all(Array.from({ length: 12 }, () =>
      acquireOperationLease(db, "catalog-import", 30_000, 1_000)));
    assert.equal(leases.filter(Boolean).length, 1);
    const token = leases.find(Boolean);
    await releaseOperationLease(db, "catalog-import", token);
    assert.ok(await acquireOperationLease(db, "catalog-import", 30_000, 1_001));
  });
});

async function withDatabase(run) {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  try {
    const db = await miniflare.getD1Database("DB");
    await db.prepare("CREATE TABLE request_rate_limits (key TEXT PRIMARY KEY NOT NULL, request_count INTEGER NOT NULL, window_ends_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)").run();
    await db.prepare("CREATE TABLE operation_leases (key TEXT PRIMARY KEY NOT NULL, lease_token TEXT NOT NULL, expires_at INTEGER NOT NULL)").run();
    await run(db);
  } finally {
    await miniflare.dispose();
  }
}
