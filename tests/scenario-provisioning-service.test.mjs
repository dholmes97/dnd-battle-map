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
    scenario: { name: "Sunken Chapel", briefing: "Briefing" },
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
  const mailReplies = new Map();
  const mailMessages = new Map();
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
    beginAssetWrite: async () => {},
    commitAssetWrite: async ({ asset }) => { assets.set(`${asset.jobId}:${asset.assetId}`, asset); return true; },
    abandonAssetWrite: async () => {},
    findMailReply: async (jobId, replyKind) => [...mailReplies.values()].find((reply) => reply.jobId === jobId && reply.replyKind === replyKind) ?? null,
    findMailReplyById: async (replyId) => mailReplies.get(replyId) ?? null,
    findMailReplyByMarker: async (marker) => [...mailReplies.values()].find((reply) => reply.responseMarker === marker) ?? null,
    createMailReply: async (reply) => mailReplies.set(reply.id, reply),
    findMailMessage: async (mailboxKey, messageId) => mailMessages.get(`${mailboxKey}:${messageId}`) ?? null,
    recordMailMessage: async (message) => {
      const key = `${message.mailboxKey}:${message.providerMessageId}`;
      if (mailMessages.has(key)) return false;
      mailMessages.set(key, message);
      return true;
    },
    finalize: async ({ job, manifest: value, mapPackage, assets: staged, now }) => {
      const result = {
        jobId: job.id,
        status: "ready",
        scenario: { id: "scenario-1", code: "SUNKEN-CHAPEL", name: value.scenario.name },
        mapImageId: "map-image-1",
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
      reconcile: async () => {},
    },
    createId: () => `id-${++id}`,
    now: () => 1_000 + id,
    hash: async (value) => `hash-${typeof value === "string" ? value.length : [...value].reduce((sum, byte) => sum + byte, 0)}`,
    authorizedSenders,
  });
  return { service, jobs, assets, mailReplies, mailMessages, objects };
}

test("job creation is idempotent and rejects key reuse for another manifest", async () => {
  const { service } = fixture();
  const first = await service.createJob(manifest());
  const replay = await service.createJob(manifest());
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.job.id, first.job.id);
  await assert.rejects(
    service.createJob(manifest({ scenario: { name: "Different", briefing: "" } })),
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

test("automation replies are reserved and recorded idempotently before they can become requests", async () => {
  const { service, mailMessages } = fixture();
  const created = await service.createJob(manifest());
  await service.transition(created.job.id, "needs_clarification", "Need one answer.");
  const reservation = await service.reserveMailReply(created.job.id, { kind: "clarification" });
  const replay = await service.reserveMailReply(created.job.id, { kind: "clarification" });
  assert.equal(reservation.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.reply.id, reservation.reply.id);
  assert.match(reservation.reply.responseMarker, new RegExp(`^DND-SCENARIO-REPLY:${created.job.id}:`));
  await assert.rejects(
    service.recordMailReplyMessage(created.job.id, reservation.reply.id, { messageId: "gmail-wrong-thread", threadId: "other-thread" }),
    (error) => error.code === "mail_reply_thread_mismatch",
  );

  const recorded = await service.recordMailReplyMessage(created.job.id, reservation.reply.id, { messageId: "gmail-agent-reply-1", threadId: "thread-1" });
  const recordedReplay = await service.recordMailReplyMessage(created.job.id, reservation.reply.id, { messageId: "gmail-agent-reply-1", threadId: "thread-1" });
  assert.equal(recorded.created, true);
  assert.equal(recordedReplay.created, false);
  assert.equal(mailMessages.size, 1);
  assert.deepEqual(await service.classifyMailMessage({ mailboxKey: "primary", messageId: "gmail-agent-reply-1", threadId: "thread-1" }), {
    automationAuthored: true,
    recovered: false,
    reply: reservation.reply,
  });
  await assert.rejects(
    service.createJob(manifest({
      idempotencyKey: "gmail-primary-agent-reply-1-revision-1",
      source: { provider: "gmail", mailboxKey: "primary", messageId: "gmail-agent-reply-1", threadId: "thread-1", sender: "kevin@example.com" },
    })),
    (error) => error.code === "mail_message_automation_authored",
  );
});

test("a marker recovers an interrupted message-ID write while a later human self-reply stays eligible", async () => {
  const { service } = fixture();
  const created = await service.createJob(manifest({
    source: { provider: "gmail", mailboxKey: "primary", messageId: "dan-human-1", threadId: "self-thread", sender: "dan@example.com" },
  }));
  await service.transition(created.job.id, "needs_clarification", "Need one answer.");
  const reservation = await service.reserveMailReply(created.job.id, { kind: "clarification" });

  const recovered = await service.classifyMailMessage({
    mailboxKey: "primary",
    messageId: "dan-agent-reply-1",
    threadId: "self-thread",
    responseMarker: reservation.reply.responseMarker,
  });
  assert.equal(recovered.automationAuthored, true);
  assert.equal(recovered.recovered, true);
  await assert.rejects(
    service.createJob(manifest({
      idempotencyKey: "gmail-primary-dan-agent-reply-1",
      source: { provider: "gmail", mailboxKey: "primary", messageId: "dan-agent-reply-1", threadId: "self-thread", sender: "dan@example.com" },
    })),
    (error) => error.code === "mail_message_automation_authored",
  );

  const humanIdentity = { mailboxKey: "primary", messageId: "dan-human-2", threadId: "self-thread" };
  assert.deepEqual(await service.classifyMailMessage(humanIdentity), {
    automationAuthored: false,
    recovered: false,
    reply: null,
  });
  const humanRevision = await service.createJob(manifest({
    idempotencyKey: "gmail-primary-dan-human-2-revision-2",
    revision: 2,
    operation: "revise",
    targetScenarioCode: "SUNKEN-CHAPEL",
    source: { provider: "gmail", ...humanIdentity, sender: "dan@example.com" },
    party: { include: false, sourceScenarioCode: "EMBER-KEEP", placements: [] },
    map: null,
  }));
  assert.equal(humanRevision.created, true);
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
