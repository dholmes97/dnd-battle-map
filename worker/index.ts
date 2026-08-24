import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  CHARACTER_ART_ASSETS,
  type CreatureSize,
  isCreatureSize,
} from "../shared/creature-library";
import { hydrateMapPackage, parseMapSetup } from "../shared/map-package";
import {
  baseTokenControllerName,
  identityControlsToken,
  resolveTokenControllerName,
} from "../shared/token-control.ts";
import { deriveHistoryActionIds, isReversibleHistoryRow } from "../shared/action-history.ts";
import { healthBand } from "../shared/health.ts";
import { movementPolicyDenial } from "../shared/battle-map-policies.ts";
import { transitionTokenMove } from "../shared/encounter-transitions.ts";
import { normalizeAltitude } from "../shared/token-altitude.ts";
import { pointVisibleToViewer, visibilityForViewer } from "../shared/fog-of-war.ts";
import {
  mapPackageForViewer,
} from "../shared/encounter-domain.ts";
import {
  chatMessageVisibleToViewer,
} from "../shared/chat-domain.ts";
import {
  HANDOUT_DISPLAY_MAX_BYTES,
  HANDOUT_MAX_PER_SCENARIO,
  HANDOUT_THUMBNAIL_MAX_BYTES,
  cleanHandoutTitle,
  handoutVisibleToViewer,
  inspectStoredHandout,
  storedHandoutVariantError,
} from "../shared/handout-domain.ts";
import {
  SPELL_EFFECT_KIND,
  SPELL_EFFECTS,
} from "../shared/spell-effects";
import {
  type CommandName,
  type CommandPayload,
  type EncounterState,
  type SharedToken,
} from "../shared/contracts";
import { parseCommandRequest } from "../shared/command-parser.ts";
import { bearerSecretMatches } from "../shared/secret-auth.ts";
import { annotationGeometryIsBounded } from "../shared/annotation-geometry.ts";
import { inspectCatalogPng, type CatalogImageVariant } from "../shared/catalog-image.ts";
import { indexRowsByKey } from "../shared/projection-index.ts";
import {
  cleanCorrelationId,
  correlationSampleSelected,
  OPERATION_ID_HEADER,
  REQUEST_ID_HEADER,
  requestOutcome,
} from "../shared/request-correlation.ts";
import {
  API_JSON_BODY_MAX_BYTES,
  CATALOG_IMAGE_MAX_BYTES,
  CATALOG_IMAGE_MAX_ENCODED_CHARACTERS,
  CATALOG_IMPORT_JSON_MAX_BYTES,
  CATALOG_IMPORT_MAX_DECODED_BYTES,
  HANDOUT_MULTIPART_MAX_BYTES,
  MAX_ACTIONS_PER_ENCOUNTER,
  MAX_ANNOTATIONS_PER_ENCOUNTER,
  MAX_CATALOG_ENTRIES,
  MAX_CATALOG_FAMILIES,
  MAX_EFFECTS_PER_ENCOUNTER,
  MAX_HANDOUT_ROWS_PER_ENCOUNTER,
  MAX_MAP_IMAGES,
  MAX_PARTICIPANTS_PER_ENCOUNTER,
  MAX_SCENARIOS,
  MAX_TOKENS_PER_ENCOUNTER,
  RATE_LIMIT_POLICIES,
} from "../shared/resource-limits.ts";
import {
  deleteHandout,
  sendChatMessage,
  type ChatHandoutCommandContext,
} from "./commands/chat-handout-commands";
import type { CommandOutcome } from "./commands/types";
import { createD1ChatHandoutRepository, createR2HandoutObjectStorage } from "./adapters/d1-chat-handout-repository";
import {
  addAnnotation,
  clearAnnotations,
  removeAnnotation,
  setFogMode,
  setStrictMovement,
  setVisionDoorOpen,
  updateSharedFog,
  type AnnotationFogCommandContext,
} from "./commands/annotation-fog-commands";
import { createD1AnnotationFogRepository } from "./adapters/d1-annotation-fog-repository";
import {
  applyMapDraft,
  configureEncounter,
  createScenario,
  discardMapDraft,
  renameScenario,
  saveMapDraft,
  type ScenarioMapCommandContext,
} from "./commands/scenario-map-commands";
import { createD1ScenarioMapRepository } from "./adapters/d1-scenario-map-repository";
import { hydrateStoredMap, legacyMapPackage, mapImageFromRow } from "./map-images.ts";
import {
  advanceTurn,
  correctTurn,
  setInitiative,
  setInitiativeGroup,
  startCombat,
  type InitiativeCombatCommandContext,
} from "./commands/initiative-combat-commands";
import { createD1InitiativeCombatRepository } from "./adapters/d1-initiative-combat-repository";
import {
  addEffect,
  applyHp,
  createSpellEffect,
  createToken,
  deleteToken,
  removeEffect,
  resizeSpellEffect,
  updateToken,
  type TokenEffectCommandContext,
} from "./commands/token-effect-commands";
import { createD1TokenEffectRepository } from "./adapters/d1-token-effect-repository";
import { redo, undo, type HistoryCommandContext } from "./commands/history-commands";
import { createD1HistoryRepository } from "./adapters/d1-history-repository";
import { createD1MutationUnitOfWork } from "./adapters/d1-mutation-unit-of-work.ts";
import { MutationConflictError } from "./ports/mutation-unit-of-work.ts";
import {
  abandonStorageWriteIntent,
  createStorageWriteIntent,
  queueStorageCleanupStatement,
  reconcileStorageLifecycle,
} from "./adapters/d1-storage-lifecycle.ts";
import { createD1ScenarioProvisioningRepository } from "./adapters/d1-scenario-provisioning-repository.ts";
import {
  acquireOperationLease,
  consumeRateLimit,
  releaseOperationLease,
  type RateLimitPolicy,
} from "./adapters/d1-request-guard.ts";
import {
  RequestBodyError,
  readBoundedFormData,
  readBoundedJsonObject,
} from "./request-security.ts";
import { handleScenarioProvisioningApi } from "./scenario-provisioning-api.ts";
import type {
  ActionRow,
  AnnotationRow,
  ChatMessageRow,
  CreatureCatalogRow,
  EffectRow,
  EncounterRow,
  Env,
  HandoutRow,
  MapImageRow,
  ParticipantRow,
  TokenRow,
  WorkerExecutionContext,
} from "./types";

const API_ROUTE =
  /^\/api\/encounters\/([^/]+)\/(join|state|events|heartbeat|move|command)$/;
const HANDOUT_API_ROUTE =
  /^\/api\/encounters\/([^/]+)\/handouts(?:\/([^/]+)(?:\/(thumbnail|display))?)?$/;
const PRODUCTION_BACKUP_ROUTE = /^\/api\/admin\/production-backup\/(d1|r2(?:\/object)?)$/;

const PRODUCTION_BACKUP_PAGE_SIZE = 100;

let schemaReady: Promise<void> | null = null;

async function handleMapAsset(request: Request, env: Env, key: string): Promise<Response> {
  await ensureSchema(env);
  const provisioned = key.match(/^provisioned\/([a-zA-Z0-9-]{1,64})\/([a-zA-Z0-9._-]{1,96})\.jpg$/);
  if (provisioned) {
    const asset = await createD1ScenarioProvisioningRepository(env.DB)
      .findCommittedMapAsset(provisioned[1], provisioned[2]);
    if (!asset || !env.MAP_ASSETS) return new Response("Not found", { status: 404 });
    const stored = await env.MAP_ASSETS.get(asset.r2Key);
    if (!stored) return new Response("Map asset unavailable", { status: 503 });
    return new Response(stored.body, {
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
        "content-type": asset.contentType,
        "etag": stored.httpEtag,
        "x-map-asset-source": "provisioned-r2",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (!/^[a-z0-9/_-]+\.(?:jpg|png)$/i.test(key)) return new Response("Not found", { status: 404 });
  const registered = await env.DB.prepare(
    "SELECT 1 AS found FROM map_images WHERE asset_path = ? LIMIT 1",
  ).bind(`/map-assets/${key}`).first();
  if (!registered) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "cache-control": "public, max-age=31536000, immutable",
    "content-type": key.endsWith(".jpg") ? "image/jpeg" : "image/png",
  });
  if (env.MAP_ASSETS) {
    const stored = await env.MAP_ASSETS.get(key);
    if (stored) {
      headers.set("etag", stored.httpEtag);
      headers.set("x-map-asset-source", "r2");
      return new Response(stored.body, { headers });
    }
  }
  const seedUrl = new URL(`/assets/full-map-seeds/${key}`, request.url);
  if (!env.ASSETS) {
    return Response.redirect(seedUrl, 307);
  }
  const seedRequest = new Request(seedUrl);
  const seed = await env.ASSETS.fetch(seedRequest);
  if (!seed.ok || !seed.body) return new Response("Map asset unavailable", { status: 503 });
  const bytes = await seed.arrayBuffer();
  if (env.MAP_ASSETS) {
    await env.MAP_ASSETS.put(key, bytes, { httpMetadata: { contentType: headers.get("content-type") ?? undefined, cacheControl: headers.get("cache-control") ?? undefined } });
    headers.set("x-map-asset-source", "seeded-r2");
  } else headers.set("x-map-asset-source", "packaged-fallback");
  return new Response(bytes, { headers });
}

function cleanCreatureAssetKey(value: string): string {
  try {
    const key = decodeURIComponent(value);
    return /^tokens\/[a-z0-9/_-]+\.(?:png|webp|jpe?g)$/i.test(key) ? key : "";
  } catch {
    return "";
  }
}

function creatureContentType(key: string): string {
  if (/\.webp$/i.test(key)) return "image/webp";
  if (/\.jpe?g$/i.test(key)) return "image/jpeg";
  return "image/png";
}

async function creatureAssetBytes(env: Env, request: Request, key: string): Promise<ArrayBuffer | null> {
  const storageKey = `creature-catalog/original/${key}`;
  if (env.MAP_ASSETS) {
    const stored = await env.MAP_ASSETS.get(storageKey);
    if (stored) return stored.arrayBuffer();
  }
  if (!env.ASSETS) return null;
  const seeded = await env.ASSETS.fetch(new Request(new URL(`/assets/${key}`, request.url)));
  if (!seeded.ok) return null;
  const bytes = await seeded.arrayBuffer();
  if (env.MAP_ASSETS) {
    await env.MAP_ASSETS.put(storageKey, bytes, {
      httpMetadata: {
        contentType: creatureContentType(key),
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
  }
  return bytes;
}

async function handleCreatureAsset(request: Request, env: Env, rawKey: string): Promise<Response> {
  const key = cleanCreatureAssetKey(rawKey);
  if (!key) return new Response("Not found", { status: 404 });
  const thumbnail = new URL(request.url).searchParams.get("variant") === "thumbnail";
  const provisioned = key.match(/^tokens\/provisioned\/([a-zA-Z0-9-]{1,64})\/([a-zA-Z0-9._-]{1,96})\.png$/);
  if (provisioned) {
    const committed = await env.DB.prepare(
      `SELECT a.r2_key
       FROM scenario_provisioning_assets a
       JOIN scenario_provisioning_jobs j ON j.id = a.job_id
       WHERE a.job_id = ? AND a.asset_id = ? AND a.kind = ?
         AND a.committed_at IS NOT NULL AND j.status = 'ready' LIMIT 1`,
    ).bind(provisioned[1], provisioned[2], thumbnail ? "creature-thumbnail" : "creature-original")
      .first<{ r2_key: string }>();
    if (!committed) return new Response("Not found", { status: 404 });
    if (!env.MAP_ASSETS) return new Response("Creature asset unavailable", { status: 503 });
    const stored = await env.MAP_ASSETS.get(committed.r2_key);
    if (!stored) return new Response("Creature asset unavailable", { status: 503 });
    return new Response(stored.body, {
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
        "content-type": "image/png",
        "etag": stored.httpEtag,
        "x-creature-asset-source": thumbnail ? "provisioned-r2-thumbnail" : "provisioned-r2-original",
        "x-content-type-options": "nosniff",
      },
    });
  }
  const cacheHeaders = { "cache-control": "public, max-age=31536000, immutable" };
  const thumbnailKey = `creature-catalog/thumbnails/${key}`;
  if (thumbnail && env.MAP_ASSETS) {
    const stored = await env.MAP_ASSETS.get(thumbnailKey);
    if (stored) {
      return new Response(stored.body, { headers: { ...cacheHeaders, "content-type": creatureContentType(key), "x-creature-asset-source": "r2-thumbnail" } });
    }
  }
  if (thumbnail && env.ASSETS) {
    const seeded = await env.ASSETS.fetch(new Request(new URL(`/assets/creature-thumbnails/${key}`, request.url)));
    if (seeded.ok) {
      const thumbnailBytes = await seeded.arrayBuffer();
      if (env.MAP_ASSETS) {
        await env.MAP_ASSETS.put(thumbnailKey, thumbnailBytes, {
          httpMetadata: { contentType: creatureContentType(key), cacheControl: cacheHeaders["cache-control"] },
        });
      }
      return new Response(thumbnailBytes, { headers: { ...cacheHeaders, "content-type": creatureContentType(key), "x-creature-asset-source": env.MAP_ASSETS ? "seeded-r2-thumbnail" : "packaged-thumbnail" } });
    }
  }
  const bytes = await creatureAssetBytes(env, request, key);
  if (!bytes) {
    const fallbackPath = thumbnail ? `/assets/creature-thumbnails/${key}` : `/assets/${key}`;
    return Response.redirect(new URL(fallbackPath, request.url), 307);
  }
  if (thumbnail && env.IMAGES) {
    const input = new Response(bytes).body;
    if (input) {
      const transformed = await env.IMAGES.input(input)
        .transform({ width: 144, height: 144, fit: "contain" })
        .output({ format: "image/png", quality: 80 });
      const thumbnailBytes = await transformed.response().arrayBuffer();
      if (env.MAP_ASSETS) {
        await env.MAP_ASSETS.put(thumbnailKey, thumbnailBytes, {
          httpMetadata: { contentType: "image/png", cacheControl: cacheHeaders["cache-control"] },
        });
      }
      return new Response(thumbnailBytes, { headers: { ...cacheHeaders, "content-type": "image/png", "x-creature-asset-source": "generated-thumbnail" } });
    }
  }
  return new Response(bytes, { headers: { ...cacheHeaders, "content-type": creatureContentType(key), "x-creature-asset-source": thumbnail ? "original-thumbnail-fallback" : "r2-original" } });
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { ...init, headers });
}

type ProjectionTelemetry = {
  durationMs: number;
  collectionReads: number;
  rows: {
    tokens: number;
    effects: number;
    annotations: number;
    chatMessages: number;
    handouts: number;
    mapImages: number;
  };
};

type ApiRequestTelemetry = {
  requestId: string;
  operationId: string | null;
  route: string;
  method: string;
  startedAt: number;
  projection: ProjectionTelemetry | null;
};

function createApiRequestTelemetry(request: Request, route: string): ApiRequestTelemetry {
  return {
    requestId: crypto.randomUUID(),
    operationId: cleanCorrelationId(request.headers.get(OPERATION_ID_HEADER)),
    route,
    method: request.method,
    startedAt: performance.now(),
    projection: null,
  };
}

function finishApiRequest(response: Response, telemetry: ApiRequestTelemetry): Response {
  const durationMs = Math.max(0, performance.now() - telemetry.startedAt);
  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, telemetry.requestId);
  if (telemetry.operationId) headers.set(OPERATION_ID_HEADER, telemetry.operationId);
  const timings = [`request;dur=${durationMs.toFixed(1)}`];
  if (telemetry.projection) timings.push(`projection;dur=${telemetry.projection.durationMs.toFixed(1)}`);
  headers.set("server-timing", timings.join(", "));

  const unchangedPoll = telemetry.route === "events" && response.status === 204;
  const sampleDenominator = unchangedPoll ? 32 : 1;
  if (!unchangedPoll || correlationSampleSelected(telemetry.requestId, sampleDenominator)) {
    console.info(JSON.stringify({
      event: "api_request_completed",
      requestId: telemetry.requestId,
      operationId: telemetry.operationId,
      route: telemetry.route,
      method: telemetry.method,
      status: response.status,
      outcome: requestOutcome(response.status),
      durationMs: Math.round(durationMs * 10) / 10,
      sampleDenominator,
      projection: telemetry.projection,
    }));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function knownRequestFailure(error: unknown): Response | null {
  if (error instanceof RequestBodyError) {
    return json({ error: error.message, code: error.code }, { status: error.status });
  }
  const limit = String(error).match(/resource_limit:([a-z_]+)/)?.[1];
  if (limit) {
    return json(
      { error: `This scenario has reached its ${limit.replaceAll("_", " ")} limit.`, code: "resource_limit" },
      { status: 409 },
    );
  }
  return null;
}

function apiFailure(
  error: unknown,
  label: string,
  fallback: string,
  telemetry?: ApiRequestTelemetry,
): Response {
  const known = knownRequestFailure(error);
  if (known) return known;
  console.error(JSON.stringify({
    event: "api_request_failed",
    requestId: telemetry?.requestId ?? null,
    operationId: telemetry?.operationId ?? null,
    route: telemetry?.route ?? null,
    label,
    errorType: error instanceof Error ? error.name : typeof error,
  }));
  return json({ error: fallback }, { status: 500 });
}

async function requestClientKey(request: Request): Promise<string> {
  const address = request.headers.get("cf-connecting-ip")?.slice(0, 64) || "local-client";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function enforceRateLimit(
  request: Request,
  env: Env,
  scope: string,
  policy: RateLimitPolicy,
  subject?: string,
): Promise<Response | null> {
  const global = await consumeRateLimit(env.DB, `global:${scope}`, {
    limit: policy.limit * 10,
    windowMs: policy.windowMs,
  });
  if (!global.allowed) {
    return json(
      { error: "The service is receiving too many requests. Try again shortly.", code: "rate_limited" },
      { status: 429, headers: { "retry-after": String(global.retryAfterSeconds) } },
    );
  }
  const client = subject || await requestClientKey(request);
  const result = await consumeRateLimit(env.DB, `${scope}:${client}`, policy);
  if (result.allowed) return null;
  return json(
    { error: "Too many requests. Try again shortly.", code: "rate_limited" },
    { status: 429, headers: { "retry-after": String(result.retryAfterSeconds) } },
  );
}

function commandOutcomeResponse(outcome: CommandOutcome): Response {
  return json(outcome.payload, { status: outcome.status ?? 200 });
}

function authorizedProductionBackup(request: Request, env: Env): boolean {
  return bearerSecretMatches(request.headers.get("authorization"), env.PRODUCTION_BACKUP_TOKEN);
}

function cleanBackupCursor(value: string | null): string | null {
  if (!value) return null;
  try {
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(value), (character) => character.charCodeAt(0)));
    return decoded && decoded.length <= 1_024 ? decoded : null;
  } catch {
    return null;
  }
}

function cleanBackupOffset(value: string | null): number | null {
  if (value === null) return 0;
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const offset = Number(value);
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= 10_000_000 ? offset : null;
}

function encodeBackupCursor(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function quoteBackupTable(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function productionBackupTables(env: Env): Promise<Array<{ name: string; sql: string }>> {
  const rows = await env.DB.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND sql IS NOT NULL ORDER BY name",
  ).all<{ name: string; sql: string }>();
  return rows.results ?? [];
}

async function handleProductionD1Backup(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "GET" } });
  if (!authorizedProductionBackup(request, env)) return json({ error: "Backup authorization failed." }, { status: 401 });
  const url = new URL(request.url);
  const requestedTable = url.searchParams.get("table");
  const backupTables = await productionBackupTables(env);
  if (!requestedTable) {
    const tables = [];
    for (const table of backupTables) {
      const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${quoteBackupTable(table.name)}`).first<{ count: number }>();
      tables.push({ name: table.name, rowCount: count?.count ?? 0 });
    }
    const includedTables = new Set(tables.map((table) => table.name));
    const schema = await env.DB.prepare(
      "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name",
    ).all<{ type: string; name: string; tableName: string; sql: string }>();
    return json({
      formatVersion: 1,
      capturedAt: new Date().toISOString(),
      tables,
      schema: (schema.results ?? []).filter((entry) => includedTables.has(entry.tableName)),
    });
  }
  if (!backupTables.some((table) => table.name === requestedTable)) {
    return json({ error: "Unknown backup table." }, { status: 400 });
  }
  const offset = cleanBackupOffset(url.searchParams.get("offset"));
  if (offset === null) return json({ error: "Invalid backup offset." }, { status: 400 });
  const rows = await env.DB.prepare(`SELECT * FROM ${quoteBackupTable(requestedTable)} ORDER BY rowid LIMIT ? OFFSET ?`)
    .bind(PRODUCTION_BACKUP_PAGE_SIZE, offset).all<Record<string, unknown>>();
  const items = rows.results ?? [];
  return json({
    formatVersion: 1,
    table: requestedTable,
    offset,
    items,
    nextOffset: items.length === PRODUCTION_BACKUP_PAGE_SIZE ? offset + items.length : null,
  });
}

async function handleProductionR2Backup(request: Request, env: Env, object = false): Promise<Response> {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "GET" } });
  if (!authorizedProductionBackup(request, env)) return json({ error: "Backup authorization failed." }, { status: 401 });
  if (!env.MAP_ASSETS) return json({ error: "Backup object storage is unavailable." }, { status: 503 });
  const url = new URL(request.url);
  if (object) {
    const key = cleanBackupCursor(url.searchParams.get("key"));
    if (!key) return json({ error: "A valid object key is required." }, { status: 400 });
    const stored = await env.MAP_ASSETS.get(key);
    if (!stored) return json({ error: "Backup object not found." }, { status: 404 });
    const headers = new Headers({
      "cache-control": "private, no-store",
      "content-type": stored.httpMetadata?.contentType ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
      "x-r2-key": encodeBackupCursor(key),
    });
    if (stored.httpEtag) headers.set("etag", stored.httpEtag);
    return new Response(stored.body, { headers });
  }
  const cursor = cleanBackupCursor(url.searchParams.get("cursor"));
  const listed = await env.MAP_ASSETS.list({
    limit: PRODUCTION_BACKUP_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
  });
  return json({
    formatVersion: 1,
    objects: listed.objects.map((entry) => ({
      key: entry.key,
      encodedKey: encodeBackupCursor(entry.key),
      size: entry.size,
      etag: entry.httpEtag,
      uploaded: entry.uploaded.toISOString(),
      contentType: entry.httpMetadata?.contentType ?? null,
    })),
    truncated: listed.truncated,
    cursor: listed.truncated ? encodeBackupCursor(listed.cursor) : null,
  });
}

function cleanCode(value: string): string {
  try {
    return decodeURIComponent(value)
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, 24);
  } catch {
    return "";
  }
}

function cleanName(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 32)
    : "";
}

function cleanParticipantId(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64)
    : "";
}

function cleanSessionSecret(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64)
    : "";
}

function cleanTokenId(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64)
    : "";
}

function cleanRole(value: unknown): "dm" | "player" {
  return value === "dm" ? "dm" : "player";
}

function cleanText(value: unknown, max = 64): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, max)
    : "";
}

const REQUIRED_SCHEMA_MIGRATION = "0028_volatile_bruce_banner.sql";
const REQUIRED_SCHEMA_MARKER = "map-images-and-drafts-v1";

async function ensureSchema(env: Env): Promise<void> {
  if (!schemaReady) {
    schemaReady = env.DB.prepare(
      "SELECT 1 AS ready FROM app_maintenance WHERE id = ? LIMIT 1",
    )
      .bind(REQUIRED_SCHEMA_MARKER)
      .first<{ ready: number }>()
      .then((row) => {
        if (!row) {
          throw new Error(
            `Database migration ${REQUIRED_SCHEMA_MIGRATION} has not been applied.`,
          );
        }
      })
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  await schemaReady;
}
async function handleCreatureCatalog(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "GET" } });
  }
  await ensureSchema(env);
  const rateLimited = await enforceRateLimit(request, env, "creature-catalog", RATE_LIMIT_POLICIES.publicRead);
  if (rateLimited) return rateLimited;
  const url = new URL(request.url);
  const limit = Math.min(48, Math.max(8, Math.trunc(Number(url.searchParams.get("limit"))) || 24));
  const offset = Math.max(0, Math.trunc(Number(url.searchParams.get("cursor"))) || 0);
  const family = cleanText(url.searchParams.get("family"), 32).toLowerCase();
  const query = cleanText(url.searchParams.get("q"), 48).toLowerCase();
  const filters = ["is_active = 1"];
  const bindings: Array<string | number> = [];
  if (family) {
    filters.push("family = ?");
    bindings.push(family);
  }
  if (query) {
    filters.push("lower(name) LIKE ?");
    bindings.push(`%${query.replace(/[%_]/g, "")}%`);
  }
  const rows = await env.DB.prepare(
    `SELECT id, name, family, creature_type, size, default_hp, hit_dice,
            armor_class, challenge_rating, default_speed, walk_speed, fly_speed,
            swim_speed, climb_speed, burrow_speed, token_asset, thumbnail_asset, sort_order
     FROM creature_catalog
     WHERE ${filters.join(" AND ")}
     ORDER BY sort_order, id
     LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, limit + 1, offset)
    .all<CreatureCatalogRow>();
  const families = await env.DB.prepare(
    "SELECT DISTINCT family FROM creature_catalog WHERE is_active = 1 ORDER BY family LIMIT ?",
  ).bind(MAX_CATALOG_FAMILIES).all<{ family: string }>();
  const page = rows.results.slice(0, limit);
  return json({
    items: page.map((creature) => ({
      id: creature.id,
      name: creature.name,
      family: creature.family,
      creatureType: creature.creature_type,
      size: creature.size,
      defaultHp: creature.default_hp,
      hitDice: creature.hit_dice,
      armorClass: creature.armor_class,
      challengeRating: creature.challenge_rating,
      defaultSpeed: creature.default_speed,
      speeds: {
        walk: creature.walk_speed,
        fly: creature.fly_speed,
        swim: creature.swim_speed,
        climb: creature.climb_speed,
        burrow: creature.burrow_speed,
      },
      artAsset: creature.token_asset,
      thumbnailAsset: creature.thumbnail_asset,
    })),
    families: families.results.map((entry) => entry.family),
    nextCursor: rows.results.length > limit ? String(offset + limit) : null,
  });
}

function authorizedCatalogImport(request: Request, env: Env): boolean {
  return bearerSecretMatches(request.headers.get("authorization"), env.CATALOG_IMPORT_TOKEN);
}

function decodeCatalogImage(value: unknown, variant: CatalogImageVariant): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0 || value.length > CATALOG_IMAGE_MAX_ENCODED_CHARACTERS) return null;
  try {
    const raw = value.replace(/^data:image\/(?:png|webp|jpeg);base64,/i, "");
    const decoded = atob(raw);
    if (decoded.length === 0 || decoded.length > CATALOG_IMAGE_MAX_BYTES) return null;
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
    return inspectCatalogPng(bytes, variant) ? bytes : null;
  } catch {
    return null;
  }
}

function cleanCatalogSpeed(value: unknown, required = false): number | null {
  if (value === null || value === undefined || value === "") return required ? 0 : null;
  const speed = Math.trunc(Number(value));
  return Number.isFinite(speed) && speed >= 0 && speed <= 240 ? speed : null;
}

async function handleCreatureCatalogImport(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "POST" } });
  }
  if (!authorizedCatalogImport(request, env)) {
    return json({ error: "Catalog import authorization failed." }, { status: 401 });
  }
  if (!env.MAP_ASSETS) {
    return json({ error: "Creature asset storage is unavailable." }, { status: 503 });
  }
  await ensureSchema(env);
  const rateLimited = await enforceRateLimit(request, env, "catalog-import", RATE_LIMIT_POLICIES.catalogImport, "authorized-importer");
  if (rateLimited) return rateLimited;
  const leaseKey = "catalog-import";
  const lease = await acquireOperationLease(env.DB, leaseKey, 120_000);
  if (!lease) {
    return json({ error: "Another catalog import is already running.", code: "operation_in_progress" }, { status: 409 });
  }
  try {
    return await importCreatureCatalogBatch(request, env, env.MAP_ASSETS);
  } finally {
    await releaseOperationLease(env.DB, leaseKey, lease);
  }
}

async function importCreatureCatalogBatch(request: Request, env: Env, storage: R2Bucket): Promise<Response> {
  const body = await readBoundedJsonObject(request, CATALOG_IMPORT_JSON_MAX_BYTES);
  const entries = Array.isArray(body.creatures) ? body.creatures : [];
  if (entries.length === 0 || entries.length > 10) {
    return json({ error: "Import one to ten creatures per batch." }, { status: 400 });
  }
  const prepared: Array<{
    id: string; name: string; family: string; creatureType: string; size: CreatureSize;
    defaultHp: number; hitDice: string | null; armorClass: number; challengeRating: string | null;
    walk: number; fly: number | null; swim: number | null; climb: number | null; burrow: number | null;
    assetKey: string; tokenAsset: string; thumbnailAsset: string; original: Uint8Array; thumbnail: Uint8Array;
  }> = [];
  let decodedImageBytes = 0;
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") return json({ error: "Every catalog entry must be an object." }, { status: 400 });
    const entry = raw as Record<string, unknown>;
    const id = cleanText(entry.id, 64).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const name = cleanText(entry.name, 80);
    const family = cleanText(entry.family, 32).toLowerCase();
    const creatureType = cleanText(entry.creatureType, 32).toLowerCase() || family;
    const size = isCreatureSize(entry.size) ? entry.size : null;
    const defaultHp = Math.trunc(Number(entry.defaultHp));
    const armorClass = Math.trunc(Number(entry.armorClass));
    const challengeRating = cleanText(entry.challengeRating, 12) || null;
    const hitDice = cleanText(entry.hitDice, 24) || null;
    const speeds = entry.speeds && typeof entry.speeds === "object" ? entry.speeds as Record<string, unknown> : {};
    const walk = cleanCatalogSpeed(speeds.walk ?? entry.defaultSpeed, true);
    const fly = cleanCatalogSpeed(speeds.fly);
    const swim = cleanCatalogSpeed(speeds.swim);
    const climb = cleanCatalogSpeed(speeds.climb);
    const burrow = cleanCatalogSpeed(speeds.burrow);
    const original = decodeCatalogImage(entry.imageBase64, "original");
    const thumbnail = decodeCatalogImage(entry.thumbnailBase64, "thumbnail");
    if (!id || !name || !family || !size || !Number.isFinite(defaultHp) || defaultHp < 1 || defaultHp > 10000 ||
        !Number.isFinite(armorClass) || armorClass < 1 || armorClass > 40 || walk === null || !original || !thumbnail) {
      return json({ error: `Invalid catalog metadata or images for ${name || id || "an entry"}.` }, { status: 400 });
    }
    decodedImageBytes += original.byteLength + thumbnail.byteLength;
    if (decodedImageBytes > CATALOG_IMPORT_MAX_DECODED_BYTES) {
      return json({ error: "The decoded catalog image batch is too large." }, { status: 413 });
    }
    const assetKey = `tokens/catalog/${id}.png`;
    const tokenAsset = `/creature-assets/${assetKey}`;
    prepared.push({ id, name, family, creatureType, size, defaultHp, hitDice, armorClass, challengeRating,
      walk, fly, swim, climb, burrow, assetKey, tokenAsset,
      thumbnailAsset: `${tokenAsset}?variant=thumbnail&v=3`, original, thumbnail });
  }
  const catalogCount = await env.DB.prepare("SELECT COUNT(*) AS value FROM creature_catalog")
    .first<{ value: number }>();
  const existingCount = await env.DB.prepare(
    `SELECT COUNT(*) AS value FROM creature_catalog
     WHERE id IN (${prepared.map(() => "?").join(", ")})`,
  ).bind(...prepared.map((creature) => creature.id)).first<{ value: number }>();
  const newEntries = prepared.length - (existingCount?.value ?? 0);
  if ((catalogCount?.value ?? 0) + newEntries > MAX_CATALOG_ENTRIES) {
    return json({ error: "The creature catalog has reached its entry limit." }, { status: 409 });
  }
  const now = Date.now();
  const currentMax = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS value FROM creature_catalog")
    .first<{ value: number }>();
  let sortOrder = currentMax?.value ?? 0;
  for (const creature of prepared) {
    await Promise.all([
      storage.put(`creature-catalog/original/${creature.assetKey}`, creature.original, {
        httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" },
      }),
      storage.put(`creature-catalog/thumbnails/${creature.assetKey}`, creature.thumbnail, {
        httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" },
      }),
    ]);
    sortOrder += 10;
    await env.DB.prepare(
      `INSERT INTO creature_catalog
       (id, name, family, creature_type, size, default_hp, hit_dice, armor_class, challenge_rating,
        default_speed, walk_speed, fly_speed, swim_speed, climb_speed, burrow_speed, source_asset,
        token_asset, thumbnail_asset, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, family = excluded.family,
        creature_type = excluded.creature_type, size = excluded.size, default_hp = excluded.default_hp,
        hit_dice = excluded.hit_dice, armor_class = excluded.armor_class,
        challenge_rating = excluded.challenge_rating, default_speed = excluded.default_speed,
        walk_speed = excluded.walk_speed, fly_speed = excluded.fly_speed, swim_speed = excluded.swim_speed,
        climb_speed = excluded.climb_speed, burrow_speed = excluded.burrow_speed,
        source_asset = excluded.source_asset, token_asset = excluded.token_asset,
        thumbnail_asset = excluded.thumbnail_asset, is_active = 1, updated_at = excluded.updated_at`,
    ).bind(creature.id, creature.name, creature.family, creature.creatureType, creature.size,
      creature.defaultHp, creature.hitDice, creature.armorClass, creature.challengeRating,
      creature.walk, creature.walk, creature.fly, creature.swim, creature.climb, creature.burrow,
      `r2://${creature.assetKey}`, creature.tokenAsset, creature.thumbnailAsset, sortOrder, now, now).run();
  }
  const total = await env.DB.prepare("SELECT COUNT(*) AS count FROM creature_catalog WHERE is_active = 1")
    .first<{ count: number }>();
  return json({ imported: prepared.map((creature) => creature.id), count: prepared.length, total: total?.count ?? 0 });
}

async function isAllowedTokenArt(env: Env, value: unknown): Promise<boolean> {
  const artAsset = typeof value === "string" ? value : "";
  if (CHARACTER_ART_ASSETS.includes(artAsset)) return true;
  if (SPELL_EFFECTS.some((spell) => spell.artAsset === artAsset)) return true;
  if (!artAsset) return false;
  const creature = await env.DB.prepare(
    "SELECT 1 AS found FROM creature_catalog WHERE token_asset = ? AND is_active = 1 LIMIT 1",
  ).bind(artAsset).first<{ found: number }>();
  return Boolean(creature);
}

async function findEncounter(env: Env, code: string): Promise<EncounterRow | null> {
  return env.DB.prepare(
    `SELECT id, code, name, dm_briefing, version, status, map_asset, map_package_json,
            active_map_preset_id, active_map_image_id, active_map_setup_json,
            draft_map_image_id, draft_map_setup_json, draft_updated_at,
            grid_width, grid_height, current_round,
            active_initiative_order, strict_movement, updated_at
     FROM encounters WHERE code = ?`,
  )
    .bind(code)
    .first<EncounterRow>();
}

function parseStoredMapSetup(serialized: string, width: number, height: number) {
  try {
    return parseMapSetup(JSON.parse(serialized), width, height);
  } catch {
    return null;
  }
}

async function handleEncounterList(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "GET" } });
  }
  await ensureSchema(env);
  const rateLimited = await enforceRateLimit(request, env, "encounter-list", RATE_LIMIT_POLICIES.publicRead);
  if (rateLimited) return rateLimited;
  const encounters = await env.DB.prepare(
    `SELECT code, name, status, updated_at
     FROM encounters ORDER BY updated_at DESC, name, code LIMIT ?`,
  ).bind(MAX_SCENARIOS).all<{ code: string; name: string; status: "setup" | "active" | "paused"; updated_at: number }>();
  return json({ items: encounters.results.map((encounter) => ({
    code: encounter.code,
    name: encounter.name,
    status: encounter.status,
    updatedAt: encounter.updated_at,
  })) });
}

async function participantFromHeaders(
  request: Request,
  env: Env,
  encounterId: string,
): Promise<ParticipantRow | null> {
  const participantId = cleanParticipantId(
    request.headers.get("x-participant-id"),
  );
  const sessionSecret = cleanSessionSecret(
    request.headers.get("x-session-secret"),
  );
  if (!participantId || !sessionSecret) return null;
  return env.DB.prepare(
    `SELECT id, name, role FROM participants
     WHERE id = ? AND encounter_id = ? AND session_secret = ?`,
  )
    .bind(participantId, encounterId, sessionSecret)
    .first<ParticipantRow>();
}

async function handleHandoutUpload(request: Request, env: Env, code: string): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "POST" } });
  }
  await ensureSchema(env);
  const encounter = await findEncounter(env, code);
  if (!encounter) return json({ error: "Encounter not found." }, { status: 404 });
  const participant = await participantFromHeaders(request, env, encounter.id);
  if (!participant) return json({ error: "Participant session is invalid." }, { status: 401 });
  if (participant.role !== "dm") return json({ error: "Only the DM can prepare handouts." }, { status: 403 });
  if (!env.MAP_ASSETS) return json({ error: "Handout storage is unavailable." }, { status: 503 });
  const rateLimited = await enforceRateLimit(
    request,
    env,
    `handout-upload:${encounter.id}`,
    RATE_LIMIT_POLICIES.handoutUpload,
    participant.id,
  );
  if (rateLimited) return rateLimited;
  const leaseKey = `handout-upload:${encounter.id}`;
  const lease = await acquireOperationLease(env.DB, leaseKey, 60_000);
  if (!lease) {
    return json({ error: "Another handout upload is already running.", code: "operation_in_progress" }, { status: 409 });
  }
  try {
    return await persistHandoutUpload(request, env, env.MAP_ASSETS, encounter, participant);
  } finally {
    await releaseOperationLease(env.DB, leaseKey, lease);
  }
}

async function persistHandoutUpload(
  request: Request,
  env: Env,
  storage: R2Bucket,
  encounter: EncounterRow,
  participant: ParticipantRow,
): Promise<Response> {
  const form = await readBoundedFormData(request, HANDOUT_MULTIPART_MAX_BYTES);
  const title = cleanHandoutTitle(form.get("title"));
  const replaceId = cleanTokenId(form.get("replaceId"));
  const display = form.get("display");
  const thumbnail = form.get("thumbnail");
  if (!title) return json({ error: "Give the handout a title." }, { status: 400 });
  if (!(display instanceof Blob) || !(thumbnail instanceof Blob)) {
    return json({ error: "Both prepared handout images are required." }, { status: 400 });
  }
  const replacedHandout = replaceId
    ? await env.DB.prepare(
        `SELECT id, display_key, thumbnail_key
         FROM handouts WHERE id = ? AND encounter_id = ? AND deleted_at IS NULL`,
      ).bind(replaceId, encounter.id).first<Pick<HandoutRow, "id" | "display_key" | "thumbnail_key">>()
    : null;
  if (replaceId && !replacedHandout) return json({ error: "The handout to replace was not found." }, { status: 404 });
  if (!replacedHandout) {
    const existing = await env.DB.prepare(
      "SELECT COUNT(*) AS value FROM handouts WHERE encounter_id = ? AND deleted_at IS NULL",
    ).bind(encounter.id).first<{ value: number }>();
    if ((Number(existing?.value) || 0) >= HANDOUT_MAX_PER_SCENARIO) {
      return json({ error: `This encounter already has ${HANDOUT_MAX_PER_SCENARIO} handouts.` }, { status: 409 });
    }
  }
  if (display.size > HANDOUT_DISPLAY_MAX_BYTES || thumbnail.size > HANDOUT_THUMBNAIL_MAX_BYTES) {
    return json({ error: "The prepared handout images are too large." }, { status: 413 });
  }
  const [displayBuffer, thumbnailBuffer] = await Promise.all([display.arrayBuffer(), thumbnail.arrayBuffer()]);
  const displayBytes = new Uint8Array(displayBuffer);
  const thumbnailBytes = new Uint8Array(thumbnailBuffer);
  if (display.type !== thumbnail.type) {
    return json({ error: "The prepared handout images must use the same format." }, { status: 400 });
  }
  const storedMimeType = display.type;
  const displaySize = inspectStoredHandout(displayBytes, storedMimeType);
  const thumbnailSize = inspectStoredHandout(thumbnailBytes, storedMimeType);
  const displayError = storedHandoutVariantError({
    variant: "display",
    contentType: display.type,
    byteLength: displayBytes.byteLength,
    width: displaySize?.width,
    height: displaySize?.height,
  });
  const thumbnailError = storedHandoutVariantError({
    variant: "thumbnail",
    contentType: thumbnail.type,
    byteLength: thumbnailBytes.byteLength,
    width: thumbnailSize?.width,
    height: thumbnailSize?.height,
  });
  if (displayError || thumbnailError || !displaySize || !thumbnailSize) {
    return json({ error: displayError || thumbnailError || "The prepared handout is invalid." }, { status: 400 });
  }
  const handoutId = replacedHandout?.id ?? crypto.randomUUID();
  const storagePrefix = `handouts/${encounter.id}/${handoutId}/${crypto.randomUUID()}`;
  const fileExtension = storedMimeType === "image/jpeg" ? "jpg" : "webp";
  const displayKey = `${storagePrefix}/display.${fileExtension}`;
  const thumbnailKey = `${storagePrefix}/thumbnail.${fileExtension}`;
  const now = Date.now();
  const operationId = crypto.randomUUID();
  const newKeys = [displayKey, thumbnailKey];
  await createStorageWriteIntent(env.DB, operationId, newKeys, now);
  try {
    await Promise.all([
      storage.put(displayKey, displayBytes, {
        httpMetadata: { contentType: storedMimeType, cacheControl: "private, no-store" },
      }),
      storage.put(thumbnailKey, thumbnailBytes, {
        httpMetadata: { contentType: storedMimeType, cacheControl: "private, no-store" },
      }),
    ]);
    const unitOfWork = createD1MutationUnitOfWork(env.DB);
    const mutationDb = unitOfWork.database;
    if (replacedHandout) {
      await mutationDb.prepare(
        `UPDATE handouts SET title = ?, display_key = ?, thumbnail_key = ?, mime_type = ?,
                width = ?, height = ?, display_bytes = ?, thumbnail_bytes = ?, updated_at = ?
         WHERE id = ? AND encounter_id = ? AND deleted_at IS NULL`,
      ).bind(title, displayKey, thumbnailKey, storedMimeType, displaySize.width, displaySize.height,
        displayBytes.byteLength, thumbnailBytes.byteLength, now, handoutId, encounter.id).run();
    } else {
      await mutationDb.prepare(
        `INSERT INTO handouts
         (id, encounter_id, title, display_key, thumbnail_key, mime_type, width, height,
          display_bytes, thumbnail_bytes, created_by, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind(
        handoutId,
        encounter.id,
        title,
        displayKey,
        thumbnailKey,
        storedMimeType,
        displaySize.width,
        displaySize.height,
        displayBytes.byteLength,
        thumbnailBytes.byteLength,
        participant.id,
        now,
        now,
      ).run();
    }
    if (replacedHandout) {
      await mutationDb.batch([
        queueStorageCleanupStatement(mutationDb, replacedHandout.display_key, "handout-replaced", now),
        queueStorageCleanupStatement(mutationDb, replacedHandout.thumbnail_key, "handout-replaced", now),
      ]);
    }
    await mutationDb.prepare(
      "DELETE FROM storage_write_intents WHERE operation_id = ?",
    ).bind(operationId).run();
    await unitOfWork.commit({
      encounterId: encounter.id,
      expectedVersion: encounter.version,
      participantId: participant.id,
      actionType: replacedHandout ? "handout_replaced" : "handout_uploaded",
      actionPayload: { handoutId, title },
      now,
    });
  } catch (error) {
    await abandonStorageWriteIntent(env.DB, operationId, newKeys, "handout-write-failed", Date.now())
      .catch(() => undefined);
    await reconcileStorageLifecycle(env.DB, storage).catch(() => undefined);
    if (error instanceof MutationConflictError) {
      return json({
        error: error.message,
        code: "shared_state_conflict",
        state: await encounterState(env, encounter.code, participant),
      }, { status: 409 });
    }
    if (String(error).includes("resource_limit:active_handouts")) {
      return json({
        error: `This encounter already has ${HANDOUT_MAX_PER_SCENARIO} handouts.`,
      }, { status: 409 });
    }
    throw error;
  }
  await reconcileStorageLifecycle(env.DB, storage).catch(() => undefined);
  return json({ handoutId, replaced: Boolean(replacedHandout), state: await encounterState(env, encounter.code, participant) }, { status: replacedHandout ? 200 : 201 });
}

async function handleHandoutAsset(
  request: Request,
  env: Env,
  code: string,
  handoutId: string,
  variant: "thumbnail" | "display",
): Promise<Response> {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { allow: "GET" } });
  await ensureSchema(env);
  const encounter = await findEncounter(env, code);
  if (!encounter) return new Response("Not found", { status: 404 });
  const participant = await participantFromHeaders(request, env, encounter.id);
  if (!participant) return new Response("Unauthorized", { status: 401 });
  const rateLimited = await enforceRateLimit(
    request,
    env,
    `handout-read:${encounter.id}`,
    RATE_LIMIT_POLICIES.authenticatedProjection,
    participant.id,
  );
  if (rateLimited) return rateLimited;
  const handout = await env.DB.prepare(
    `SELECT id, title, display_key, thumbnail_key, mime_type, width, height,
            display_bytes, thumbnail_bytes, created_by, created_at, updated_at, deleted_at
     FROM handouts WHERE id = ? AND encounter_id = ?`,
  ).bind(cleanTokenId(handoutId), encounter.id).first<HandoutRow>();
  if (!handout || handout.deleted_at !== null) return new Response("Not found", { status: 404 });
  if (participant.role !== "dm") {
    const delivery = await env.DB.prepare(
      `SELECT sender_name, recipient_name
       FROM chat_messages
       WHERE encounter_id = ? AND handout_id = ?
         AND (recipient_name IS NULL OR sender_name = ? OR recipient_name = ?)
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(encounter.id, handout.id, participant.name, participant.name)
      .first<{ sender_name: string; recipient_name: string | null }>();
    if (!delivery || !handoutVisibleToViewer({ senderName: delivery.sender_name, recipientName: delivery.recipient_name }, participant)) {
      return new Response("Forbidden", { status: 403 });
    }
  }
  if (!env.MAP_ASSETS) return new Response("Handout storage unavailable", { status: 503 });
  const stored = await env.MAP_ASSETS.get(variant === "thumbnail" ? handout.thumbnail_key : handout.display_key);
  if (!stored) return new Response("Not found", { status: 404 });
  return new Response(stored.body, {
    headers: {
      "cache-control": "private, no-store",
      "content-type": handout.mime_type,
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
    },
  });
}

async function expireAnnotations(
  env: Env,
  encounter: EncounterRow,
): Promise<void> {
  const now = Date.now();
  const expired = await env.DB.prepare(
    `SELECT 1 AS found FROM annotations
     WHERE encounter_id = ? AND expires_at IS NOT NULL AND expires_at <= ? LIMIT 1`,
  ).bind(encounter.id, now).first();
  if (!expired) return;
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM annotations
       WHERE encounter_id = ? AND expires_at IS NOT NULL AND expires_at <= ?`,
    ).bind(encounter.id, now),
    env.DB.prepare(
      "UPDATE encounters SET version = version + 1, updated_at = ? WHERE id = ?",
    ).bind(now, encounter.id),
  ]);
}

function coarseHealth(hp: number | null, maxHp: number | null): SharedToken["healthState"] {
  return healthBand(hp, maxHp);
}

async function encounterState(
  env: Env,
  code: string,
  viewer: ParticipantRow | null = null,
  telemetry?: ApiRequestTelemetry,
): Promise<EncounterState | null> {
  const projectionStartedAt = performance.now();
  let encounter = await findEncounter(env, code);
  if (!encounter) return null;
  await expireAnnotations(env, encounter);
  encounter = await findEncounter(env, code);
  const tokens = await env.DB.prepare(
    `SELECT t.id, t.name, t.x, t.y, t.art_asset, t.kind, t.size, t.speed,
            t.fly_speed, t.swim_speed, t.climb_speed, t.burrow_speed,
            t.armor_class, t.hp, t.max_hp, t.is_hidden, t.summoner_token_id, t.initiative,
            t.initiative_group_id, t.initiative_order, t.turn_complete, t.movement_used, t.altitude,
            t.movement_origin_x, t.movement_origin_y,
            t.owner_participant_id, t.owner_name
     FROM tokens t
     WHERE t.encounter_id = ? ORDER BY t.name, t.id LIMIT ?`,
  )
    .bind(encounter!.id, MAX_TOKENS_PER_ENCOUNTER)
    .all<TokenRow>();

  const effects = await env.DB.prepare(
    `SELECT id, token_id, name, effect_type, duration_rounds, expires_round,
            reminder_timing
     FROM effects WHERE encounter_id = ? ORDER BY created_at, id LIMIT ?`,
  )
    .bind(encounter!.id, MAX_EFFECTS_PER_ENCOUNTER)
    .all<EffectRow>();
  const annotations = await env.DB.prepare(
    `SELECT id, annotation_type, x, y, x2, y2, color, label, created_by,
            expires_at
     FROM annotations WHERE encounter_id = ? ORDER BY created_at, id LIMIT ?`,
  )
    .bind(encounter!.id, MAX_ANNOTATIONS_PER_ENCOUNTER)
    .all<AnnotationRow>();
  const recentChatMessages = viewer
    ? await env.DB.prepare(
        `SELECT cm.id, cm.sender_name, cm.sender_role, cm.recipient_name, cm.body,
                cm.handout_id, cm.show_immediately, cm.created_at, h.title AS handout_title,
                h.width AS handout_width, h.height AS handout_height,
                h.updated_at AS handout_updated_at,
                h.deleted_at AS handout_deleted_at
         FROM chat_messages cm
         LEFT JOIN handouts h ON h.id = cm.handout_id
         WHERE cm.encounter_id = ?
           AND (? = 'dm' OR cm.recipient_name IS NULL OR cm.sender_name = ? OR cm.recipient_name = ?)
         ORDER BY cm.created_at DESC, cm.id DESC LIMIT 200`,
      ).bind(encounter!.id, viewer.role, viewer.name, viewer.name).all<ChatMessageRow>()
    : { results: [] as ChatMessageRow[] };
  const handouts = viewer?.role === "dm"
    ? await env.DB.prepare(
        `SELECT h.id, h.title, h.display_key, h.thumbnail_key, h.mime_type,
                h.width, h.height, h.display_bytes, h.thumbnail_bytes,
                h.created_by, h.created_at, h.updated_at, h.deleted_at,
                COUNT(cm.id) AS message_count
         FROM handouts h
         LEFT JOIN chat_messages cm ON cm.handout_id = h.id
         WHERE h.encounter_id = ? AND h.deleted_at IS NULL
         GROUP BY h.id
         ORDER BY h.created_at DESC, h.id DESC LIMIT ?`,
      ).bind(encounter!.id, Math.min(HANDOUT_MAX_PER_SCENARIO, MAX_HANDOUT_ROWS_PER_ENCOUNTER)).all<HandoutRow>()
    : { results: [] as HandoutRow[] };
  const availableHistory = viewer
    ? await historyStacks(env, encounter!.id, viewer.id)
    : { undo: [], redo: [] };
  const mapImageRows = viewer?.role === "dm"
    ? await env.DB.prepare(
        `SELECT id, name, description, biome, mood, asset_path, grid_width, grid_height,
                pixel_width, pixel_height, source_kind, source_prompt, is_active,
                created_at, updated_at
         FROM map_images
         WHERE is_active = 1 OR id = ? OR id = ?
         ORDER BY is_active DESC, name, id LIMIT ?`,
      ).bind(encounter!.active_map_image_id, encounter!.draft_map_image_id, MAX_MAP_IMAGES).all<MapImageRow>()
    : encounter!.active_map_image_id
      ? await env.DB.prepare(
          `SELECT id, name, description, biome, mood, asset_path, grid_width, grid_height,
                  pixel_width, pixel_height, source_kind, source_prompt, is_active,
                  created_at, updated_at
           FROM map_images WHERE id = ? LIMIT 1`,
        ).bind(encounter!.active_map_image_id).all<MapImageRow>()
      : { results: [] as MapImageRow[] };
  const mapImageById = new Map(mapImageRows.results.map((row) => [row.id, row]));
  const activeMapPackage = hydrateStoredMap(
    encounter!.active_map_image_id ? mapImageById.get(encounter!.active_map_image_id) ?? null : null,
    encounter!.active_map_setup_json,
  ) ?? legacyMapPackage(encounter!.map_package_json);
  const draftMapPackage = viewer?.role === "dm"
    ? hydrateStoredMap(
        encounter!.draft_map_image_id ? mapImageById.get(encounter!.draft_map_image_id) ?? null : null,
        encounter!.draft_map_setup_json,
      ) ?? activeMapPackage
    : null;

  const tokenById = new Map(tokens.results.map((token) => [token.id, token]));
  const effectsByToken = indexRowsByKey(effects.results, (effect) => effect.token_id);
  const controllerNames = new Map<string, string>();
  const controllerName = (token: TokenRow): string => {
    const cached = controllerNames.get(token.id);
    if (cached) return cached;
    const resolved = resolveTokenControllerName(token, tokenById);
    controllerNames.set(token.id, resolved);
    return resolved;
  };
  const viewerControls = (token: TokenRow) => Boolean(
    viewer && identityControlsToken(viewer, controllerName(token)),
  );
  const visibilityTokens = tokens.results.map((token) => ({
    x: token.x, y: token.y, kind: token.kind, controlledByViewer: viewerControls(token),
  }));
  const fogVisibility = visibilityForViewer(activeMapPackage, visibilityTokens, viewer) as EncounterState["encounter"]["fogVisibility"];
  const visibleTokens = tokens.results.filter(
    (token) =>
      ((!token.is_hidden || viewer?.role === "dm" || viewerControls(token)) &&
      (viewer?.role === "dm" || viewerControls(token) || pointVisibleToViewer(token, fogVisibility))),
  );
  const projectedState: EncounterState = {
    encounter: {
      code: encounter!.code,
      name: encounter!.name,
      dmBriefing: viewer?.role === "dm" ? encounter!.dm_briefing : null,
      version: encounter!.version,
      status: encounter!.status,
      mapPackage: mapPackageForViewer(activeMapPackage, viewer),
      mapDraft: draftMapPackage,
      draftUpdatedAt: viewer?.role === "dm" ? encounter!.draft_updated_at : null,
      currentRound: encounter!.current_round,
      activeInitiativeOrder: encounter!.active_initiative_order,
      strictMovement: Boolean(encounter!.strict_movement),
      fogVisibility,
      updatedAt: encounter!.updated_at,
    },
    grid: { width: encounter!.grid_width, height: encounter!.grid_height, feetPerCell: 5 },
    viewer: viewer ? { id: viewer.id, role: viewer.role } : null,
    undo: {
      available: availableHistory.undo.length,
      redoAvailable: availableHistory.redo.length,
      lastAction: availableHistory.undo[0]?.action_type ?? null,
      nextRedoAction: availableHistory.redo[0]?.action_type ?? null,
    },
    tokens: visibleTokens.map((token) => {
      const controlledByViewer = viewerControls(token);
      const canSeePrivateStats = viewer?.role === "dm" || controlledByViewer;
      return {
        id: token.id,
        name: token.name,
        x: token.x,
        y: token.y,
        artAsset: token.art_asset,
        kind: token.kind,
        size: token.size,
        speed: token.speed,
        flySpeed: token.fly_speed,
        swimSpeed: token.swim_speed,
        climbSpeed: token.climb_speed,
        burrowSpeed: token.burrow_speed,
        armorClass: canSeePrivateStats ? token.armor_class : null,
        hp: canSeePrivateStats ? token.hp : null,
        maxHp: canSeePrivateStats ? token.max_hp : null,
        healthState: coarseHealth(token.hp, token.max_hp),
        hidden: Boolean(token.is_hidden),
        summonerTokenId: token.summoner_token_id,
        initiative: token.initiative,
        initiativeGroupId: token.initiative_group_id,
        initiativeOrder: token.initiative_order,
        turnComplete: Boolean(token.turn_complete),
        altitude: token.altitude,
        movementUsed: token.movement_used,
        movementOrigin: token.movement_origin_x === null || token.movement_origin_x === undefined || token.movement_origin_y === null || token.movement_origin_y === undefined
          ? null
          : { x: token.movement_origin_x, y: token.movement_origin_y },
        effects: (effectsByToken.get(token.id) ?? [])
          .map((effect) => ({
            id: effect.id,
            name: effect.name,
            type: effect.effect_type,
            durationRounds: effect.duration_rounds,
            expiresRound: effect.expires_round,
            reminderTiming: effect.reminder_timing,
            due:
              effect.expires_round !== null &&
              effect.expires_round <= encounter!.current_round,
          })),
        controller: { name: controllerName(token) },
        controlledByViewer,
      };
    }),
    annotations: annotations.results.filter((annotation) =>
      annotationGeometryIsBounded({
        type: annotation.annotation_type,
        x: annotation.x,
        y: annotation.y,
        x2: annotation.x2,
        y2: annotation.y2,
      }, encounter!.grid_width, encounter!.grid_height) &&
      (viewer?.role === "dm" || pointVisibleToViewer(annotation, fogVisibility)),
    ).map((annotation) => ({
      id: annotation.id,
      type: annotation.annotation_type,
      x: annotation.x,
      y: annotation.y,
      x2: annotation.x2,
      y2: annotation.y2,
      color: annotation.color,
      label: annotation.label,
      createdBy: annotation.created_by,
      expiresAt: annotation.expires_at,
    })),
    chatMessages: recentChatMessages.results
      .filter((message) => chatMessageVisibleToViewer({
        senderName: message.sender_name,
        recipientName: message.recipient_name,
      }, viewer))
      .reverse()
      .map((message) => ({
        id: message.id,
        senderName: message.sender_name,
        senderRole: message.sender_role,
        recipientName: message.recipient_name,
        body: message.body,
        showImmediately: message.show_immediately === 1,
        handout: message.handout_id && message.handout_title ? {
          id: message.handout_id,
          title: message.handout_title,
          width: message.handout_width,
          height: message.handout_height,
          updatedAt: message.handout_updated_at,
          available: message.handout_deleted_at === null,
        } : null,
        createdAt: message.created_at,
      })),
    handouts: handouts.results.map((handout) => ({
      id: handout.id,
      title: handout.title,
      width: handout.width,
      height: handout.height,
      displayBytes: handout.display_bytes,
      thumbnailBytes: handout.thumbnail_bytes,
      messageCount: Number(handout.message_count) || 0,
      createdAt: handout.created_at,
      updatedAt: handout.updated_at,
    })),
    mapImages: viewer?.role === "dm"
      ? mapImageRows.results.flatMap((row) => {
          const image = mapImageFromRow(row);
          return image ? [image] : [];
        })
      : [],
    availableArt: [...new Set([
      ...CHARACTER_ART_ASSETS,
      ...visibleTokens.flatMap((token) => token.art_asset ? [token.art_asset] : []),
    ])],
  };
  if (telemetry) {
    telemetry.projection = {
      durationMs: Math.max(0, performance.now() - projectionStartedAt),
      collectionReads: 4 + (viewer ? 2 : 0) + (viewer?.role === "dm" ? 1 : 0),
      rows: {
        tokens: tokens.results.length,
        effects: effects.results.length,
        annotations: annotations.results.length,
        chatMessages: recentChatMessages.results.length,
        handouts: handouts.results.length,
        mapImages: mapImageRows.results.length,
      },
    };
  }
  return projectedState;
}

const REVERSIBLE_ACTION_TYPES = new Set([
  "token_moved",
  "hp_changed",
  "initiative_set",
  "initiative_group_set",
  "effect_added",
  "effect_removed",
  "annotation_added",
  "annotation_removed",
  "annotations_cleared",
  "token_created",
  "spell_effect_dismissed",
  "token_updated",
]);

async function historyStacks(
  env: Env,
  encounterId: string,
  participantId: string,
): Promise<{ undo: ActionRow[]; redo: ActionRow[] }> {
  const rows = await env.DB.prepare(
    `SELECT id, action_type, payload_json, created_at FROM actions
     WHERE encounter_id = ? AND participant_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 200`,
  )
    .bind(encounterId, participantId)
    .all<ActionRow>();
  const eligibleRows = rows.results.filter((row) => isReversibleHistoryRow(row, REVERSIBLE_ACTION_TYPES));
  const actions = new Map(eligibleRows.filter((row) => REVERSIBLE_ACTION_TYPES.has(row.action_type)).map((row) => [row.id, row]));
  const { undoIds, redoIds } = deriveHistoryActionIds([...eligibleRows].reverse(), REVERSIBLE_ACTION_TYPES);
  return {
    undo: undoIds.slice(0, 10).map((id) => actions.get(id)!).filter(Boolean),
    redo: redoIds.slice(0, 10).map((id) => actions.get(id)!).filter(Boolean),
  };
}

async function handleStatePoll(
  request: Request,
  env: Env,
  code: string,
  telemetry: ApiRequestTelemetry,
): Promise<Response> {
  const requestedVersion = Number(new URL(request.url).searchParams.get("since"));
  const lastVersion = Number.isFinite(requestedVersion) ? requestedVersion : 0;
  const encounter = await findEncounter(env, code);
  if (!encounter) return json({ error: "Encounter not found." }, { status: 404 });
  const viewer = await participantFromHeaders(request, env, encounter.id);
  const rateLimited = await enforceRateLimit(
    request,
    env,
    `state-poll:${encounter.id}:${viewer ? "session" : "anonymous"}`,
    viewer ? RATE_LIMIT_POLICIES.authenticatedProjection : RATE_LIMIT_POLICIES.anonymousProjection,
    viewer?.id,
  );
  if (rateLimited) return rateLimited;
  // Version equality is authoritative: avoid loading tokens, effects, map
  // packages, chat, and dynamic sight polygons for an unchanged idle poll.
  if (encounter.version === lastVersion) {
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  }
  const state = await encounterState(env, code, viewer, telemetry);
  if (!state) return json({ error: "Encounter not found." }, { status: 404 });
  return json(state);
}

async function canControlToken(
  env: Env,
  encounterId: string,
  token: TokenRow,
  participant: ParticipantRow,
): Promise<boolean> {
  if (participant.role === "dm") return true;
  let current = token;
  const visited = new Set<string>();
  while (current.summoner_token_id && !visited.has(current.id)) {
    visited.add(current.id);
    const summoner = await env.DB.prepare(
      `SELECT id, name, x, y, art_asset, kind, size, speed, fly_speed, swim_speed,
              climb_speed, burrow_speed, armor_class, hp, max_hp, is_hidden,
              summoner_token_id, initiative, initiative_order, turn_complete,
              movement_used, owner_participant_id, owner_name, initiative_group_id
       FROM tokens WHERE id = ? AND encounter_id = ?`,
    )
      .bind(current.summoner_token_id, encounterId)
      .first<TokenRow>();
    if (!summoner) return false;
    current = summoner;
  }
  return identityControlsToken(participant, baseTokenControllerName(current));
}

async function handleCommand(
  env: Env,
  code: string,
  encounter: EncounterRow,
  participant: ParticipantRow,
  body: Record<string, unknown>,
  now: number,
  telemetry: ApiRequestTelemetry,
): Promise<Response> {
  const parsed = parseCommandRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const request = parsed.request;
  const unitOfWork = createD1MutationUnitOfWork(env.DB);
  const mutationDb = unitOfWork.database;
  const scenarioMapRepository = createD1ScenarioMapRepository(mutationDb);
  const activeMapImage = encounter.active_map_image_id
    ? await scenarioMapRepository.findMapImage(encounter.active_map_image_id)
    : null;
  const activeMapSetup = activeMapImage && encounter.active_map_setup_json
    ? parseStoredMapSetup(encounter.active_map_setup_json, activeMapImage.gridWidth, activeMapImage.gridHeight)
    : null;
  const activeMapPackage = activeMapImage && activeMapSetup
    ? hydrateMapPackage(activeMapImage, activeMapSetup)
    : legacyMapPackage(encounter.map_package_json);
  const state = () => encounterState(env, code, participant, telemetry);
  const commandEncounter = {
    id: encounter.id,
    code: encounter.code,
    name: encounter.name,
    version: encounter.version,
    status: encounter.status,
    activeMapImageId: encounter.active_map_image_id,
    activeMapSetupJson: encounter.active_map_setup_json,
    activeMapPackageJson: activeMapPackage ? JSON.stringify(activeMapPackage) : null,
    draftMapImageId: encounter.draft_map_image_id,
    draftMapSetupJson: encounter.draft_map_setup_json,
    gridWidth: encounter.grid_width,
    gridHeight: encounter.grid_height,
    currentRound: encounter.current_round,
    activeInitiativeOrder: encounter.active_initiative_order,
    strictMovement: Boolean(encounter.strict_movement),
    updatedAt: encounter.updated_at,
  };
  const commandServices = {
    createId: () => crypto.randomUUID(),
    loadState: state,
    commit: (actionType: string | null, payload: Record<string, unknown> = {}) =>
      unitOfWork.commit({
        encounterId: encounter.id,
        expectedVersion: encounter.version,
        participantId: actionType ? participant.id : null,
        actionType,
        actionPayload: payload,
        now,
      }),
    commitFor: (input: {
      encounterId: string;
      expectedVersion?: number | null;
      participantId: string | null;
      actionType: string | null;
      payload?: Record<string, unknown>;
      bumpVersion?: boolean;
    }) => unitOfWork.commit({
      encounterId: input.encounterId,
      expectedVersion: input.expectedVersion,
      participantId: input.participantId,
      actionType: input.actionType,
      actionPayload: input.payload,
      bumpVersion: input.bumpVersion,
      now,
    }),
  };
  const baseContext = <Name extends CommandName>(payload: CommandPayload<Name>) =>
    ({ encounter: commandEncounter, participant, payload, now, services: commandServices });
  const chatHandoutContext = <Name extends "send-chat-message" | "delete-handout">(
    payload: CommandPayload<Name>,
  ): ChatHandoutCommandContext<Name> => ({
    ...baseContext(payload),
    repository: createD1ChatHandoutRepository(mutationDb),
    objectStorage: createR2HandoutObjectStorage(env.MAP_ASSETS, env.DB),
  });
  const annotationFogContext = <Name extends
    "set-strict-movement" | "set-fog-mode" | "set-vision-door-open" |
    "update-shared-fog" | "add-annotation" | "clear-annotations" | "remove-annotation"
  >(payload: CommandPayload<Name>): AnnotationFogCommandContext<Name> => ({
    ...baseContext(payload),
    repository: createD1AnnotationFogRepository(mutationDb),
  });
  const scenarioMapContext = <Name extends
    "rename-scenario" | "create-scenario" | "save-map-draft" |
    "discard-map-draft" | "apply-map-draft" | "configure-encounter"
  >(payload: CommandPayload<Name>): ScenarioMapCommandContext<Name> => ({
    ...baseContext(payload),
    repository: scenarioMapRepository,
    loadScenarioState: async (scenarioCode, participantId) =>
      encounterState(env, scenarioCode, { id: participantId, name: "Kevin", role: "dm" }, telemetry),
  });
  type InitiativeCommandName =
    | "set-initiative" | "set-initiative-group" | "start-combat"
    | "end-turn" | "advance-turn" | "correct-turn";
  const initiativeCombatContext = <Name extends InitiativeCommandName>(
    payload: CommandPayload<Name>,
  ): InitiativeCombatCommandContext<Name> => ({
    ...baseContext(payload),
    repository: createD1InitiativeCombatRepository(mutationDb),
    canControl: (token) => canControlToken(env, encounter.id, token, participant),
  });
  const tokenEffectContext = <Name extends
    "create-spell-effect" | "create-token" | "resize-spell-effect" | "update-token" |
    "apply-hp" | "add-effect" | "remove-effect" | "delete-token"
  >(payload: CommandPayload<Name>): TokenEffectCommandContext<Name> => ({
    ...baseContext(payload),
    repository: createD1TokenEffectRepository(mutationDb),
    canControl: (token) => canControlToken(env, encounter.id, token, participant),
    isAllowedArt: (value) => isAllowedTokenArt(env, value),
  });
  const historyContext = <Name extends "undo" | "redo">(
    payload: CommandPayload<Name>,
  ): HistoryCommandContext<Name> => ({
    ...baseContext(payload),
    repository: createD1HistoryRepository(mutationDb),
    tokenRepository: createD1TokenEffectRepository(mutationDb),
    annotationRepository: createD1AnnotationFogRepository(mutationDb),
    initiativeRepository: createD1InitiativeCombatRepository(mutationDb),
    canControl: (token) => canControlToken(env, encounter.id, token, participant),
  });
  let outcome: CommandOutcome;
  try {
    switch (request.command) {
    case "send-chat-message": outcome = await sendChatMessage(chatHandoutContext(request.payload)); break;
    case "delete-handout": outcome = await deleteHandout(chatHandoutContext(request.payload)); break;
    case "undo": outcome = await undo(historyContext(request.payload)); break;
    case "redo": outcome = await redo(historyContext(request.payload)); break;
    case "rename-scenario": outcome = await renameScenario(scenarioMapContext(request.payload)); break;
    case "create-scenario": outcome = await createScenario(scenarioMapContext(request.payload)); break;
    case "save-map-draft": outcome = await saveMapDraft(scenarioMapContext(request.payload)); break;
    case "discard-map-draft": outcome = await discardMapDraft(scenarioMapContext(request.payload)); break;
    case "apply-map-draft": outcome = await applyMapDraft(scenarioMapContext(request.payload)); break;
    case "configure-encounter": outcome = await configureEncounter(scenarioMapContext(request.payload)); break;
    case "set-initiative": outcome = await setInitiative(initiativeCombatContext(request.payload)); break;
    case "set-initiative-group": outcome = await setInitiativeGroup(initiativeCombatContext(request.payload)); break;
    case "start-combat": outcome = await startCombat(initiativeCombatContext(request.payload)); break;
    case "end-turn": outcome = await advanceTurn(initiativeCombatContext<"end-turn">(request.payload), false); break;
    case "advance-turn": outcome = await advanceTurn(initiativeCombatContext<"advance-turn">(request.payload), true); break;
    case "correct-turn": outcome = await correctTurn(initiativeCombatContext(request.payload)); break;
    case "create-spell-effect": outcome = await createSpellEffect(tokenEffectContext(request.payload)); break;
    case "create-token": outcome = await createToken(tokenEffectContext(request.payload)); break;
    case "resize-spell-effect": outcome = await resizeSpellEffect(tokenEffectContext(request.payload)); break;
    case "update-token": outcome = await updateToken(tokenEffectContext(request.payload)); break;
    case "apply-hp": outcome = await applyHp(tokenEffectContext(request.payload)); break;
    case "add-effect": outcome = await addEffect(tokenEffectContext(request.payload)); break;
    case "remove-effect": outcome = await removeEffect(tokenEffectContext(request.payload)); break;
    case "delete-token": outcome = await deleteToken(tokenEffectContext(request.payload)); break;
    case "set-strict-movement": outcome = await setStrictMovement(annotationFogContext(request.payload)); break;
    case "set-fog-mode": outcome = await setFogMode(annotationFogContext(request.payload)); break;
    case "set-vision-door-open": outcome = await setVisionDoorOpen(annotationFogContext(request.payload)); break;
    case "update-shared-fog": outcome = await updateSharedFog(annotationFogContext(request.payload)); break;
    case "add-annotation": outcome = await addAnnotation(annotationFogContext(request.payload)); break;
    case "clear-annotations": outcome = await clearAnnotations(annotationFogContext(request.payload)); break;
      case "remove-annotation": outcome = await removeAnnotation(annotationFogContext(request.payload)); break;
    }
  } catch (error) {
    if (error instanceof MutationConflictError) {
      return json({
        error: error.message,
        code: "shared_state_conflict",
        state: await state(),
      }, { status: 409 });
    }
    throw error;
  }
  return commandOutcomeResponse(outcome);
}

async function handleApi(
  request: Request,
  env: Env,
  code: string,
  action: string,
  telemetry: ApiRequestTelemetry,
): Promise<Response> {
  await ensureSchema(env);
  const expectedMethod = action === "state" || action === "events" ? "GET" : "POST";
  if (request.method !== expectedMethod) {
    return json(
      { error: "Method not allowed." },
      { status: 405, headers: { allow: expectedMethod } },
    );
  }

  if (action === "state") {
    const encounter = await findEncounter(env, code);
    const viewer = encounter
      ? await participantFromHeaders(request, env, encounter.id)
      : null;
    if (!encounter) return json({ error: "Encounter not found." }, { status: 404 });
    const rateLimited = await enforceRateLimit(
      request,
      env,
      `state:${encounter.id}:${viewer ? "session" : "anonymous"}`,
      viewer ? RATE_LIMIT_POLICIES.authenticatedProjection : RATE_LIMIT_POLICIES.anonymousProjection,
      viewer?.id,
    );
    if (rateLimited) return rateLimited;
    const state = await encounterState(env, code, viewer, telemetry);
    return state
      ? json(state)
      : json({ error: "Encounter not found." }, { status: 404 });
  }
  if (action === "events") {
    return handleStatePoll(request, env, code, telemetry);
  }

  const encounter = await findEncounter(env, code);
  if (!encounter) return json({ error: "Encounter not found." }, { status: 404 });

  const requestPolicy = action === "join"
    ? RATE_LIMIT_POLICIES.join
    : action === "move"
      ? RATE_LIMIT_POLICIES.tokenMove
      : RATE_LIMIT_POLICIES.encounterWrite;
  const rateLimited = await enforceRateLimit(request, env, `encounter-${action}:${encounter.id}`, requestPolicy);
  if (rateLimited) return rateLimited;
  const body = await readBoundedJsonObject(request, API_JSON_BODY_MAX_BYTES);
  const now = Date.now();
  if (action === "join") {
    const participantName = cleanName(body.participantName);
    const participantRole = cleanRole(body.role);
    if (!participantName) {
      return json({ error: "Display name is required." }, { status: 400 });
    }

    const participantId = crypto.randomUUID();
    const sessionSecret = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM participants
         WHERE encounter_id = ?
           AND id NOT IN (
             SELECT id FROM participants WHERE encounter_id = ?
             ORDER BY last_seen_at DESC, joined_at DESC, id DESC LIMIT ?
           )`,
      ).bind(encounter.id, encounter.id, MAX_PARTICIPANTS_PER_ENCOUNTER - 1),
      env.DB.prepare(
        `INSERT INTO participants
        (id, encounter_id, name, role, session_secret, joined_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        participantId,
        encounter.id,
        participantName,
        participantRole,
        sessionSecret,
        now,
        now,
      ),
      env.DB.prepare(
        `DELETE FROM actions
         WHERE encounter_id = ?
           AND id NOT IN (
             SELECT id FROM actions WHERE encounter_id = ?
             ORDER BY created_at DESC, id DESC LIMIT ?
           )`,
      ).bind(encounter.id, encounter.id, MAX_ACTIONS_PER_ENCOUNTER - 1),
      env.DB.prepare(
        `INSERT INTO actions
         (id, encounter_id, participant_id, action_type, payload_json, created_at)
         VALUES (?, ?, ?, 'participant_joined', ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        encounter.id,
        participantId,
        JSON.stringify({ name: participantName, role: participantRole }),
        now,
      ),
    ]);
    const joinedParticipant: ParticipantRow = {
      id: participantId,
      name: participantName,
      role: participantRole,
    };
    return json({
      participantId,
      sessionSecret,
      role: participantRole,
      state: await encounterState(env, code, joinedParticipant, telemetry),
    });
  }

  const participantId = cleanParticipantId(body.participantId);
  const sessionSecret = cleanSessionSecret(body.sessionSecret);
  if (!participantId || !sessionSecret) {
    return json({ error: "Participant session is required." }, { status: 401 });
  }
  const participant = await env.DB.prepare(
    `SELECT id, name, role FROM participants
     WHERE id = ? AND encounter_id = ? AND session_secret = ?`,
  )
    .bind(participantId, encounter.id, sessionSecret)
    .first<ParticipantRow>();
  if (!participant) {
    return json({ error: "Participant session is invalid." }, { status: 401 });
  }
  await env.DB.prepare(
    "UPDATE participants SET last_seen_at = ? WHERE id = ?",
  )
    .bind(now, participantId)
    .run();

  if (action === "heartbeat") {
    return json({ present: true });
  }

  if (action === "command") {
    return handleCommand(env, code, encounter, participant, body, now, telemetry);
  }

  const tokenId = cleanTokenId(body.tokenId);
  if (!tokenId) {
    return json({ error: "Token is required." }, { status: 400 });
  }
  const token = await env.DB.prepare(
    `SELECT id, name, x, y, art_asset, kind, size, speed, fly_speed, swim_speed,
            climb_speed, burrow_speed, armor_class, hp, max_hp, is_hidden,
            summoner_token_id, initiative, initiative_order, turn_complete,
            movement_used, altitude, movement_origin_x, movement_origin_y, owner_participant_id, owner_name
     FROM tokens WHERE id = ? AND encounter_id = ?`,
  )
    .bind(tokenId, encounter.id)
    .first<TokenRow>();
  if (!token) {
    return json({ error: "Token not found." }, { status: 404 });
  }

  if (action === "move") {
    const strictMovement = Boolean(encounter.strict_movement);
    const controlledByViewer = participant.role === "dm" || !strictMovement || await canControlToken(env, encounter.id, token, participant);
    const policyDenial = movementPolicyDenial({
      strictMovement,
      participantRole: participant.role,
      controlledByViewer,
      encounterStatus: encounter.status,
    });
    if (policyDenial) {
      return json(
        { error: policyDenial.error, state: await encounterState(env, code, participant, telemetry) },
        { status: policyDenial.status },
      );
    }
    const requestedX = Number(body.x);
    const requestedY = Number(body.y);
    const requestedAltitude = normalizeAltitude(body.altitude ?? token.altitude);
    if (
      !Number.isFinite(requestedX) ||
      !Number.isFinite(requestedY) ||
      requestedX < 0 ||
      requestedY < 0 ||
      requestedX > encounter.grid_width ||
      requestedY > encounter.grid_height
    ) {
      return json({ error: "Destination is outside the map." }, { status: 400 });
    }
    const isSpellEffect = token.kind === SPELL_EFFECT_KIND;
    const previous = { x: token.x, y: token.y };
    const previousMovementOrigin = token.movement_origin_x === null || token.movement_origin_x === undefined || token.movement_origin_y === null || token.movement_origin_y === undefined
      ? null
      : { x: token.movement_origin_x, y: token.movement_origin_y };
    const move = transitionTokenMove({
      previous,
      destination: { x: requestedX, y: requestedY },
      previousMovementOrigin,
      previousMovementUsed: token.movement_used,
      size: token.size,
      grid: { width: encounter.grid_width, height: encounter.grid_height, feetPerCell: 5 },
      speed: token.speed,
      encounterStatus: encounter.status,
      isSpellEffect,
    });
    const { position: { x, y }, movementOrigin, distance, movementUsed, overBudget } = move;
    const unitOfWork = createD1MutationUnitOfWork(env.DB);
    const result = await unitOfWork.database.prepare(
      `UPDATE tokens
       SET x = ?, y = ?, altitude = ?, movement_used = ?, movement_origin_x = ?, movement_origin_y = ?, updated_at = ?
       WHERE id = ? AND encounter_id = ?`,
    )
      .bind(x, y, requestedAltitude, movementUsed, movementOrigin?.x ?? null, movementOrigin?.y ?? null, now, tokenId, encounter.id)
      .run();
    if ((result.meta.changes ?? 0) !== 1) {
      return json(
        { error: "The token could not be moved.", state: await encounterState(env, code, participant, telemetry) },
        { status: 409 },
      );
    }
    try {
      await unitOfWork.commit({
        encounterId: encounter.id,
        expectedVersion: encounter.version,
        participantId,
        actionType: "token_moved",
        actionPayload: {
          tokenId,
          from: previous,
          to: { x, y },
          previousAltitude: token.altitude,
          altitude: requestedAltitude,
          distance,
          previousMovementUsed: token.movement_used,
          previousMovementOrigin,
          movementOrigin,
          movementUsed,
          overBudget,
        },
        now,
      });
    } catch (error) {
      if (error instanceof MutationConflictError) {
        return json({
          error: error.message,
          code: "shared_state_conflict",
          state: await encounterState(env, code, participant, telemetry),
        }, { status: 409 });
      }
      throw error;
    }
    return json({ moved: true, distance, movementUsed, overBudget, state: await encounterState(env, code, participant, telemetry) });
  }

  return json({ error: "Method not allowed." }, { status: 405 });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: WorkerExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/scenario-provisioning/")) {
      ctx.waitUntil(reconcileStorageLifecycle(env.DB, env.MAP_ASSETS).catch(() => undefined));
      return handleScenarioProvisioningApi(request, env);
    }

    const productionBackupMatch = url.pathname.match(PRODUCTION_BACKUP_ROUTE);
    if (productionBackupMatch) {
      try {
        if (productionBackupMatch[1] === "d1") return await handleProductionD1Backup(request, env);
        return await handleProductionR2Backup(request, env, productionBackupMatch[1] === "r2/object");
      } catch (error) {
        console.error("Production backup API error", error);
        return json({ error: "The production backup could not be read." }, { status: 500 });
      }
    }

    if (url.pathname === "/api/creatures") {
      try {
        return await handleCreatureCatalog(request, env);
      } catch (error) {
        return apiFailure(error, "Creature catalog API error", "The creature catalog is temporarily unavailable.");
      }
    }

    if (url.pathname === "/api/encounters") {
      try {
        return await handleEncounterList(request, env);
      } catch (error) {
        return apiFailure(error, "Encounter list API error", "The scenario list is temporarily unavailable.");
      }
    }

    if (url.pathname === "/api/catalog/import") {
      try {
        return await handleCreatureCatalogImport(request, env);
      } catch (error) {
        return apiFailure(error, "Creature catalog import error", "The creature catalog batch could not be imported.");
      }
    }

    if (url.pathname.startsWith("/creature-assets/")) {
      const key = url.pathname.slice("/creature-assets/".length);
      return handleCreatureAsset(request, env, key);
    }

    if (url.pathname.startsWith("/map-assets/")) {
      const key = url.pathname.slice("/map-assets/".length);
      return handleMapAsset(request, env, key);
    }

    const handoutMatch = url.pathname.match(HANDOUT_API_ROUTE);
    if (handoutMatch) {
      ctx.waitUntil(reconcileStorageLifecycle(env.DB, env.MAP_ASSETS).catch(() => undefined));
      try {
        const code = cleanCode(handoutMatch[1]);
        const handoutId = handoutMatch[2];
        const variant = handoutMatch[3];
        if (!handoutId) return await handleHandoutUpload(request, env, code);
        if (variant === "thumbnail" || variant === "display") {
          return await handleHandoutAsset(request, env, code, handoutId, variant);
        }
        return json({ error: "Handout route not found." }, { status: 404 });
      } catch (error) {
        return apiFailure(error, "Handout API error", "The handout service is temporarily unavailable.");
      }
    }

    const apiMatch = url.pathname.match(API_ROUTE);
    if (apiMatch) {
      const telemetry = createApiRequestTelemetry(request, apiMatch[2]);
      try {
        const response = await handleApi(
          request,
          env,
          cleanCode(apiMatch[1]),
          apiMatch[2],
          telemetry,
        );
        return finishApiRequest(response, telemetry);
      } catch (error) {
        return finishApiRequest(
          apiFailure(error, "Battle map API error", "The encounter service is temporarily unavailable.", telemetry),
          telemetry,
        );
      }
    }

    if (url.pathname === "/_vinext/image") {
      if (!env.IMAGES) {
        const path = url.searchParams.get("url");
        return path?.startsWith("/")
          ? env.ASSETS.fetch(new Request(new URL(path, request.url)))
          : new Response("Invalid image URL", { status: 400 });
      }
      const images = env.IMAGES;
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) =>
            env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await images.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
