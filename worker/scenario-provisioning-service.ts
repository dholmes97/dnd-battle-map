import {
  buildProvisionedMapPackage,
  SCENARIO_PROVISIONING_MAX_JOBS_PER_HOUR,
  parseScenarioProvisioningManifest,
  requiredScenarioProvisioningAssets,
  scenarioProvisioningTransitionError,
  type ScenarioProvisioningAssetSpec,
  type ScenarioProvisioningJobStatus,
} from "../shared/scenario-provisioning.ts";
import { inspectStoredHandout, storedHandoutVariantError } from "../shared/handout-domain.ts";
import { inspectPng } from "../shared/scenario-provisioning.ts";
import { emailSenderAllowed } from "../shared/secret-auth.ts";
import {
  cleanScenarioMailboxKey,
  cleanScenarioProviderMessageId,
  cleanScenarioThreadId,
  parseScenarioMailReplyKind,
  parseScenarioMailResponseMarker,
  scenarioMailResponseMarker,
  type ScenarioMailReplyKind,
} from "../shared/scenario-mail-provenance.ts";
import type {
  ScenarioProvisioningAssetRecord,
  ScenarioProvisioningFinalizeResult,
  ScenarioProvisioningJobRecord,
  ScenarioProvisioningMailMessageRecord,
  ScenarioProvisioningMailReplyRecord,
  ScenarioProvisioningObjectStorage,
  ScenarioProvisioningRepository,
} from "./ports/scenario-provisioning-repository.ts";
import { ScenarioProvisioningWriteError } from "./ports/scenario-provisioning-repository.ts";

export type ScenarioProvisioningServiceDependencies = {
  repository: ScenarioProvisioningRepository;
  objectStorage: ScenarioProvisioningObjectStorage;
  createId(): string;
  now(): number;
  hash(value: Uint8Array | string): Promise<string>;
  authorizedSenders: readonly string[];
};

export type ScenarioProvisioningPublicJob = {
  id: string;
  revision: number;
  operation: "create" | "revise";
  status: ScenarioProvisioningJobStatus;
  scenarioCode: string | null;
  baseScenarioVersion: number | null;
  summary: string;
  errorCode: string | null;
  result: ScenarioProvisioningFinalizeResult | null;
  createdAt: number;
  updatedAt: number;
};

export type ScenarioProvisioningPublicMailReply = {
  id: string;
  jobId: string;
  replyKind: ScenarioMailReplyKind;
  responseMarker: string;
  createdAt: number;
};

export type ScenarioMailMessageClassification = {
  automationAuthored: boolean;
  recovered: boolean;
  reply: ScenarioProvisioningPublicMailReply | null;
};

export function publicScenarioProvisioningJob(job: ScenarioProvisioningJobRecord): ScenarioProvisioningPublicJob {
  let result: ScenarioProvisioningFinalizeResult | null = null;
  if (job.resultJson) {
    try { result = JSON.parse(job.resultJson) as ScenarioProvisioningFinalizeResult; } catch { result = null; }
  }
  return {
    id: job.id,
    revision: job.revision,
    operation: job.operation,
    status: job.status,
    scenarioCode: job.scenarioCode,
    baseScenarioVersion: job.baseScenarioVersion,
    summary: job.summary,
    errorCode: job.errorCode,
    result,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function createScenarioProvisioningService(dependencies: ScenarioProvisioningServiceDependencies) {
  const { repository, objectStorage } = dependencies;

  async function createJob(rawManifest: unknown): Promise<{ created: boolean; job: ScenarioProvisioningPublicJob }> {
    const parsed = parseScenarioProvisioningManifest(rawManifest);
    if (!parsed.ok) throw new ScenarioProvisioningWriteError("manifest_invalid", parsed.errors.join(" "), 400);
    if (!emailSenderAllowed(parsed.manifest.source.sender, dependencies.authorizedSenders)) {
      throw new ScenarioProvisioningWriteError("sender_unauthorized", "The manifest sender is not authorized for scenario provisioning.", 403);
    }
    const recordedSourceMessage = await repository.findMailMessage(
      parsed.manifest.source.mailboxKey,
      parsed.manifest.source.messageId,
    );
    const canonicalReplyMessage = recordedSourceMessage
      ? await repository.findMailMessageByReply(recordedSourceMessage.replyId)
      : null;
    if (recordedSourceMessage && canonicalReplyMessage?.id === recordedSourceMessage.id) {
      throw new ScenarioProvisioningWriteError(
        "mail_message_automation_authored",
        "Automation-authored mail cannot create or revise a scenario.",
        409,
      );
    }
    const manifestHash = await dependencies.hash(parsed.canonicalJson);
    const existing = await repository.findJobByIdempotencyKey(parsed.manifest.idempotencyKey);
    if (existing) {
      if (existing.manifestHash !== manifestHash) {
        throw new ScenarioProvisioningWriteError("idempotency_conflict", "That idempotency key already belongs to a different manifest.");
      }
      return { created: false, job: publicScenarioProvisioningJob(existing) };
    }
    const now = dependencies.now();
    if (await repository.countJobsCreatedSince(now - 60 * 60 * 1_000) >= SCENARIO_PROVISIONING_MAX_JOBS_PER_HOUR) {
      throw new ScenarioProvisioningWriteError("job_rate_limited", "The scenario provisioning job limit has been reached; retry later.", 429);
    }
    const revisionTarget = parsed.manifest.operation === "revise"
      ? await repository.findScenarioRevisionTarget(parsed.manifest.targetScenarioCode!)
      : null;
    if (parsed.manifest.operation === "revise" && !revisionTarget) {
      throw new ScenarioProvisioningWriteError("scenario_not_found", "The scenario to revise was not found.", 404);
    }
    const job: ScenarioProvisioningJobRecord = {
      id: dependencies.createId(),
      idempotencyKey: parsed.manifest.idempotencyKey,
      revision: parsed.manifest.revision,
      operation: parsed.manifest.operation,
      status: "received",
      manifestJson: parsed.canonicalJson,
      manifestHash,
      scenarioId: revisionTarget?.id ?? null,
      scenarioCode: parsed.manifest.targetScenarioCode,
      baseScenarioVersion: revisionTarget?.version ?? null,
      summary: "Scenario request accepted.",
      errorCode: null,
      resultJson: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await repository.createJob(job);
    } catch (error) {
      const raced = await repository.findJobByIdempotencyKey(parsed.manifest.idempotencyKey);
      if (!raced || raced.manifestHash !== manifestHash) throw error;
      return { created: false, job: publicScenarioProvisioningJob(raced) };
    }
    return { created: true, job: publicScenarioProvisioningJob(job) };
  }

  async function getJob(jobId: string): Promise<ScenarioProvisioningPublicJob> {
    const job = await requireJob(jobId);
    return publicScenarioProvisioningJob(job);
  }

  async function reserveMailReply(jobId: string, raw: unknown): Promise<{ created: boolean; reply: ScenarioProvisioningPublicMailReply }> {
    const replyKind = parseScenarioMailReplyKind(record(raw)?.kind);
    if (!replyKind) throw new ScenarioProvisioningWriteError("mail_reply_kind_invalid", "Mail reply kind must be clarification, ready, or failed.", 400);
    const job = await requireJob(jobId);
    if (job.status !== replyStatus(replyKind)) {
      throw new ScenarioProvisioningWriteError("mail_reply_status_invalid", `A ${replyKind} reply cannot be reserved while the job is ${job.status}.`);
    }
    const existing = await repository.findMailReply(jobId, replyKind);
    if (existing) return { created: false, reply: publicMailReply(existing) };
    const parsed = parseStoredManifest(job);
    const id = dependencies.createId();
    const reply: ScenarioProvisioningMailReplyRecord = {
      id,
      jobId,
      mailboxKey: parsed.manifest.source.mailboxKey,
      threadId: parsed.manifest.source.threadId,
      replyKind,
      responseMarker: scenarioMailResponseMarker(jobId, id),
      createdAt: dependencies.now(),
    };
    try {
      await repository.createMailReply(reply);
      return { created: true, reply: publicMailReply(reply) };
    } catch (error) {
      const raced = await repository.findMailReply(jobId, replyKind);
      if (!raced) throw error;
      return { created: false, reply: publicMailReply(raced) };
    }
  }

  async function recordMailReplyMessage(jobId: string, replyId: string, raw: unknown) {
    const item = record(raw);
    const providerMessageId = cleanScenarioProviderMessageId(item?.messageId);
    const threadId = cleanScenarioThreadId(item?.threadId);
    if (!providerMessageId || !threadId) throw new ScenarioProvisioningWriteError("mail_message_identity_invalid", "Valid Gmail message and thread IDs are required.", 400);
    await requireJob(jobId);
    const reply = await repository.findMailReplyById(replyId);
    if (!reply || reply.jobId !== jobId) throw new ScenarioProvisioningWriteError("mail_reply_not_found", "Mail reply reservation not found.", 404);
    if (reply.threadId !== threadId) throw new ScenarioProvisioningWriteError("mail_reply_thread_mismatch", "The sent Gmail reply did not remain in its reserved thread.");
    const result = await persistMailMessage(reply, providerMessageId);
    return { created: result.created, message: publicMailMessage(result.message), reply: publicMailReply(reply) };
  }

  async function classifyMailMessage(raw: unknown): Promise<ScenarioMailMessageClassification> {
    const item = record(raw);
    const mailboxKey = cleanScenarioMailboxKey(item?.mailboxKey);
    const providerMessageId = cleanScenarioProviderMessageId(item?.messageId);
    const threadId = cleanScenarioThreadId(item?.threadId);
    if (!mailboxKey || !providerMessageId || !threadId) {
      throw new ScenarioProvisioningWriteError("mail_identity_invalid", "Mailbox key, Gmail message ID, and Gmail thread ID are required.", 400);
    }
    const existing = await repository.findMailMessage(mailboxKey, providerMessageId);
    if (existing) {
      const canonical = await repository.findMailMessageByReply(existing.replyId);
      if (!canonical || canonical.id !== existing.id) {
        return { automationAuthored: false, recovered: false, reply: null };
      }
      const reply = await repository.findMailReplyById(existing.replyId);
      return { automationAuthored: true, recovered: false, reply: reply ? publicMailReply(reply) : null };
    }
    if (item?.responseMarker === undefined || item.responseMarker === null || item.responseMarker === "") {
      return { automationAuthored: false, recovered: false, reply: null };
    }
    const marker = parseScenarioMailResponseMarker(item.responseMarker);
    if (!marker) throw new ScenarioProvisioningWriteError("mail_response_marker_invalid", "The scenario reply marker is invalid.", 400);
    const reply = await repository.findMailReplyByMarker(marker.marker);
    if (!reply || reply.id !== marker.replyId || reply.jobId !== marker.jobId || reply.mailboxKey !== mailboxKey || reply.threadId !== threadId) {
      return { automationAuthored: false, recovered: false, reply: null };
    }
    if (await repository.findMailMessageByReply(reply.id)) {
      return { automationAuthored: false, recovered: false, reply: null };
    }
    await persistMailMessage(reply, providerMessageId);
    return { automationAuthored: true, recovered: true, reply: publicMailReply(reply) };
  }

  async function transition(jobId: string, to: ScenarioProvisioningJobStatus, summary: string, errorCode: string | null = null): Promise<ScenarioProvisioningPublicJob> {
    const job = await requireJob(jobId);
    const transitionError = scenarioProvisioningTransitionError(job.status, to);
    if (transitionError) throw new ScenarioProvisioningWriteError("status_transition_invalid", transitionError);
    if (job.status !== to) {
      const changed = await repository.updateJobStatus({
        jobId,
        from: job.status,
        to,
        summary: cleanSummary(summary),
        errorCode: to === "failed" ? cleanErrorCode(errorCode) : null,
        now: dependencies.now(),
      });
      if (!changed) throw new ScenarioProvisioningWriteError("job_changed", "The provisioning job changed while the update was being applied.");
    }
    return getJob(jobId);
  }

  async function stageAsset(jobId: string, assetId: string, contentType: string, bytes: Uint8Array): Promise<ScenarioProvisioningAssetRecord> {
    if (!objectStorage.available) throw new ScenarioProvisioningWriteError("storage_unavailable", "Scenario asset storage is unavailable.", 503);
    const job = await requireJob(jobId);
    if (job.status === "ready" || job.status === "finalizing") throw new ScenarioProvisioningWriteError("job_not_staging", "This job no longer accepts assets.");
    const parsed = parseStoredManifest(job);
    const spec = requiredScenarioProvisioningAssets(parsed.manifest).find((candidate) => candidate.id === assetId);
    if (!spec) throw new ScenarioProvisioningWriteError("asset_not_expected", "That asset is not declared by this manifest.", 404);
    const dimensions = validateAsset(spec, contentType, bytes);
    const sha256 = await dependencies.hash(bytes);
    const existing = await repository.findAsset(jobId, assetId);
    if (existing?.committedAt) throw new ScenarioProvisioningWriteError("asset_committed", "That asset is already committed.");
    if (existing?.sha256 === sha256 && existing.contentType === contentType) return existing;
    const r2Key = storageKey(jobId, spec, contentType, sha256);
    const operationId = dependencies.createId();
    const intentNow = dependencies.now();
    await repository.beginAssetWrite(operationId, r2Key, intentNow);
    try {
      await objectStorage.put(r2Key, bytes, contentType);
    } catch (error) {
      await repository.abandonAssetWrite(
        operationId,
        r2Key,
        "provisioning-storage-write-failed",
        dependencies.now(),
      ).catch(() => undefined);
      await objectStorage.reconcile().catch(() => undefined);
      throw error;
    }
    const asset: ScenarioProvisioningAssetRecord = {
      id: existing?.id ?? dependencies.createId(),
      jobId,
      assetId,
      kind: spec.kind,
      r2Key,
      contentType,
      width: dimensions.width,
      height: dimensions.height,
      byteLength: bytes.byteLength,
      sha256,
      committedAt: null,
      createdAt: existing?.createdAt ?? dependencies.now(),
    };
    let committed = false;
    try {
      committed = await repository.commitAssetWrite({
        operationId,
        asset,
        previousR2Key: existing?.r2Key ?? null,
        now: dependencies.now(),
      });
    } catch (error) {
      await repository.abandonAssetWrite(
        operationId,
        r2Key,
        "provisioning-metadata-write-failed",
        dependencies.now(),
      ).catch(() => undefined);
      await objectStorage.reconcile().catch(() => undefined);
      throw error;
    }
    if (!committed) {
      await repository.abandonAssetWrite(
        operationId,
        r2Key,
        "provisioning-asset-race-lost",
        dependencies.now(),
      ).catch(() => undefined);
      await objectStorage.reconcile().catch(() => undefined);
      throw new ScenarioProvisioningWriteError("asset_committed", "That asset was committed while the upload was being applied.");
    }
    await objectStorage.reconcile().catch(() => undefined);
    if (job.status !== "staging" && !scenarioProvisioningTransitionError(job.status, "staging")) {
      await repository.updateJobStatus({
        jobId,
        from: job.status,
        to: "staging",
        summary: "Prepared assets are being staged.",
        errorCode: null,
        now: dependencies.now(),
      });
    }
    return asset;
  }

  async function finalize(jobId: string): Promise<ScenarioProvisioningFinalizeResult> {
    let job = await requireJob(jobId);
    if (job.status === "ready" && job.resultJson) return JSON.parse(job.resultJson) as ScenarioProvisioningFinalizeResult;
    if (job.status === "finalizing") throw new ScenarioProvisioningWriteError("job_finalizing", "This job is already finalizing.");
    const parsed = parseStoredManifest(job);
    let assets = await repository.listAssets(jobId);
    validateCompleteAssetSet(parsed.manifest, assets);
    const transitionError = scenarioProvisioningTransitionError(job.status, "finalizing");
    if (transitionError) throw new ScenarioProvisioningWriteError("job_not_finalizable", transitionError);
    const now = dependencies.now();
    if (!await repository.updateJobStatus({
      jobId,
      from: job.status,
      to: "finalizing",
      summary: "Finalizing scenario records.",
      errorCode: null,
      now,
    })) throw new ScenarioProvisioningWriteError("job_changed", "The provisioning job changed before finalization.");
    job = { ...job, status: "finalizing", summary: "Finalizing scenario records.", updatedAt: now };
    try {
      // Claim the job before the authoritative asset read. Asset metadata commits
      // reject finalizing/ready jobs, so this snapshot cannot be replaced beneath
      // the D1 finalization batch.
      assets = await repository.listAssets(jobId);
      validateCompleteAssetSet(parsed.manifest, assets);
      const mapPackage = parsed.manifest.map ? buildProvisionedMapPackage(parsed.manifest.map, jobId, now) : null;
      const result = await repository.finalize({
        job,
        manifest: parsed.manifest,
        mapPackage,
        assets,
        now,
        createId: dependencies.createId,
      });
      await objectStorage.reconcile().catch(() => undefined);
      return result;
    } catch (error) {
      const writeError = error instanceof ScenarioProvisioningWriteError ? error : null;
      await repository.updateJobStatus({
        jobId,
        from: "finalizing",
        to: "failed",
        summary: writeError?.message ?? "Scenario finalization failed safely.",
        errorCode: writeError?.code ?? "finalization_failed",
        now: dependencies.now(),
      }).catch(() => undefined);
      await objectStorage.reconcile().catch(() => undefined);
      throw error;
    }
  }

  async function requireJob(jobId: string): Promise<ScenarioProvisioningJobRecord> {
    const job = await repository.findJobById(jobId);
    if (!job) throw new ScenarioProvisioningWriteError("job_not_found", "Provisioning job not found.", 404);
    return job;
  }

  async function persistMailMessage(reply: ScenarioProvisioningMailReplyRecord, providerMessageId: string) {
    const existing = await repository.findMailMessage(reply.mailboxKey, providerMessageId);
    if (existing) {
      if (existing.replyId !== reply.id) throw new ScenarioProvisioningWriteError("mail_message_conflict", "That Gmail message is already associated with another reply.");
      return { created: false, message: existing };
    }
    const recordedReplyMessage = await repository.findMailMessageByReply(reply.id);
    if (recordedReplyMessage) {
      throw new ScenarioProvisioningWriteError("mail_reply_message_conflict", "That reserved reply already has a different Gmail message ID.");
    }
    const message: ScenarioProvisioningMailMessageRecord = {
      id: dependencies.createId(),
      replyId: reply.id,
      mailboxKey: reply.mailboxKey,
      threadId: reply.threadId,
      providerMessageId,
      recordedAt: dependencies.now(),
    };
    if (await repository.recordMailMessage(message)) return { created: true, message };
    const raced = await repository.findMailMessage(reply.mailboxKey, providerMessageId);
    if (!raced || raced.replyId !== reply.id) {
      if (await repository.findMailMessageByReply(reply.id)) {
        throw new ScenarioProvisioningWriteError("mail_reply_message_conflict", "That reserved reply already has a different Gmail message ID.");
      }
      throw new ScenarioProvisioningWriteError("mail_message_conflict", "That Gmail message is already associated with another reply.");
    }
    return { created: false, message: raced };
  }

  return {
    createJob,
    getJob,
    reserveMailReply,
    recordMailReplyMessage,
    classifyMailMessage,
    transition,
    stageAsset,
    finalize,
  };
}

function publicMailReply(reply: ScenarioProvisioningMailReplyRecord): ScenarioProvisioningPublicMailReply {
  return {
    id: reply.id,
    jobId: reply.jobId,
    replyKind: reply.replyKind,
    responseMarker: reply.responseMarker,
    createdAt: reply.createdAt,
  };
}

function publicMailMessage(message: ScenarioProvisioningMailMessageRecord) {
  return {
    id: message.id,
    replyId: message.replyId,
    messageId: message.providerMessageId,
    recordedAt: message.recordedAt,
  };
}

function replyStatus(replyKind: ScenarioMailReplyKind): ScenarioProvisioningJobStatus {
  if (replyKind === "clarification") return "needs_clarification";
  return replyKind;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseStoredManifest(job: ScenarioProvisioningJobRecord) {
  let raw: unknown;
  try { raw = JSON.parse(job.manifestJson); } catch { throw new ScenarioProvisioningWriteError("manifest_corrupt", "The stored manifest is invalid.", 500); }
  const parsed = parseScenarioProvisioningManifest(raw);
  if (!parsed.ok) throw new ScenarioProvisioningWriteError("manifest_corrupt", "The stored manifest no longer validates.", 500);
  return parsed;
}

function validateAsset(spec: ScenarioProvisioningAssetSpec, contentType: string, bytes: Uint8Array): { width: number; height: number } {
  if (!spec.contentTypes.includes(contentType)) throw new ScenarioProvisioningWriteError("asset_type_invalid", `Asset ${spec.id} must use ${spec.contentTypes.join(" or ")}.`, 400);
  if (bytes.byteLength < 1 || bytes.byteLength > spec.maxBytes) throw new ScenarioProvisioningWriteError("asset_size_invalid", `Asset ${spec.id} exceeds its byte limit.`, 413);
  if (spec.kind === "map" || spec.kind.startsWith("handout-")) {
    const dimensions = inspectStoredHandout(bytes, contentType);
    if (!dimensions) throw new ScenarioProvisioningWriteError("asset_image_invalid", `Asset ${spec.id} is not a readable image.`, 400);
    if (spec.kind === "map") {
      if (dimensions.width !== spec.expectedWidth || dimensions.height !== spec.expectedHeight) {
        throw new ScenarioProvisioningWriteError("map_dimensions_invalid", `Map ${spec.id} must be ${spec.expectedWidth}×${spec.expectedHeight}.`, 400);
      }
    } else {
      const error = storedHandoutVariantError({
        variant: spec.kind === "handout-display" ? "display" : "thumbnail",
        contentType,
        byteLength: bytes.byteLength,
        width: dimensions.width,
        height: dimensions.height,
      });
      if (error) throw new ScenarioProvisioningWriteError("handout_invalid", error, 400);
    }
    return dimensions;
  }
  const dimensions = inspectPng(bytes);
  if (!dimensions) throw new ScenarioProvisioningWriteError("creature_image_invalid", `Asset ${spec.id} is not a readable PNG.`, 400);
  const maximum = spec.kind === "creature-thumbnail" ? 512 : 2_048;
  const minimum = spec.kind === "creature-thumbnail" ? 32 : 128;
  if (dimensions.width < minimum || dimensions.height < minimum || dimensions.width > maximum || dimensions.height > maximum) {
    throw new ScenarioProvisioningWriteError("creature_image_dimensions_invalid", `Asset ${spec.id} has invalid creature-art dimensions.`, 400);
  }
  return dimensions;
}

function validateCompleteAssetSet(manifest: ReturnType<typeof parseStoredManifest>["manifest"], assets: ScenarioProvisioningAssetRecord[]) {
  const expected = requiredScenarioProvisioningAssets(manifest);
  const byId = new Map(assets.map((asset) => [asset.assetId, asset]));
  const missing = expected.filter((spec) => !byId.has(spec.id));
  if (missing.length) throw new ScenarioProvisioningWriteError("assets_missing", `Missing prepared assets: ${missing.map((asset) => asset.id).join(", ")}.`);
  for (const spec of expected) {
    const asset = byId.get(spec.id)!;
    if (asset.kind !== spec.kind || !spec.contentTypes.includes(asset.contentType) || asset.byteLength > spec.maxBytes) {
      throw new ScenarioProvisioningWriteError("asset_mismatch", `Prepared asset ${spec.id} does not match its manifest declaration.`);
    }
  }
  for (const handout of manifest.handouts) {
    const display = byId.get(handout.displayAssetId)!;
    const thumbnail = byId.get(handout.thumbnailAssetId)!;
    if (display.contentType !== thumbnail.contentType) throw new ScenarioProvisioningWriteError("handout_format_mismatch", `Handout ${handout.id} variants must use the same format.`);
  }
}

function storageKey(jobId: string, spec: ScenarioProvisioningAssetSpec, contentType: string, sha256: string): string {
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
  return `scenario-provisioning/${jobId}/${spec.kind}/${spec.id}/${sha256}.${extension}`;
}

function cleanSummary(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 500);
}

function cleanErrorCode(value: string | null): string | null {
  return value ? value.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80) : null;
}
