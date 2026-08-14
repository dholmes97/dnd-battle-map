import assert from "node:assert/strict";
import test from "node:test";

import { createScenarioProvisioningService } from "../worker/scenario-provisioning-service.ts";

function manifest(overrides = {}) {
  return {
    version: 1,
    idempotencyKey: "gmail-primary-message-1-revision-1",
    revision: 1,
    operation: "create",
    source: { provider: "gmail", mailboxKey: "primary", messageId: "message-1", threadId: "thread-1", sender: "kevin@example.com" },
    scenario: { name: "Sunken Chapel", briefing: "Briefing", presetName: "Vision Ready", presetDescription: "" },
    settings: { strictMovement: false },
    party: { include: true, sourceScenarioCode: "EMBER-KEEP", placements: [] },
    map: {
      id: "sunken-chapel-v1",
      assetId: "map-main",
      name: "Sunken Chapel",
      description: "Flooded chapel",
      biome: "dungeon",
      mood: "torchlight",
      width: 24,
      height: 16,
      fog: { mode: "off", sharedPolygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }], walls: [], doors: [], circles: [] },
      labels: [],
      notes: [],
    },
    handouts: [],
    creatures: [],
    assumptions: [],
    reviewWarnings: [],
    ...overrides,
  };
}

function jpeg(width, height) {
  const bytes = new Uint8Array(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03]);
  return bytes;
}

function fixture({ recentJobCount = 0, authorizedSenders = ["kevin@example.com", "dan@example.com"] } = {}) {
  const jobs = new Map();
  const assets = new Map();
  const objects = new Map();
  let id = 0;
  const repository = {
    findJobByIdempotencyKey: async (key) => [...jobs.values()].find((job) => job.idempotencyKey === key) ?? null,
    findJobById: async (jobId) => jobs.get(jobId) ?? null,
    countJobsCreatedSince: async () => recentJobCount,
    findScenarioRevisionTarget: async (code) => ({ id: "scenario-target", code, version: 7 }),
    createJob: async (job) => jobs.set(job.id, job),
    updateJobStatus: async ({ jobId, from, to, summary, errorCode, now }) => {
      const job = jobs.get(jobId);
      if (!job || job.status !== from) return false;
      jobs.set(jobId, { ...job, status: to, summary, errorCode, updatedAt: now });
      return true;
    },
    findAsset: async (jobId, assetId) => assets.get(`${jobId}:${assetId}`) ?? null,
    listAssets: async (jobId) => [...assets.values()].filter((asset) => asset.jobId === jobId),
    upsertAsset: async (asset) => { assets.set(`${asset.jobId}:${asset.assetId}`, asset); return true; },
    finalize: async ({ job, manifest: value, mapPackage, assets: staged, now }) => {
      const result = {
        jobId: job.id,
        status: "ready",
        scenario: { id: "scenario-1", code: "SUNKEN-CHAPEL", name: value.scenario.name },
        presetId: "preset-1",
        handoutIds: [],
        placedTokenIds: [],
        createdCatalogIds: [],
        reusedCatalogIds: [],
        assumptions: value.assumptions,
        reviewWarnings: value.reviewWarnings,
      };
      jobs.set(job.id, { ...job, status: "ready", scenarioId: "scenario-1", scenarioCode: "SUNKEN-CHAPEL", resultJson: JSON.stringify(result), updatedAt: now });
      for (const asset of staged) assets.set(`${asset.jobId}:${asset.assetId}`, { ...asset, committedAt: now });
      assert.equal(mapPackage.visual.assetUrl, `/map-assets/provisioned/${job.id}/map-main.jpg`);
      return result;
    },
    findCommittedMapAsset: async () => null,
  };
  const service = createScenarioProvisioningService({
    repository,
    objectStorage: {
      available: true,
      put: async (key, bytes) => objects.set(key, bytes),
      delete: async (key) => objects.delete(key),
      get: async () => null,
    },
    createId: () => `id-${++id}`,
    now: () => 1_000 + id,
    hash: async (value) => `hash-${typeof value === "string" ? value.length : [...value].reduce((sum, byte) => sum + byte, 0)}`,
    authorizedSenders,
  });
  return { service, jobs, assets, objects };
}

test("job creation is idempotent and rejects key reuse for another manifest", async () => {
  const { service } = fixture();
  const first = await service.createJob(manifest());
  const replay = await service.createJob(manifest());
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.job.id, first.job.id);
  await assert.rejects(
    service.createJob(manifest({ scenario: { name: "Different", briefing: "", presetName: "Different", presetDescription: "" } })),
    (error) => error.code === "idempotency_conflict",
  );
});

test("job creation rejects a manifest whose normalized sender is not configured", async () => {
  const { service } = fixture();
  await assert.rejects(
    service.createJob(manifest({ source: { provider: "gmail", mailboxKey: "primary", messageId: "message-1", threadId: "thread-1", sender: "attacker@example.com" } })),
    (error) => error.code === "sender_unauthorized" && error.status === 403,
  );
});

test("job creation accepts every exact address in the configured allowlist", async () => {
  const { service } = fixture();
  const kevin = await service.createJob(manifest());
  const dan = await service.createJob(manifest({
    idempotencyKey: "gmail-primary-message-2-revision-1",
    source: { provider: "gmail", mailboxKey: "primary", messageId: "message-2", threadId: "thread-2", sender: "dan@example.com" },
  }));
  assert.equal(kevin.created, true);
  assert.equal(dan.created, true);
});

test("new jobs are rate limited at the authenticated application boundary", async () => {
  const { service } = fixture({ recentJobCount: 12 });
  await assert.rejects(service.createJob(manifest()), (error) => error.code === "job_rate_limited" && error.status === 429);
});

test("declared assets stage once and finalization is replay-safe", async () => {
  const { service, assets, objects } = fixture();
  const created = await service.createJob(manifest());
  const staged = await service.stageAsset(created.job.id, "map-main", "image/jpeg", jpeg(3072, 2048));
  assert.equal(staged.width, 3072);
  assert.equal(assets.size, 1);
  assert.equal(objects.size, 1);
  const result = await service.finalize(created.job.id);
  assert.equal(result.scenario.code, "SUNKEN-CHAPEL");
  assert.equal((await service.getJob(created.job.id)).status, "ready");
  assert.deepEqual(await service.finalize(created.job.id), result);
});

test("undeclared, malformed, and missing assets fail before persistence finalization", async () => {
  const { service } = fixture();
  const created = await service.createJob(manifest());
  await assert.rejects(service.stageAsset(created.job.id, "arbitrary", "image/jpeg", jpeg(3072, 2048)), (error) => error.code === "asset_not_expected");
  await assert.rejects(service.stageAsset(created.job.id, "map-main", "image/jpeg", jpeg(1024, 1024)), (error) => error.code === "map_dimensions_invalid");
  await assert.rejects(service.finalize(created.job.id), (error) => error.code === "assets_missing");
});
