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
import type {
  ScenarioProvisioningAssetRecord,
  ScenarioProvisioningFinalizeResult,
  ScenarioProvisioningJobRecord,
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
    await objectStorage.put(r2Key, bytes, contentType);
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
    if (!await repository.upsertAsset(asset)) {
      await objectStorage.delete(r2Key).catch(() => undefined);
      throw new ScenarioProvisioningWriteError("asset_committed", "That asset was committed while the upload was being applied.");
    }
    if (existing && existing.r2Key !== r2Key) await objectStorage.delete(existing.r2Key).catch(() => undefined);
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
    const assets = await repository.listAssets(jobId);
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
      const mapPackage = parsed.manifest.map ? buildProvisionedMapPackage(parsed.manifest.map, jobId, now) : null;
      return await repository.finalize({ job, manifest: parsed.manifest, mapPackage, assets, now, createId: dependencies.createId });
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
      throw error;
    }
  }

  async function requireJob(jobId: string): Promise<ScenarioProvisioningJobRecord> {
    const job = await repository.findJobById(jobId);
    if (!job) throw new ScenarioProvisioningWriteError("job_not_found", "Provisioning job not found.", 404);
    return job;
  }

  return { createJob, getJob, transition, stageAsset, finalize };
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
