import type {
  ScenarioProvisioningAssetKind,
  ScenarioProvisioningJobStatus,
  ScenarioProvisioningManifest,
} from "../../shared/scenario-provisioning.ts";
import type { MapPackage } from "../../shared/map-package.ts";
import type { ScenarioMailReplyKind } from "../../shared/scenario-mail-provenance.ts";

export type ScenarioProvisioningJobRecord = {
  id: string;
  idempotencyKey: string;
  revision: number;
  operation: "create" | "revise";
  status: ScenarioProvisioningJobStatus;
  manifestJson: string;
  manifestHash: string;
  scenarioId: string | null;
  scenarioCode: string | null;
  baseScenarioVersion: number | null;
  summary: string;
  errorCode: string | null;
  resultJson: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ScenarioProvisioningAssetRecord = {
  id: string;
  jobId: string;
  assetId: string;
  kind: ScenarioProvisioningAssetKind;
  r2Key: string;
  contentType: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  committedAt: number | null;
  createdAt: number;
};

export type ScenarioProvisioningMailReplyRecord = {
  id: string;
  jobId: string;
  mailboxKey: string;
  threadId: string;
  replyKind: ScenarioMailReplyKind;
  responseMarker: string;
  createdAt: number;
};

export type ScenarioProvisioningMailMessageRecord = {
  id: string;
  replyId: string;
  mailboxKey: string;
  threadId: string;
  providerMessageId: string;
  recordedAt: number;
};

export type ScenarioProvisioningFinalizeResult = {
  jobId: string;
  status: "ready";
  scenario: { id: string; code: string; name: string };
  mapImageId: string | null;
  handoutIds: string[];
  placedTokenIds: string[];
  createdCatalogIds: string[];
  reusedCatalogIds: string[];
  assumptions: string[];
  reviewWarnings: string[];
};

export class ScenarioProvisioningWriteError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status = 409,
  ) {
    super(message);
    this.name = "ScenarioProvisioningWriteError";
    this.code = code;
    this.status = status;
  }
}

export interface ScenarioProvisioningRepository {
  findJobByIdempotencyKey(idempotencyKey: string): Promise<ScenarioProvisioningJobRecord | null>;
  findJobById(jobId: string): Promise<ScenarioProvisioningJobRecord | null>;
  countJobsCreatedSince(timestamp: number): Promise<number>;
  findScenarioRevisionTarget(code: string): Promise<{ id: string; code: string; version: number } | null>;
  createJob(job: ScenarioProvisioningJobRecord): Promise<void>;
  updateJobStatus(input: {
    jobId: string;
    from: ScenarioProvisioningJobStatus;
    to: ScenarioProvisioningJobStatus;
    summary: string;
    errorCode: string | null;
    now: number;
  }): Promise<boolean>;
  findAsset(jobId: string, assetId: string): Promise<ScenarioProvisioningAssetRecord | null>;
  listAssets(jobId: string): Promise<ScenarioProvisioningAssetRecord[]>;
  beginAssetWrite(operationId: string, r2Key: string, now: number): Promise<void>;
  commitAssetWrite(input: {
    operationId: string;
    asset: ScenarioProvisioningAssetRecord;
    previousR2Key: string | null;
    now: number;
  }): Promise<boolean>;
  abandonAssetWrite(operationId: string, r2Key: string, reason: string, now: number): Promise<void>;
  findMailReply(jobId: string, replyKind: ScenarioMailReplyKind): Promise<ScenarioProvisioningMailReplyRecord | null>;
  findMailReplyById(replyId: string): Promise<ScenarioProvisioningMailReplyRecord | null>;
  findMailReplyByMarker(responseMarker: string): Promise<ScenarioProvisioningMailReplyRecord | null>;
  createMailReply(reply: ScenarioProvisioningMailReplyRecord): Promise<void>;
  findMailMessage(mailboxKey: string, providerMessageId: string): Promise<ScenarioProvisioningMailMessageRecord | null>;
  recordMailMessage(message: ScenarioProvisioningMailMessageRecord): Promise<boolean>;
  finalize(input: {
    job: ScenarioProvisioningJobRecord;
    manifest: ScenarioProvisioningManifest;
    mapPackage: MapPackage | null;
    assets: ScenarioProvisioningAssetRecord[];
    now: number;
    createId(): string;
  }): Promise<ScenarioProvisioningFinalizeResult>;
  findCommittedMapAsset(jobId: string, assetId: string): Promise<Pick<ScenarioProvisioningAssetRecord, "r2Key" | "contentType"> | null>;
}

export interface ScenarioProvisioningObjectStorage {
  readonly available: boolean;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  get(key: string): Promise<R2ObjectBody | null>;
  reconcile(): Promise<void>;
}
