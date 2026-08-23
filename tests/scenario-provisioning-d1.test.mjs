import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

import {
  createD1ScenarioProvisioningRepository,
  createR2ScenarioProvisioningStorage,
} from "../worker/adapters/d1-scenario-provisioning-repository.ts";
import { createScenarioProvisioningService } from "../worker/scenario-provisioning-service.ts";

test("D1/R2 adapter finalizes a complete scenario atomically and replays safely", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
    r2Buckets: ["MAP_ASSETS"],
  });
  try {
    const db = await miniflare.getD1Database("DB");
    const bucket = await miniflare.getR2Bucket("MAP_ASSETS");
    const migrationDirectory = new URL("../drizzle/", import.meta.url);
    const migrations = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
    for (const migration of migrations) {
      const sql = await readFile(new URL(migration, migrationDirectory), "utf8");
      for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
        await db.prepare(statement).run();
      }
    }
    let nextId = 0;
    const testNow = Date.now();
    const storage = createR2ScenarioProvisioningStorage(bucket, db);
    let blockNextPut = false;
    let releaseBlockedPut = () => {};
    let announceBlockedPut = () => {};
    const blockedPutStarted = new Promise((resolve) => { announceBlockedPut = resolve; });
    const service = createScenarioProvisioningService({
      repository: createD1ScenarioProvisioningRepository(db),
      objectStorage: {
        ...storage,
        async put(key, bytes, contentType) {
          if (blockNextPut) {
            blockNextPut = false;
            announceBlockedPut();
            await new Promise((resolve) => { releaseBlockedPut = resolve; });
          }
          await storage.put(key, bytes, contentType);
        },
      },
      createId: () => `provisioned-id-${++nextId}`,
      now: () => testNow + nextId,
      hash: async (value) => `hash-${typeof value === "string" ? value.length : value.byteLength}`,
      authorizedSenders: ["kevin@example.com", "dan@example.com"],
    });
    const created = await service.createJob(manifest());
    const initialMap = await service.stageAsset(created.job.id, "map-main", "image/jpeg", jpeg(3072, 2048));
    await service.stageAsset(created.job.id, "shadow-bat-original", "image/png", png(512, 512));
    await service.stageAsset(created.job.id, "shadow-bat-thumbnail", "image/png", png(144, 144));
    const replacement = new Uint8Array([...jpeg(3072, 2048), 1]);
    blockNextPut = true;
    const lateStage = service.stageAsset(created.job.id, "map-main", "image/jpeg", replacement);
    await blockedPutStarted;
    const result = await service.finalize(created.job.id);
    releaseBlockedPut();
    await assert.rejects(lateStage, (error) => error.code === "asset_committed");

    assert.equal(result.scenario.name, "Sunken Chapel");
    assert.equal(result.placedTokenIds.length, 4);
    assert.deepEqual(result.createdCatalogIds, ["email-shadow-bat"]);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM encounters WHERE code = ?", result.scenario.code), 1);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM tokens WHERE encounter_id = ?", result.scenario.id), 4);
    assert.equal(result.mapImageId !== null, true);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM map_images WHERE id = ?", result.mapImageId), 1);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM map_presets WHERE encounter_id = ?", result.scenario.id), 0);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM encounters WHERE id = ? AND active_map_image_id = draft_map_image_id", result.scenario.id), 1);
    assert.equal(await scalar(db, "SELECT json_extract(active_map_setup_json, '$.format') AS value FROM encounters WHERE id = ?", result.scenario.id), "dnd-map-setup");
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM scenario_provisioning_assets WHERE committed_at IS NOT NULL", undefined), 3);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM scenario_provisioning_jobs WHERE status = 'ready'", undefined), 1);
    assert.equal((await createD1ScenarioProvisioningRepository(db).findAsset(created.job.id, "map-main")).r2Key, initialMap.r2Key);
    assert.equal(await scalar(
      db,
      "SELECT COUNT(*) AS value FROM storage_cleanup_outbox WHERE reason = 'provisioning-asset-race-lost' AND completed_at IS NOT NULL",
      undefined,
    ), 1);
    assert.deepEqual(await service.finalize(created.job.id), result);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM encounters WHERE code = ?", result.scenario.code), 1);

    const reply = await service.reserveMailReply(created.job.id, { kind: "ready" });
    const recorded = await service.recordMailReplyMessage(created.job.id, reply.reply.id, { messageId: "gmail-ready-message-1", threadId: "thread-1" });
    assert.equal(reply.created, true);
    assert.equal(recorded.created, true);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM scenario_provisioning_mail_replies", undefined), 1);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM scenario_provisioning_mail_messages", undefined), 1);
    assert.equal((await service.classifyMailMessage({ mailboxKey: "primary", messageId: "gmail-ready-message-1", threadId: "thread-1" })).automationAuthored, true);

    const committed = await createD1ScenarioProvisioningRepository(db).findCommittedMapAsset(created.job.id, "map-main");
    assert.match(committed.r2Key, /^scenario-provisioning\//);
    assert.ok(await bucket.get(committed.r2Key));
    assert.match(await scalar(db, "SELECT token_asset AS value FROM creature_catalog WHERE id = 'email-shadow-bat'", undefined), /shadow-bat-original\.png$/);
    assert.match(await scalar(db, "SELECT thumbnail_asset AS value FROM creature_catalog WHERE id = 'email-shadow-bat'", undefined), /shadow-bat-thumbnail\.png\?variant=thumbnail&v=1$/);

    const revision = await service.createJob(revisionManifest(result.scenario.code, result.scenario.name));
    assert.equal(revision.job.baseScenarioVersion, 1);
    await service.transition(revision.job.id, "validating", "Revision validated.");
    await db.prepare("UPDATE encounters SET version = version + 1 WHERE id = ?").bind(result.scenario.id).run();
    await assert.rejects(service.finalize(revision.job.id), (error) => error.code === "scenario_changed");
    assert.equal(await scalar(db, "SELECT strict_movement AS value FROM encounters WHERE id = ?", result.scenario.id), 0);
    assert.equal((await service.getJob(revision.job.id)).status, "failed");
  } finally {
    await miniflare.dispose();
  }
});

test("concurrent identical staging preserves the winning content-addressed R2 object", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
    r2Buckets: ["MAP_ASSETS"],
  });
  try {
    const db = await miniflare.getD1Database("DB");
    const bucket = await miniflare.getR2Bucket("MAP_ASSETS");
    const migrationDirectory = new URL("../drizzle/", import.meta.url);
    const migrations = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
    for (const migration of migrations) {
      const sql = await readFile(new URL(migration, migrationDirectory), "utf8");
      for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
        await db.prepare(statement).run();
      }
    }
    let nextId = 0;
    const testNow = Date.now();
    const repository = createD1ScenarioProvisioningRepository(db);
    const service = createScenarioProvisioningService({
      repository,
      objectStorage: createR2ScenarioProvisioningStorage(bucket, db),
      createId: () => `race-id-${++nextId}`,
      now: () => testNow + nextId,
      hash: async (value) => `hash-${typeof value === "string" ? value.length : [...value].reduce((sum, byte) => sum + byte, 0)}`,
      authorizedSenders: ["kevin@example.com"],
    });
    const request = manifest();
    request.idempotencyKey = "concurrent-stage-1";
    request.source.messageId = "concurrent-stage-message";
    const created = await service.createJob(request);
    const bytes = jpeg(3072, 2048);
    const results = await Promise.allSettled([
      service.stageAsset(created.job.id, "map-main", "image/jpeg", bytes),
      service.stageAsset(created.job.id, "map-main", "image/jpeg", bytes),
    ]);
    assert.ok(results.some((result) => result.status === "fulfilled"));
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM scenario_provisioning_assets WHERE job_id = ?", created.job.id), 1);
    const winner = await repository.findAsset(created.job.id, "map-main");
    assert.ok(winner);
    assert.ok(await bucket.get(winner.r2Key));
    await createR2ScenarioProvisioningStorage(bucket, db).reconcile();
    assert.ok(await bucket.get(winner.r2Key));

    const replacementBytes = jpeg(3072, 2048);
    replacementBytes[20] = 1;
    const replacement = await service.stageAsset(created.job.id, "map-main", "image/jpeg", replacementBytes);
    assert.notEqual(replacement.r2Key, winner.r2Key);
    assert.equal(await bucket.get(winner.r2Key), null);
    assert.ok(await bucket.get(replacement.r2Key));
  } finally {
    await miniflare.dispose();
  }
});

test("a scenario revision changing at the final D1 batch boundary fully rolls back", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
    r2Buckets: ["MAP_ASSETS"],
  });
  try {
    const db = await miniflare.getD1Database("DB");
    const bucket = await miniflare.getR2Bucket("MAP_ASSETS");
    const migrationDirectory = new URL("../drizzle/", import.meta.url);
    const migrations = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
    for (const migration of migrations) {
      const sql = await readFile(new URL(migration, migrationDirectory), "utf8");
      for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
        await db.prepare(statement).run();
      }
    }
    const target = await db.prepare("SELECT id, code, name, version, strict_movement FROM encounters WHERE code = 'EMBER-KEEP'").first();
    let injectRace = false;
    const racingDb = new Proxy(db, {
      get(targetDb, property, receiver) {
        if (property === "batch") {
          return async (statements) => {
            if (injectRace && statements.length > 5) {
              injectRace = false;
              await db.prepare("UPDATE encounters SET version = version + 1 WHERE id = ?")
                .bind(target.id).run();
            }
            return db.batch(statements);
          };
        }
        const value = Reflect.get(targetDb, property, receiver);
        return typeof value === "function" ? value.bind(targetDb) : value;
      },
    });
    let nextId = 0;
    const service = createScenarioProvisioningService({
      repository: createD1ScenarioProvisioningRepository(racingDb),
      objectStorage: createR2ScenarioProvisioningStorage(bucket, db),
      createId: () => `revision-race-${++nextId}`,
      now: () => 1_910_000_000_000 + nextId,
      hash: async (value) => `hash-${typeof value === "string" ? value.length : value.byteLength}`,
      authorizedSenders: ["kevin@example.com"],
    });
    const request = revisionManifest(target.code, "Raced Rename");
    request.idempotencyKey = "revision-race-final-batch";
    request.source.messageId = "revision-race-message";
    const created = await service.createJob(request);
    await service.transition(created.job.id, "validating", "Revision validated.");
    injectRace = true;
    await assert.rejects(service.finalize(created.job.id), (error) => error.code === "scenario_changed");
    const after = await db.prepare("SELECT name, strict_movement FROM encounters WHERE id = ?")
      .bind(target.id).first();
    assert.equal(after.name, target.name);
    assert.equal(after.strict_movement, target.strict_movement);
    assert.equal((await service.getJob(created.job.id)).status, "failed");
  } finally {
    await miniflare.dispose();
  }
});

function manifest() {
  return {
    version: 1,
    idempotencyKey: "gmail-primary-sunken-chapel-1",
    revision: 1,
    operation: "create",
    targetScenarioCode: null,
    source: { provider: "gmail", mailboxKey: "primary", messageId: "message-1", threadId: "thread-1", sender: "kevin@example.com" },
    scenario: { name: "Sunken Chapel", briefing: "Test the flooded nave." },
    settings: { strictMovement: false },
    party: { include: true, sourceScenarioCode: "EMBER-KEEP", placements: [] },
    map: {
      id: "sunken-chapel-v1",
      assetId: "map-main",
      name: "Sunken Chapel",
      description: "Flooded chapel",
      sourcePrompt: "A roofless flooded chapel",
      biome: "dungeon",
      mood: "torchlight",
      width: 24,
      height: 16,
      fog: { mode: "dynamic", sharedPolygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }], walls: [{ id: "nave-wall", x1: 4, y1: 2, x2: 4, y2: 12 }], doors: [], circles: [] },
      labels: [],
      notes: [],
    },
    handouts: [],
    creatures: [{
      catalogId: "email-shadow-bat",
      create: {
        name: "Shadow Bat", family: "underdark", creatureType: "monstrosity", size: "small",
        defaultHp: 18, hitDice: "4d6+4", armorClass: 14, challengeRating: "1",
        speeds: { walk: 10, fly: 50, swim: null, climb: null, burrow: null },
        originalAssetId: "shadow-bat-original", thumbnailAssetId: "shadow-bat-thumbnail",
        provenance: ["DM-supplied homebrew statistics"],
      },
      placements: [{ id: "shadow-bat-1", name: null, x: 10, y: 8, hp: null, maxHp: null, hidden: true }],
    }],
    assumptions: ["Party begins at the south edge."],
    reviewWarnings: ["Review the broken north wall."],
  };
}

function revisionManifest(code, name) {
  return {
    version: 1,
    idempotencyKey: "gmail-primary-sunken-chapel-2",
    revision: 2,
    operation: "revise",
    targetScenarioCode: code,
    source: { provider: "gmail", mailboxKey: "primary", messageId: "message-2", threadId: "thread-1", sender: "kevin@example.com" },
    scenario: { name, briefing: "" },
    settings: { strictMovement: true },
    party: { include: false, sourceScenarioCode: "EMBER-KEEP", placements: [] },
    map: null,
    handouts: [],
    creatures: [],
    assumptions: [],
    reviewWarnings: [],
  };
}

function jpeg(width, height) {
  const bytes = new Uint8Array(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03]);
  return bytes;
}

function png(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes[16] = width >>> 24; bytes[17] = width >>> 16; bytes[18] = width >>> 8; bytes[19] = width;
  bytes[20] = height >>> 24; bytes[21] = height >>> 16; bytes[22] = height >>> 8; bytes[23] = height;
  return bytes;
}

async function scalar(db, sql, binding) {
  const statement = binding === undefined ? db.prepare(sql) : db.prepare(sql).bind(binding);
  return (await statement.first()).value;
}
