import {
  SCENARIO_PROVISIONING_MAX_MANIFEST_BYTES,
  SCENARIO_PROVISIONING_MAP_MAX_BYTES,
  isScenarioProvisioningJobStatus,
} from "../shared/scenario-provisioning.ts";
import { bearerSecretMatches, parseEmailAllowlist } from "../shared/secret-auth.ts";
import { createD1ScenarioProvisioningRepository, createR2ScenarioProvisioningStorage } from "./adapters/d1-scenario-provisioning-repository.ts";
import { ScenarioProvisioningWriteError } from "./ports/scenario-provisioning-repository.ts";
import { createScenarioProvisioningService } from "./scenario-provisioning-service.ts";
import type { Env } from "./types.ts";

const JOB_ROUTE = /^\/api\/scenario-provisioning\/jobs(?:\/([a-zA-Z0-9-]{1,64})(?:\/(assets\/([a-zA-Z0-9._-]{1,96})|finalize))?)?$/;
const STATUS_BODY_MAX_BYTES = 4_096;
const PATCHABLE_STATUSES = new Set([
  "parsing",
  "needs_clarification",
  "generating",
  "researching_creatures",
  "validating",
  "staging",
  "failed",
]);

export async function handleScenarioProvisioningApi(request: Request, env: Env): Promise<Response> {
  if (!bearerSecretMatches(request.headers.get("authorization"), env.SCENARIO_PROVISIONING_TOKEN)) {
    return json({ error: "Scenario provisioning authorization failed.", code: "unauthorized" }, { status: 401 });
  }
  const match = new URL(request.url).pathname.match(JOB_ROUTE);
  if (!match) return json({ error: "Scenario provisioning route not found.", code: "not_found" }, { status: 404 });
  const [, jobId, child, assetId] = match;
  const service = createScenarioProvisioningService({
    repository: createD1ScenarioProvisioningRepository(env.DB),
    objectStorage: createR2ScenarioProvisioningStorage(env.MAP_ASSETS),
    createId: () => crypto.randomUUID(),
    now: () => Date.now(),
    hash: sha256,
    authorizedSenders: parseEmailAllowlist(env.SCENARIO_PROVISIONING_SENDERS),
  });

  try {
    if (!jobId) {
      if (request.method !== "POST") return methodNotAllowed("POST");
      const manifest = await readJsonBody(request, SCENARIO_PROVISIONING_MAX_MANIFEST_BYTES);
      const result = await service.createJob(manifest);
      return json(result, { status: result.created ? 201 : 200 });
    }
    if (child?.startsWith("assets/")) {
      if (request.method !== "PUT") return methodNotAllowed("PUT");
      const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      const contentLength = parseContentLength(request.headers.get("content-length"));
      if (contentLength === null) throw new ScenarioProvisioningWriteError("asset_size_invalid", "The asset Content-Length is invalid.", 400);
      if (contentLength === undefined) throw new ScenarioProvisioningWriteError("length_required", "Asset uploads require Content-Length.", 411);
      if (contentLength > SCENARIO_PROVISIONING_MAP_MAX_BYTES) throw new ScenarioProvisioningWriteError("asset_size_invalid", "The uploaded asset exceeds the provisioning byte limit.", 413);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (contentLength !== bytes.byteLength) {
        throw new ScenarioProvisioningWriteError("asset_size_invalid", "The uploaded asset length does not match Content-Length.", 400);
      }
      const asset = await service.stageAsset(jobId, assetId!, contentType, bytes);
      return json({
        asset: {
          id: asset.assetId,
          kind: asset.kind,
          contentType: asset.contentType,
          width: asset.width,
          height: asset.height,
          byteLength: asset.byteLength,
          sha256: asset.sha256,
        },
      });
    }
    if (child === "finalize") {
      if (request.method !== "POST") return methodNotAllowed("POST");
      return json({ result: await service.finalize(jobId) });
    }
    if (child) return json({ error: "Scenario provisioning route not found.", code: "not_found" }, { status: 404 });
    if (request.method === "GET") return json({ job: await service.getJob(jobId) });
    if (request.method === "PATCH") {
      const body = await readJsonBody(request, STATUS_BODY_MAX_BYTES);
      const status = body.status;
      if (!isScenarioProvisioningJobStatus(status) || !PATCHABLE_STATUSES.has(status)) {
        throw new ScenarioProvisioningWriteError("status_invalid", "That workflow status cannot be set through this endpoint.", 400);
      }
      const summary = typeof body.summary === "string" ? body.summary : "";
      const errorCode = typeof body.errorCode === "string" ? body.errorCode : null;
      return json({ job: await service.transition(jobId, status, summary, errorCode) });
    }
    return methodNotAllowed("GET, PATCH");
  } catch (error) {
    if (error instanceof ScenarioProvisioningWriteError) {
      return json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Scenario provisioning API error", error);
    return json({ error: "The scenario provisioning request failed safely.", code: "internal_error" }, { status: 500 });
  }
}

function parseContentLength(value: string | null): number | null | undefined {
  if (value === null) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function readJsonBody(request: Request, maximumBytes: number): Promise<Record<string, unknown>> {
  const length = parseContentLength(request.headers.get("content-length"));
  if (length === null) throw new ScenarioProvisioningWriteError("request_size_invalid", "The request Content-Length is invalid.", 400);
  if (length === undefined) throw new ScenarioProvisioningWriteError("length_required", "JSON requests require Content-Length.", 411);
  if (length > maximumBytes) throw new ScenarioProvisioningWriteError("request_too_large", "The JSON request is too large.", 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new ScenarioProvisioningWriteError("request_too_large", "The JSON request is too large.", 413);
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new ScenarioProvisioningWriteError("json_invalid", "The request body must be a JSON object.", 400);
  }
}

async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function methodNotAllowed(allow: string): Response {
  return json({ error: "Method not allowed.", code: "method_not_allowed" }, { status: 405, headers: { allow } });
}

function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(value), { ...init, headers });
}
