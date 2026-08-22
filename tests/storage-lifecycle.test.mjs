import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

import {
  createStorageWriteIntent,
  queueStorageCleanupStatement,
  reconcileStorageLifecycle,
} from "../worker/adapters/d1-storage-lifecycle.ts";
import { createD1MutationUnitOfWork } from "../worker/adapters/d1-mutation-unit-of-work.ts";
import { createD1ChatHandoutRepository } from "../worker/adapters/d1-chat-handout-repository.ts";

test("cleanup outbox retries partial R2 failure and completes idempotently", async () => {
  await withDatabase(async (db) => {
    const now = 1_900_000_000_000;
    await db.batch([
      queueStorageCleanupStatement(db, "display-key", "test", now),
      queueStorageCleanupStatement(db, "thumbnail-key", "test", now),
    ]);
    const objects = new Set(["display-key", "thumbnail-key"]);
    let failThumbnail = true;
    const bucket = {
      async delete(key) {
        if (key === "thumbnail-key" && failThumbnail) throw new Error("temporary R2 failure");
        objects.delete(key);
      },
    };
    await reconcileStorageLifecycle(db, bucket, now);
    assert.equal(objects.has("display-key"), false);
    assert.equal(objects.has("thumbnail-key"), true);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM storage_cleanup_outbox WHERE completed_at IS NULL", undefined), 1);
    failThumbnail = false;
    await reconcileStorageLifecycle(db, bucket, now + 4_000);
    assert.equal(objects.size, 0);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM storage_cleanup_outbox WHERE completed_at IS NULL", undefined), 0);
  });
});

test("reference-aware cleanup never deletes a winning content-addressed asset", async () => {
  await withDatabase(async (db) => {
    const now = 1_900_000_000_000;
    await db.prepare(
      `INSERT INTO scenario_provisioning_jobs
       (id, idempotency_key, revision, operation, status, manifest_json, manifest_hash,
        scenario_id, scenario_code, base_scenario_version, summary, error_code, result_json,
        created_at, updated_at)
       VALUES ('job-outbox', 'outbox-key', 1, 'create', 'staging', '{}', 'hash',
        NULL, NULL, NULL, '', NULL, NULL, ?, ?)`,
    ).bind(now, now).run();
    await db.prepare(
      `INSERT INTO scenario_provisioning_assets
       (id, job_id, asset_id, kind, r2_key, content_type, width, height,
        byte_length, sha256, committed_at, created_at)
       VALUES ('asset-outbox', 'job-outbox', 'map', 'map', 'shared-key', 'image/jpeg',
        1, 1, 1, 'hash', NULL, ?)`,
    ).bind(now).run();
    await queueStorageCleanupStatement(db, "shared-key", "losing-identical-upload", now).run();
    const deleted = [];
    await reconcileStorageLifecycle(db, { delete: async (key) => deleted.push(key) }, now);
    assert.deepEqual(deleted, []);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM storage_cleanup_outbox WHERE completed_at IS NOT NULL", undefined), 1);
  });
});

test("stale write intents become retryable cleanup work", async () => {
  await withDatabase(async (db) => {
    const createdAt = 1_900_000_000_000;
    await createStorageWriteIntent(db, "operation-1", ["orphan-key"], createdAt);
    const deleted = [];
    await reconcileStorageLifecycle(db, { delete: async (key) => deleted.push(key) }, createdAt + 16 * 60 * 1_000);
    assert.deepEqual(deleted, ["orphan-key"]);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM storage_write_intents", undefined), 0);
  });
});

test("abandoned provisioning jobs fail durably and release their staged assets", async () => {
  await withDatabase(async (db) => {
    const createdAt = 1_900_000_000_000;
    await db.prepare(
      `INSERT INTO scenario_provisioning_jobs
       (id, idempotency_key, revision, operation, status, manifest_json, manifest_hash,
        scenario_id, scenario_code, base_scenario_version, summary, error_code, result_json,
        created_at, updated_at)
       VALUES ('job-abandoned', 'abandoned-key', 1, 'create', 'staging', '{}', 'hash',
        NULL, NULL, NULL, '', NULL, NULL, ?, ?)`,
    ).bind(createdAt, createdAt).run();
    await db.prepare(
      `INSERT INTO scenario_provisioning_assets
       (id, job_id, asset_id, kind, r2_key, content_type, width, height,
        byte_length, sha256, committed_at, created_at)
       VALUES ('asset-abandoned', 'job-abandoned', 'map', 'map', 'abandoned-key',
        'image/jpeg', 1, 1, 1, 'hash', NULL, ?)`,
    ).bind(createdAt).run();
    const objects = new Set(["abandoned-key"]);

    await reconcileStorageLifecycle(db, {
      async delete(key) { objects.delete(key); },
    }, createdAt + 24 * 60 * 60 * 1_000 + 1);

    const job = await db.prepare(
      "SELECT status, error_code FROM scenario_provisioning_jobs WHERE id = 'job-abandoned'",
    ).first();
    assert.deepEqual(job, { status: "failed", error_code: "job_abandoned" });
    assert.equal(objects.size, 0);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM storage_cleanup_outbox WHERE completed_at IS NOT NULL", undefined), 1);
  });
});

test("handout tombstone and cleanup intent commit before R2 deletion", async () => {
  await withDatabase(async (db) => {
    const encounter = await db.prepare("SELECT id, version FROM encounters LIMIT 1").first();
    await insertHandout(db, encounter.id, "handout-owner", "handout-atomic", 100).run();
    const objects = new Set(["handout-atomic-display", "handout-atomic-thumbnail"]);
    const unitOfWork = createD1MutationUnitOfWork(db);
    const repository = createD1ChatHandoutRepository(unitOfWork.database);
    const handout = await repository.findDeletableHandout(encounter.id, "handout-atomic");

    await repository.markHandoutDeleted(encounter.id, handout, 200);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM handouts WHERE id = 'handout-atomic' AND deleted_at IS NULL", undefined), 1);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM storage_cleanup_outbox", undefined), 0);
    assert.equal(objects.size, 2);

    await unitOfWork.commit({
      encounterId: encounter.id,
      expectedVersion: encounter.version,
      participantId: "handout-owner",
      actionType: "handout_deleted",
      actionPayload: { handoutId: "handout-atomic" },
      now: 200,
    });
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM handouts WHERE id = 'handout-atomic' AND deleted_at IS NOT NULL", undefined), 1);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM storage_cleanup_outbox WHERE completed_at IS NULL", undefined), 2);
    assert.equal(objects.size, 2);

    await reconcileStorageLifecycle(db, {
      async delete(key) { objects.delete(key); },
    }, 200);
    assert.equal(objects.size, 0);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM storage_cleanup_outbox WHERE completed_at IS NULL", undefined), 0);
  });
});

test("D1 serializes concurrent active-handout quota attempts", async () => {
  await withDatabase(async (db) => {
    const encounterId = (await db.prepare("SELECT id FROM encounters LIMIT 1").first()).id;
    const participantId = "handout-quota-test";
    for (let index = 0; index < 49; index += 1) {
      await insertHandout(db, encounterId, participantId, `quota-${index}`, index).run();
    }
    const results = await Promise.allSettled([
      insertHandout(db, encounterId, participantId, "quota-a", 50).run(),
      insertHandout(db, encounterId, participantId, "quota-b", 51).run(),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM handouts WHERE encounter_id = ? AND deleted_at IS NULL", encounterId), 50);
  });
});

test("D1 serializes the hourly provisioning-job quota", async () => {
  await withDatabase(async (db) => {
    const now = 1_900_000_000_000;
    for (let index = 0; index < 11; index += 1) {
      await insertJob(db, `quota-job-${index}`, now + index).run();
    }
    const results = await Promise.allSettled([
      insertJob(db, "quota-job-a", now + 20).run(),
      insertJob(db, "quota-job-b", now + 21).run(),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM scenario_provisioning_jobs", undefined), 12);
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
    await migrate(db);
    await run(db);
  } finally {
    await miniflare.dispose();
  }
}

async function migrate(db) {
  const directory = new URL("../drizzle/", import.meta.url);
  const migrations = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(migration, directory), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}

async function scalar(db, sql, binding) {
  const statement = binding === undefined ? db.prepare(sql) : db.prepare(sql).bind(binding);
  return (await statement.first()).value;
}

function insertHandout(db, encounterId, participantId, id, now) {
  return db.prepare(
    `INSERT INTO handouts
     (id, encounter_id, title, display_key, thumbnail_key, mime_type, width, height,
      display_bytes, thumbnail_bytes, created_by, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, 'image/webp', 1, 1, 1, 1, ?, ?, ?, NULL)`,
  ).bind(id, encounterId, id, `${id}-display`, `${id}-thumbnail`, participantId, now, now);
}

function insertJob(db, id, now) {
  return db.prepare(
    `INSERT INTO scenario_provisioning_jobs
     (id, idempotency_key, revision, operation, status, manifest_json, manifest_hash,
      scenario_id, scenario_code, base_scenario_version, summary, error_code, result_json,
      created_at, updated_at)
     VALUES (?, ?, 1, 'create', 'received', '{}', ?, NULL, NULL, NULL, '', NULL, NULL, ?, ?)`,
  ).bind(id, `${id}-key`, `${id}-hash`, now, now);
}
