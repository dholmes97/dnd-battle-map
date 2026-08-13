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
  tokenRadiusCells,
} from "../shared/creature-library";
import { parseMapPackage, type MapPackage } from "../shared/map-package";
import {
  baseTokenControllerName,
  identityControlsToken,
  resolveTokenControllerName,
} from "../shared/token-control.ts";
import { deriveHistoryActionIds, isReversibleHistoryRow } from "../shared/action-history.ts";
import { healthBand } from "../shared/health.ts";
import { movementPolicyDenial } from "../shared/battle-map-policies.ts";
import { calculateDirectDistance } from "../shared/battle-map-geometry.ts";
import { pointVisibleToViewer, visibilityForViewer } from "../shared/fog-of-war.ts";
import {
  historyConflictMessage,
  mapPackageForViewer,
  scenarioCodeFromName,
} from "../shared/encounter-domain.ts";
import { nextInitiativeTurn, orderedInitiativeGroups } from "../shared/initiative-domain.ts";
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
  isSpellAreaSize,
  SPELL_EFFECT_KIND,
  SPELL_EFFECTS,
  spellEffectById,
} from "../shared/spell-effects";
import {
  isCommandName,
  type CommandRequest,
  type EncounterState,
  type SharedToken,
} from "../shared/contracts";
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
import type {
  ActionRow,
  AnnotationRow,
  ChatMessageRow,
  CreatureCatalogRow,
  EffectRow,
  EncounterRow,
  Env,
  HandoutRow,
  MapPresetRow,
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

const MAP_ASSET_KEYS = new Set([
  "ancient-forest-clearing-02.jpg",
  "ruined-underground-temple-02.jpg",
  "storm-coast-ruins-02.jpg",
  "moonlit-fey-glade-01.jpg",
  "crystal-cavern-crossing-01.jpg",
  "sunken-swamp-shrine-01.jpg",
  "desert-caravanserai-ruin-01.jpg",
  "frozen-mountain-pass-01.jpg",
  "volcanic-forge-caldera-01.jpg",
  "abandoned-village-square-01.jpg",
  "goblin-mineworks-01.jpg",
  "river-gorge-bridge-01.jpg",
  "haunted-graveyard-chapel-01.jpg",
  "cliffside-switchbacks-01.jpg",
  "underwater-ruins-01.jpg",
  "grandfather-tree-roots-01.jpg",
  "ravenloft-grand-dining-hall-01.jpg",
]);

async function handleMapAsset(request: Request, env: Env, key: string): Promise<Response> {
  if (!MAP_ASSET_KEYS.has(key)) return new Response("Not found", { status: 404 });
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
  return new Response(JSON.stringify(data), { ...init, headers });
}

function commandOutcomeResponse(outcome: CommandOutcome): Response {
  return json(outcome.payload, { status: outcome.status ?? 200 });
}

function bearerTokenMatches(request: Request, configured: string): boolean {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (configured.length < 32 || supplied.length !== configured.length) return false;
  let difference = 0;
  for (let index = 0; index < configured.length; index += 1) {
    difference |= configured.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}

function authorizedProductionBackup(request: Request, env: Env): boolean {
  return bearerTokenMatches(request, env.PRODUCTION_BACKUP_TOKEN ?? env.CATALOG_IMPORT_TOKEN ?? "");
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

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
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

async function uniqueScenarioCode(env: Env, name: string): Promise<string> {
  const base = scenarioCodeFromName(name);
  for (let attempt = 1; attempt <= 99; attempt += 1) {
    const suffix = attempt === 1 ? "" : `-${attempt}`;
    const candidate = `${base.slice(0, 24 - suffix.length)}${suffix}`;
    const existing = await env.DB.prepare("SELECT 1 AS found FROM encounters WHERE code = ? LIMIT 1")
      .bind(candidate)
      .first<{ found: number }>();
    if (!existing) return candidate;
  }
  return `${base.slice(0, 15)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
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

function cleanMapPackage(value: unknown): MapPackage | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parseMapPackage(parsed);
  } catch {
    return null;
  }
}

function clampTokenCoordinate(value: unknown, limit: number, size: CreatureSize): number {
  const radius = tokenRadiusCells(size);
  const numeric = Number(value);
  const fallback = limit / 2;
  return Math.round(Math.min(limit - radius, Math.max(radius, Number.isFinite(numeric) ? numeric : fallback)) * 1_000) / 1_000;
}

const REQUIRED_SCHEMA_MIGRATION = "0017_blushing_moondragon.sql";
const REQUIRED_SCHEMA_MARKER = "migration-only-schema-v1";

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
    "SELECT DISTINCT family FROM creature_catalog WHERE is_active = 1 ORDER BY family",
  ).all<{ family: string }>();
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
  const configured = env.CATALOG_IMPORT_TOKEN ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (configured.length < 32 || supplied.length !== configured.length) return false;
  let difference = 0;
  for (let index = 0; index < configured.length; index += 1) {
    difference |= configured.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}

function decodeCatalogImage(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_800_000) return null;
  try {
    const raw = value.replace(/^data:image\/(?:png|webp|jpeg);base64,/i, "");
    const decoded = atob(raw);
    if (decoded.length === 0 || decoded.length > 2_000_000) return null;
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < pngSignature.length || pngSignature.some((byte, index) => bytes[index] !== byte)) return null;
    return bytes;
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
  const body = await readJson(request);
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
    const original = decodeCatalogImage(entry.imageBase64);
    const thumbnail = decodeCatalogImage(entry.thumbnailBase64);
    if (!id || !name || !family || !size || !Number.isFinite(defaultHp) || defaultHp < 1 || defaultHp > 10000 ||
        !Number.isFinite(armorClass) || armorClass < 1 || armorClass > 40 || walk === null || !original || !thumbnail) {
      return json({ error: `Invalid catalog metadata or images for ${name || id || "an entry"}.` }, { status: 400 });
    }
    const assetKey = `tokens/catalog/${id}.png`;
    const tokenAsset = `/creature-assets/${assetKey}`;
    prepared.push({ id, name, family, creatureType, size, defaultHp, hitDice, armorClass, challengeRating,
      walk, fly, swim, climb, burrow, assetKey, tokenAsset,
      thumbnailAsset: `${tokenAsset}?variant=thumbnail&v=3`, original, thumbnail });
  }
  const now = Date.now();
  const currentMax = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS value FROM creature_catalog")
    .first<{ value: number }>();
  let sortOrder = currentMax?.value ?? 0;
  for (const creature of prepared) {
    await Promise.all([
      env.MAP_ASSETS.put(`creature-catalog/original/${creature.assetKey}`, creature.original, {
        httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" },
      }),
      env.MAP_ASSETS.put(`creature-catalog/thumbnails/${creature.assetKey}`, creature.thumbnail, {
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
    `SELECT id, code, name, version, status, map_asset, map_package_json,
            active_map_preset_id, grid_width, grid_height, current_round,
            active_initiative_order, strict_movement, updated_at
     FROM encounters WHERE code = ?`,
  )
    .bind(code)
    .first<EncounterRow>();
}

async function handleEncounterList(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, { status: 405, headers: { allow: "GET" } });
  }
  await ensureSchema(env);
  const encounters = await env.DB.prepare(
    `SELECT code, name, status, updated_at
     FROM encounters ORDER BY updated_at DESC, name, code`,
  ).all<{ code: string; name: string; status: "setup" | "active" | "paused"; updated_at: number }>();
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
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > HANDOUT_DISPLAY_MAX_BYTES + HANDOUT_THUMBNAIL_MAX_BYTES + 128_000) {
    return json({ error: "The prepared handout upload is too large." }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "The handout upload could not be read." }, { status: 400 });
  }
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
      return json({ error: `This scenario already has ${HANDOUT_MAX_PER_SCENARIO} handouts.` }, { status: 409 });
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
  await Promise.all([
    env.MAP_ASSETS.put(displayKey, displayBytes, {
      httpMetadata: { contentType: storedMimeType, cacheControl: "private, no-store" },
    }),
    env.MAP_ASSETS.put(thumbnailKey, thumbnailBytes, {
      httpMetadata: { contentType: storedMimeType, cacheControl: "private, no-store" },
    }),
  ]);
  try {
    if (replacedHandout) {
      await env.DB.prepare(
        `UPDATE handouts SET title = ?, display_key = ?, thumbnail_key = ?, mime_type = ?,
                width = ?, height = ?, display_bytes = ?, thumbnail_bytes = ?, updated_at = ?
         WHERE id = ? AND encounter_id = ? AND deleted_at IS NULL`,
      ).bind(title, displayKey, thumbnailKey, storedMimeType, displaySize.width, displaySize.height,
        displayBytes.byteLength, thumbnailBytes.byteLength, now, handoutId, encounter.id).run();
    } else {
      await env.DB.prepare(
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
  } catch (error) {
    await Promise.all([env.MAP_ASSETS.delete(displayKey), env.MAP_ASSETS.delete(thumbnailKey)]);
    throw error;
  }
  if (replacedHandout) {
    await Promise.allSettled([
      env.MAP_ASSETS.delete(replacedHandout.display_key),
      env.MAP_ASSETS.delete(replacedHandout.thumbnail_key),
    ]);
  }
  await bumpEncounter(env, encounter.id, now);
  return json({ handoutId, replaced: Boolean(replacedHandout), state: await encounterState(env, code, participant) }, { status: replacedHandout ? 200 : 201 });
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

async function bumpEncounter(env: Env, encounterId: string, now = Date.now()) {
  await env.DB.prepare(
    "UPDATE encounters SET version = version + 1, updated_at = ? WHERE id = ?",
  )
    .bind(now, encounterId)
    .run();
}

async function expireAnnotations(
  env: Env,
  encounter: EncounterRow,
): Promise<void> {
  const result = await env.DB.prepare(
    `DELETE FROM annotations
     WHERE encounter_id = ? AND expires_at IS NOT NULL AND expires_at <= ?`,
  )
    .bind(encounter.id, Date.now())
    .run();
  if ((result.meta.changes ?? 0) > 0) {
    await bumpEncounter(env, encounter.id);
  }
}

function coarseHealth(hp: number | null, maxHp: number | null): SharedToken["healthState"] {
  return healthBand(hp, maxHp);
}

async function encounterState(
  env: Env,
  code: string,
  viewer: ParticipantRow | null = null,
): Promise<EncounterState | null> {
  let encounter = await findEncounter(env, code);
  if (!encounter) return null;
  await expireAnnotations(env, encounter);
  encounter = await findEncounter(env, code);
  const tokens = await env.DB.prepare(
    `SELECT t.id, t.name, t.x, t.y, t.art_asset, t.kind, t.size, t.speed,
            t.hp, t.max_hp, t.is_hidden, t.summoner_token_id, t.initiative,
            t.initiative_group_id, t.initiative_order, t.turn_complete, t.movement_used,
            t.movement_origin_x, t.movement_origin_y,
            t.owner_participant_id, t.owner_name
     FROM tokens t
     WHERE t.encounter_id = ? ORDER BY t.name, t.id`,
  )
    .bind(encounter!.id)
    .all<TokenRow>();

  const effects = await env.DB.prepare(
    `SELECT id, token_id, name, effect_type, duration_rounds, expires_round,
            reminder_timing
     FROM effects WHERE encounter_id = ? ORDER BY created_at, id`,
  )
    .bind(encounter!.id)
    .all<EffectRow>();
  const annotations = await env.DB.prepare(
    `SELECT id, annotation_type, x, y, x2, y2, color, label, created_by,
            expires_at
     FROM annotations WHERE encounter_id = ? ORDER BY created_at, id`,
  )
    .bind(encounter!.id)
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
         ORDER BY h.created_at DESC, h.id DESC`,
      ).bind(encounter!.id).all<HandoutRow>()
    : { results: [] as HandoutRow[] };
  const availableHistory = viewer
    ? await historyStacks(env, encounter!.id, viewer.id)
    : { undo: [], redo: [] };
  const savedMapPresets = viewer?.role === "dm"
    ? await env.DB.prepare(
        `SELECT id, name, description, source_prompt, package_json, created_at, updated_at
         FROM map_presets WHERE encounter_id = ? ORDER BY updated_at DESC, name LIMIT 60`,
      ).bind(encounter!.id).all<MapPresetRow>()
    : { results: [] as MapPresetRow[] };
  let activeMapPackage: MapPackage | null = null;
  if (encounter!.map_package_json) {
    try { activeMapPackage = parseMapPackage(JSON.parse(encounter!.map_package_json)); } catch { activeMapPackage = null; }
  }

  if (tokens.results.length === 0) return null;
  const tokenById = new Map(tokens.results.map((token) => [token.id, token]));
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
      version: encounter!.version,
      status: encounter!.status,
      mapPackage: mapPackageForViewer(activeMapPackage, viewer),
      activeMapPresetId: encounter!.active_map_preset_id,
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
      const canSeeExactHp = viewer?.role === "dm" || controlledByViewer;
      return {
        id: token.id,
        name: token.name,
        x: token.x,
        y: token.y,
        artAsset: token.art_asset,
        kind: token.kind,
        size: token.size,
        speed: token.speed,
        hp: canSeeExactHp ? token.hp : null,
        maxHp: canSeeExactHp ? token.max_hp : null,
        healthState: coarseHealth(token.hp, token.max_hp),
        hidden: Boolean(token.is_hidden),
        summonerTokenId: token.summoner_token_id,
        initiative: token.initiative,
        initiativeGroupId: token.initiative_group_id,
        initiativeOrder: token.initiative_order,
        turnComplete: Boolean(token.turn_complete),
        movementUsed: token.movement_used,
        movementOrigin: token.movement_origin_x === null || token.movement_origin_x === undefined || token.movement_origin_y === null || token.movement_origin_y === undefined
          ? null
          : { x: token.movement_origin_x, y: token.movement_origin_y },
        effects: effects.results
          .filter((effect) => effect.token_id === token.id)
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
    annotations: annotations.results.filter((annotation) => viewer?.role === "dm" || pointVisibleToViewer(annotation, fogVisibility)).map((annotation) => ({
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
    savedMapPresets: savedMapPresets.results.flatMap((preset) => {
      try {
        const mapPackage = parseMapPackage(JSON.parse(preset.package_json));
        return mapPackage ? [{
          id: preset.id,
          name: preset.name,
          description: preset.description,
          sourcePrompt: preset.source_prompt,
          mapPackage,
          createdAt: preset.created_at,
          updatedAt: preset.updated_at,
        }] : [];
      } catch { return []; }
    }),
    availableArt: [...new Set([
      ...CHARACTER_ART_ASSETS,
      ...visibleTokens.flatMap((token) => token.art_asset ? [token.art_asset] : []),
    ])],
  };
  return projectedState;
}

async function recordAction(
  env: Env,
  encounterId: string,
  participantId: string,
  actionType: string,
  payload: unknown,
  now = Date.now(),
) {
  await env.DB.prepare(
    `INSERT INTO actions
      (id, encounter_id, participant_id, action_type, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      encounterId,
      participantId,
      actionType,
      JSON.stringify(payload),
      now,
    )
    .run();
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
  "token_created",
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
): Promise<Response> {
  const requestedVersion = Number(new URL(request.url).searchParams.get("since"));
  const lastVersion = Number.isFinite(requestedVersion) ? requestedVersion : 0;
  const encounter = await findEncounter(env, code);
  if (!encounter) return json({ error: "Encounter not found." }, { status: 404 });
  const viewer = await participantFromHeaders(request, env, encounter.id);
  // Version equality is authoritative: avoid loading tokens, effects, map
  // packages, chat, and dynamic sight polygons for an unchanged idle poll.
  if (encounter.version === lastVersion) {
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  }
  const state = await encounterState(env, code, viewer);
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
      `SELECT id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
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

type InitiativeLeader = {
  id: string;
  name: string;
  initiative: number | null;
  initiative_group_id: string | null;
  summoner_token_id: string | null;
  initiativeGroupId: string | null;
  summonerTokenId: string | null;
};

async function activeInitiativeLeaderIds(env: Env, encounter: EncounterRow) {
  if (encounter.status !== "active" || encounter.active_initiative_order === null) return [] as string[];
  const rows = await env.DB.prepare(
    `SELECT DISTINCT CASE WHEN summoner_token_id IS NULL THEN id ELSE summoner_token_id END AS id
     FROM tokens WHERE encounter_id = ? AND initiative_order = ?`,
  ).bind(encounter.id, encounter.active_initiative_order).all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

async function rebuildInitiativeOrders(
  env: Env,
  encounter: EncounterRow,
  now: number,
  activeLeaderIds: string[],
) {
  if (encounter.status !== "active") return;
  const tokens = await env.DB.prepare(
    `SELECT id, name, initiative, initiative_group_id, summoner_token_id
     FROM tokens WHERE encounter_id = ? ORDER BY name, id`,
  ).bind(encounter.id).all<InitiativeLeader>();
  const groups = orderedInitiativeGroups(tokens.results.map((token) => ({
    ...token,
    kind: "monster",
    artAsset: null,
    initiativeOrder: null,
    controlledByViewer: false,
    initiativeGroupId: token.initiative_group_id,
    summonerTokenId: token.summoner_token_id,
  }))) as Array<Array<InitiativeLeader & { kind: string; artAsset: null; initiativeOrder: null; controlledByViewer: false }>>;
  const activeOrder = Math.max(0, groups.findIndex((members) =>
    members.some((member) => activeLeaderIds.includes(member.id))));
  const statements = [env.DB.prepare(
    `UPDATE tokens SET initiative_order = NULL, updated_at = ? WHERE encounter_id = ?`,
  ).bind(now, encounter.id), ...groups.flatMap((members, order) => members.map((leader) => env.DB.prepare(
    `UPDATE tokens SET initiative_order = ?, updated_at = ?
     WHERE encounter_id = ? AND (id = ? OR summoner_token_id = ?)`,
  ).bind(order, now, encounter.id, leader.id, leader.id))), env.DB.prepare(
    `UPDATE encounters SET active_initiative_order = ?, updated_at = ? WHERE id = ?`,
  ).bind(groups.length ? activeOrder : null, now, encounter.id)];
  await env.DB.batch(statements);
}

async function advanceInitiative(
  env: Env,
  encounter: EncounterRow,
  now: number,
): Promise<{ round: number; activeOrder: number | null }> {
  const orders = await env.DB.prepare(
    `SELECT DISTINCT initiative_order AS initiative_order
     FROM tokens
     WHERE encounter_id = ? AND initiative_order IS NOT NULL
     ORDER BY initiative_order`,
  )
    .bind(encounter.id)
    .all<{ initiative_order: number }>();
  if (orders.results.length === 0) {
    await env.DB.prepare(
      `UPDATE encounters SET status = 'setup', current_round = 0,
       active_initiative_order = NULL, updated_at = ? WHERE id = ?`,
    )
      .bind(now, encounter.id)
      .run();
    return { round: 0, activeOrder: null };
  }
  const transition = nextInitiativeTurn(
    orders.results.map((row) => row.initiative_order),
    encounter.active_initiative_order,
    encounter.current_round,
  );
  const nextOrder = transition.activeOrder!;
  const nextRound = transition.round;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE tokens SET turn_complete = 0, movement_used = 0,
       movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ?
       WHERE encounter_id = ? AND initiative_order = ?`,
    ).bind(now, encounter.id, nextOrder),
    env.DB.prepare(
      `UPDATE encounters
       SET current_round = ?, active_initiative_order = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(nextRound, nextOrder, now, encounter.id),
  ]);
  return { round: nextRound, activeOrder: nextOrder };
}

async function handleCommand(
  env: Env,
  code: string,
  encounter: EncounterRow,
  participant: ParticipantRow,
  body: Record<string, unknown>,
  now: number,
): Promise<Response> {
  const rawCommand = cleanText(body.command, 40);
  if (!isCommandName(rawCommand)) return json({ error: "Unknown command." }, { status: 400 });
  const command: CommandRequest["command"] = rawCommand;
  const state = () => encounterState(env, code, participant);
  const requireDm = () =>
    participant.role === "dm"
      ? null
      : json({ error: "This action requires the DM role." }, { status: 403 });

  const chatHandoutContext = (): ChatHandoutCommandContext => ({
    encounter: {
      id: encounter.id,
      code: encounter.code,
      name: encounter.name,
      status: encounter.status,
      mapPackageJson: encounter.map_package_json,
      activeMapPresetId: encounter.active_map_preset_id,
      gridWidth: encounter.grid_width,
      gridHeight: encounter.grid_height,
      currentRound: encounter.current_round,
      activeInitiativeOrder: encounter.active_initiative_order,
      strictMovement: Boolean(encounter.strict_movement),
      updatedAt: encounter.updated_at,
    },
    participant,
    body,
    now,
    repository: createD1ChatHandoutRepository(env.DB),
    objectStorage: createR2HandoutObjectStorage(env.MAP_ASSETS),
    services: {
      createId: () => crypto.randomUUID(),
      loadState: state,
      bumpEncounter: () => bumpEncounter(env, encounter.id, now),
      recordAction: (actionType, payload) => recordAction(env, encounter.id, participant.id, actionType, payload, now),
    },
  });
  if (command === "send-chat-message") {
    return commandOutcomeResponse(await sendChatMessage(chatHandoutContext()));
  }
  if (command === "delete-handout") {
    return commandOutcomeResponse(await deleteHandout(chatHandoutContext()));
  }

  const annotationFogContext = (): AnnotationFogCommandContext => ({
    encounter: {
      id: encounter.id,
      code: encounter.code,
      name: encounter.name,
      status: encounter.status,
      mapPackageJson: encounter.map_package_json,
      activeMapPresetId: encounter.active_map_preset_id,
      gridWidth: encounter.grid_width,
      gridHeight: encounter.grid_height,
      currentRound: encounter.current_round,
      activeInitiativeOrder: encounter.active_initiative_order,
      strictMovement: Boolean(encounter.strict_movement),
      updatedAt: encounter.updated_at,
    },
    participant,
    body,
    now,
    repository: createD1AnnotationFogRepository(env.DB),
    services: {
      createId: () => crypto.randomUUID(),
      loadState: state,
      bumpEncounter: () => bumpEncounter(env, encounter.id, now),
      recordAction: (actionType, payload) => recordAction(env, encounter.id, participant.id, actionType, payload, now),
    },
  });
  if (command === "undo") {
    const stacks = await historyStacks(env, encounter.id, participant.id);
    const action = stacks.undo[0];
    if (!action) {
      return json({ error: "There is no reversible action in your ten-step history." }, { status: 409 });
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(action.payload_json) as Record<string, unknown>;
    } catch {
      return json({ error: "That historical action cannot be read safely." }, { status: 409 });
    }
    const tokenId = cleanTokenId(payload.tokenId);
    const activeLeaderIdsBeforeHistory = action.action_type === "initiative_set" || action.action_type === "initiative_group_set"
      ? await activeInitiativeLeaderIds(env, encounter)
      : [];
    let changes = 0;
    if (action.action_type === "token_moved") {
      const from = payload.from as { x?: unknown; y?: unknown } | undefined;
      const to = payload.to as { x?: unknown; y?: unknown } | undefined;
      const previousMovementOrigin = payload.previousMovementOrigin as { x?: unknown; y?: unknown } | null | undefined;
      const result = await env.DB.prepare(
        `UPDATE tokens SET x = ?, y = ?, movement_used = ?, movement_origin_x = ?, movement_origin_y = ?, updated_at = ?
         WHERE id = ? AND encounter_id = ? AND x = ? AND y = ?`,
      )
        .bind(Number(from?.x), Number(from?.y), Number(payload.previousMovementUsed) || 0,
          previousMovementOrigin ? Number(previousMovementOrigin.x) : null,
          previousMovementOrigin ? Number(previousMovementOrigin.y) : null,
          now, tokenId, encounter.id, Number(to?.x), Number(to?.y))
        .run();
      changes = result.meta.changes ?? 0;
    } else if (action.action_type === "hp_changed") {
      const result = await env.DB.prepare(
        "UPDATE tokens SET hp = ?, updated_at = ? WHERE id = ? AND encounter_id = ? AND hp = ?",
      )
        .bind(Number(payload.from), now, tokenId, encounter.id, Number(payload.to))
        .run();
      changes = result.meta.changes ?? 0;
    } else if (action.action_type === "initiative_set") {
      const result = await env.DB.prepare(
        `UPDATE tokens SET initiative = ?, initiative_group_id = ?, initiative_order = NULL,
         turn_complete = 0, movement_used = 0, movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ?
         WHERE id = ? AND encounter_id = ? AND initiative = ? AND initiative_group_id IS NULL`,
      )
        .bind(payload.from ?? null, payload.fromGroupId ?? null, now, tokenId, encounter.id, payload.to)
        .run();
      changes = result.meta.changes ?? 0;
    } else if (action.action_type === "initiative_group_set") {
      const members = Array.isArray(payload.members) ? payload.members as Array<Record<string, unknown>> : [];
      const groupId = cleanTokenId(payload.groupId);
      const current = members.length ? await env.DB.prepare(
        `SELECT id FROM tokens WHERE encounter_id = ? AND initiative_group_id = ? AND initiative = ?`,
      ).bind(encounter.id, groupId, payload.to).all<{ id: string }>() : { results: [] };
      if (current.results.length === members.length && members.every((member) => current.results.some((row) => row.id === cleanTokenId(member.tokenId)))) {
        const results = await env.DB.batch(members.map((member) => env.DB.prepare(
          `UPDATE tokens SET initiative = ?, initiative_group_id = ?, initiative_order = NULL,
           turn_complete = 0, movement_used = 0, movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ?
           WHERE id = ? AND encounter_id = ? AND initiative_group_id = ? AND initiative = ?`,
        ).bind(member.from ?? null, member.fromGroupId ?? null, now, cleanTokenId(member.tokenId), encounter.id, groupId, payload.to)));
        changes = results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
      }
    } else if (action.action_type === "effect_added") {
      const result = await env.DB.prepare(
        "DELETE FROM effects WHERE id = ? AND encounter_id = ?",
      )
        .bind(cleanTokenId(payload.effectId), encounter.id)
        .run();
      changes = result.meta.changes ?? 0;
    } else if (action.action_type === "effect_removed") {
      const effect = payload.effect as Record<string, unknown> | undefined;
      if (effect) {
        const result = await env.DB.prepare(
          `INSERT OR IGNORE INTO effects
           (id, encounter_id, token_id, name, effect_type, duration_rounds,
            expires_round, reminder_timing, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(cleanTokenId(effect.id), encounter.id, cleanTokenId(effect.tokenId), cleanText(effect.name, 48), cleanText(effect.effectType, 24), effect.durationRounds ?? null, effect.expiresRound ?? null, cleanText(effect.reminderTiming, 16) || "end", cleanParticipantId(effect.createdBy) || participant.id, Number(effect.createdAt) || now)
          .run();
        changes = result.meta.changes ?? 0;
      }
    } else if (action.action_type === "annotation_added") {
      const result = await env.DB.prepare(
        "DELETE FROM annotations WHERE id = ? AND encounter_id = ?",
      )
        .bind(cleanTokenId(payload.annotationId), encounter.id)
        .run();
      changes = result.meta.changes ?? 0;
    } else if (action.action_type === "annotation_removed") {
      const annotation = payload.annotation as Record<string, unknown> | undefined;
      if (annotation) {
        const result = await env.DB.prepare(
          `INSERT OR IGNORE INTO annotations
           (id, encounter_id, annotation_type, x, y, x2, y2, color, label,
            created_by, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(cleanTokenId(annotation.id), encounter.id, cleanText(annotation.annotationType, 24), Number(annotation.x), Number(annotation.y), annotation.x2 ?? null, annotation.y2 ?? null, cleanText(annotation.color, 16) || "#75c8d8", cleanText(annotation.label, 48) || null, cleanParticipantId(annotation.createdBy) || participant.id, annotation.expiresAt ?? null, Number(annotation.createdAt) || now)
          .run();
        changes = result.meta.changes ?? 0;
      }
    } else if (action.action_type === "token_created") {
      const result = await env.DB.prepare(
        `DELETE FROM tokens WHERE id = ? AND encounter_id = ?
         AND owner_participant_id IS NULL`,
      )
        .bind(tokenId, encounter.id)
        .run();
      changes = result.meta.changes ?? 0;
    } else if (action.action_type === "token_updated") {
      const previous = payload.previous as Record<string, unknown> | undefined;
      if (previous) {
        const current = await env.DB.prepare(
          "SELECT x, y, size FROM tokens WHERE id = ? AND encounter_id = ?",
        )
          .bind(tokenId, encounter.id)
          .first<{ x: number; y: number; size: CreatureSize }>();
        const result = await env.DB.prepare(
          `UPDATE tokens SET name = ?, size = ?, x = ?, y = ?, speed = ?, hp = ?, max_hp = ?, is_hidden = ?,
           art_asset = ?, updated_at = ? WHERE id = ? AND encounter_id = ?`,
        )
          .bind(cleanText(previous.name, 48), isCreatureSize(previous.size) ? previous.size : current?.size ?? "medium", Number.isFinite(Number(previous.x)) ? Number(previous.x) : current?.x ?? encounter.grid_width / 2, Number.isFinite(Number(previous.y)) ? Number(previous.y) : current?.y ?? encounter.grid_height / 2, Number(previous.speed), previous.hp ?? null, previous.maxHp ?? null, previous.hidden ? 1 : 0, previous.artAsset ?? null, now, tokenId, encounter.id)
          .run();
        changes = result.meta.changes ?? 0;
      }
    }
    const expectedChanges = action.action_type === "initiative_group_set"
      ? (Array.isArray(payload.members) ? payload.members.length : 0)
      : 1;
    if (changes !== expectedChanges || expectedChanges === 0) {
      return json({ error: historyConflictMessage("undone", action.action_type) }, { status: 409 });
    }
    if (action.action_type === "initiative_set" || action.action_type === "initiative_group_set") {
      await rebuildInitiativeOrders(env, encounter, now, activeLeaderIdsBeforeHistory);
    }
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "action_undone", {
      actionId: action.id,
      actionType: action.action_type,
    }, now);
    return json({ undone: true, actionType: action.action_type, state: await state() });
  }

  if (command === "redo") {
    const stacks = await historyStacks(env, encounter.id, participant.id);
    const action = stacks.redo[0];
    if (!action) {
      return json({ error: "There is no action available to redo." }, { status: 409 });
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(action.payload_json) as Record<string, unknown>;
    } catch {
      return json({ error: "That historical action cannot be read safely." }, { status: 409 });
    }
    const tokenId = cleanTokenId(payload.tokenId);
    const activeLeaderIdsBeforeHistory = action.action_type === "initiative_set" || action.action_type === "initiative_group_set"
      ? await activeInitiativeLeaderIds(env, encounter)
      : [];
    let changes = 0;
    if (action.action_type === "token_moved") {
      const from = payload.from as { x?: unknown; y?: unknown } | undefined;
      const to = payload.to as { x?: unknown; y?: unknown } | undefined;
      const movementOrigin = payload.movementOrigin as { x?: unknown; y?: unknown } | null | undefined;
      const result = await env.DB.prepare(
        `UPDATE tokens SET x = ?, y = ?, movement_used = ?, movement_origin_x = ?, movement_origin_y = ?, updated_at = ?
         WHERE id = ? AND encounter_id = ? AND x = ? AND y = ?`,
      )
        .bind(Number(to?.x), Number(to?.y), Number(payload.movementUsed) || 0,
          movementOrigin ? Number(movementOrigin.x) : null,
          movementOrigin ? Number(movementOrigin.y) : null,
          now, tokenId, encounter.id, Number(from?.x), Number(from?.y))
        .run();
      changes = result.meta.changes ?? 0;
    } else if (action.action_type === "hp_changed") {
      const result = await env.DB.prepare(
        "UPDATE tokens SET hp = ?, updated_at = ? WHERE id = ? AND encounter_id = ? AND hp = ?",
      )
        .bind(Number(payload.to), now, tokenId, encounter.id, Number(payload.from))
        .run();
      changes = result.meta.changes ?? 0;
    } else if (action.action_type === "initiative_set") {
      const result = await env.DB.prepare(
        `UPDATE tokens SET initiative = ?, initiative_group_id = NULL, initiative_order = NULL,
         turn_complete = 0, movement_used = 0, movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ?
         WHERE id = ? AND encounter_id = ? AND initiative IS ? AND initiative_group_id IS ?`,
      )
        .bind(payload.to, now, tokenId, encounter.id, payload.from ?? null, payload.fromGroupId ?? null)
        .run();
      changes = result.meta.changes ?? 0;
    } else if (action.action_type === "initiative_group_set") {
      const members = Array.isArray(payload.members) ? payload.members as Array<Record<string, unknown>> : [];
      const groupId = cleanTokenId(payload.groupId);
      const valid = members.length > 0 && await Promise.all(members.map((member) => env.DB.prepare(
        `SELECT id FROM tokens WHERE id = ? AND encounter_id = ? AND initiative IS ? AND initiative_group_id IS ?`,
      ).bind(cleanTokenId(member.tokenId), encounter.id, member.from ?? null, member.fromGroupId ?? null).first<{ id: string }>())) ;
      if (valid && valid.every(Boolean)) {
        const results = await env.DB.batch(members.map((member) => env.DB.prepare(
          `UPDATE tokens SET initiative = ?, initiative_group_id = ?, initiative_order = NULL,
           turn_complete = 0, movement_used = 0, movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ?
           WHERE id = ? AND encounter_id = ? AND initiative IS ? AND initiative_group_id IS ?`,
        ).bind(payload.to, groupId, now, cleanTokenId(member.tokenId), encounter.id, member.from ?? null, member.fromGroupId ?? null)));
        changes = results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
      }
    } else if (action.action_type === "effect_added") {
      const effect = (payload.effect ?? payload) as Record<string, unknown>;
      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO effects
         (id, encounter_id, token_id, name, effect_type, duration_rounds,
          expires_round, reminder_timing, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(cleanTokenId(effect.id ?? effect.effectId), encounter.id, cleanTokenId(effect.tokenId), cleanText(effect.name, 48), cleanText(effect.effectType, 24) || "effect", effect.durationRounds ?? null, effect.expiresRound ?? null, cleanText(effect.reminderTiming, 16) || "end", cleanParticipantId(effect.createdBy) || participant.id, Number(effect.createdAt) || now)
        .run();
      changes = result.meta.changes ?? 0;
    } else if (action.action_type === "effect_removed") {
      const result = await env.DB.prepare(
        "DELETE FROM effects WHERE id = ? AND encounter_id = ?",
      )
        .bind(cleanTokenId(payload.effectId), encounter.id)
        .run();
      changes = result.meta.changes ?? 0;
    } else if (action.action_type === "annotation_added") {
      const annotation = (payload.annotation ?? payload) as Record<string, unknown>;
      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO annotations
         (id, encounter_id, annotation_type, x, y, x2, y2, color, label,
          created_by, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(cleanTokenId(annotation.id ?? annotation.annotationId), encounter.id, cleanText(annotation.annotationType, 24), Number(annotation.x), Number(annotation.y), annotation.x2 ?? null, annotation.y2 ?? null, cleanText(annotation.color, 16) || "#f5c65c", cleanText(annotation.label, 48) || null, cleanParticipantId(annotation.createdBy) || participant.id, annotation.expiresAt ?? null, Number(annotation.createdAt) || now)
        .run();
      changes = result.meta.changes ?? 0;
    } else if (action.action_type === "annotation_removed") {
      const result = await env.DB.prepare(
        "DELETE FROM annotations WHERE id = ? AND encounter_id = ?",
      )
        .bind(cleanTokenId(payload.annotationId), encounter.id)
        .run();
      changes = result.meta.changes ?? 0;
    } else if (action.action_type === "token_created") {
      const token = (payload.token ?? payload) as Record<string, unknown>;
      const result = await env.DB.prepare(
        `INSERT OR IGNORE INTO tokens
         (id, encounter_id, name, x, y, art_asset, kind, size, speed, hp, max_hp,
          is_hidden, summoner_token_id, initiative, initiative_order, turn_complete,
          movement_used, owner_participant_id, owner_name, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, ?)`,
      )
        .bind(tokenId, encounter.id, cleanText(token.name, 48), Number(token.x), Number(token.y), token.artAsset ?? null, cleanText(token.kind, 16) || "monster", isCreatureSize(token.size) ? token.size : "medium", Number(token.speed) || 30, token.hp ?? null, token.maxHp ?? null, token.hidden ? 1 : 0, cleanTokenId(token.summonerTokenId) || null, token.initiative ?? null, token.initiativeOrder ?? null, now)
        .run();
      changes = result.meta.changes ?? 0;
    } else if (action.action_type === "token_updated") {
      const next = payload.next as Record<string, unknown> | undefined;
      if (next) {
        const current = await env.DB.prepare(
          "SELECT x, y, size FROM tokens WHERE id = ? AND encounter_id = ?",
        )
          .bind(tokenId, encounter.id)
          .first<{ x: number; y: number; size: CreatureSize }>();
        const result = await env.DB.prepare(
          `UPDATE tokens SET name = ?, size = ?, x = ?, y = ?, speed = ?, hp = ?, max_hp = ?, is_hidden = ?,
           art_asset = ?, updated_at = ? WHERE id = ? AND encounter_id = ?`,
        )
          .bind(cleanText(next.name, 48), isCreatureSize(next.size) ? next.size : current?.size ?? "medium", Number.isFinite(Number(next.x)) ? Number(next.x) : current?.x ?? encounter.grid_width / 2, Number.isFinite(Number(next.y)) ? Number(next.y) : current?.y ?? encounter.grid_height / 2, Number(next.speed), next.hp ?? null, next.maxHp ?? null, next.hidden ? 1 : 0, next.artAsset ?? null, now, tokenId, encounter.id)
          .run();
        changes = result.meta.changes ?? 0;
      }
    }
    const expectedChanges = action.action_type === "initiative_group_set"
      ? (Array.isArray(payload.members) ? payload.members.length : 0)
      : 1;
    if (changes !== expectedChanges || expectedChanges === 0) {
      return json({ error: historyConflictMessage("redone", action.action_type) }, { status: 409 });
    }
    if (action.action_type === "initiative_set" || action.action_type === "initiative_group_set") {
      await rebuildInitiativeOrders(env, encounter, now, activeLeaderIdsBeforeHistory);
    }
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "action_redone", {
      actionId: action.id,
      actionType: action.action_type,
    }, now);
    return json({ redone: true, actionType: action.action_type, state: await state() });
  }

  if (command === "rename-scenario") {
    const denied = requireDm();
    if (denied) return denied;
    const name = cleanText(body.name, 64);
    if (name.length < 3) {
      return json({ error: "Scenario name must be at least three characters." }, { status: 400 });
    }
    if (name !== encounter.name) {
      await env.DB.prepare(
        "UPDATE encounters SET name = ?, version = version + 1, updated_at = ? WHERE id = ?",
      ).bind(name, now, encounter.id).run();
      await recordAction(env, encounter.id, participant.id, "scenario_renamed", {
        previousName: encounter.name,
        name,
      }, now);
    }
    return json({
      renamed: name !== encounter.name,
      scenario: { code: encounter.code, name, status: encounter.status, updatedAt: name === encounter.name ? encounter.updated_at : now },
      state: await state(),
    });
  }

  if (command === "create-scenario") {
    const denied = requireDm();
    if (denied) return denied;
    const name = cleanText(body.name, 64);
    const mode = body.mode === "duplicate" ? "duplicate" : "party";
    if (name.length < 3) {
      return json({ error: "Scenario name must be at least three characters." }, { status: 400 });
    }
    const code = await uniqueScenarioCode(env, name);
    const scenarioId = crypto.randomUUID();
    const newParticipantId = crypto.randomUUID();
    const newSessionSecret = crypto.randomUUID();
    const sourceTokens = await env.DB.prepare(
      `SELECT id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
              summoner_token_id, initiative, initiative_group_id, initiative_order,
              turn_complete, movement_used, movement_origin_x, movement_origin_y,
              owner_participant_id, owner_name
       FROM tokens WHERE encounter_id = ? ORDER BY id`,
    ).bind(encounter.id).all<TokenRow>();
    const selectedTokens = mode === "duplicate"
      ? sourceTokens.results
      : sourceTokens.results.filter((token) => !token.summoner_token_id && baseTokenControllerName(token) !== "Kevin");
    if (selectedTokens.length === 0) {
      return json({ error: "The current encounter has no player characters to seed the new scenario." }, { status: 409 });
    }
    const copiedIds = new Map(selectedTokens.map((token) => [token.id, crypto.randomUUID()]));
    const duplicateMap = mode === "duplicate";
    const statements = [
      env.DB.prepare(
        `INSERT INTO encounters
         (id, code, name, version, status, map_asset, map_package_json, active_map_preset_id,
          grid_width, grid_height, current_round, active_initiative_order, strict_movement, updated_at)
         VALUES (?, ?, ?, 1, 'setup', ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
      ).bind(
        scenarioId,
        code,
        name,
        duplicateMap ? encounter.map_asset : "",
        duplicateMap ? encounter.map_package_json : null,
        null,
        encounter.grid_width,
        encounter.grid_height,
        duplicateMap ? encounter.strict_movement : 1,
        now,
      ),
      ...selectedTokens.map((token) => env.DB.prepare(
        `INSERT INTO tokens
         (id, encounter_id, name, x, y, art_asset, kind, size, speed, hp, max_hp,
          is_hidden, summoner_token_id, initiative, initiative_group_id, initiative_order,
          turn_complete, movement_used, movement_origin_x, movement_origin_y,
          owner_participant_id, owner_name, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, NULL, ?)`,
      ).bind(
        copiedIds.get(token.id),
        scenarioId,
        token.name,
        token.x,
        token.y,
        token.art_asset,
        token.kind,
        token.size,
        token.speed,
        duplicateMap ? token.hp : token.max_hp,
        token.max_hp,
        duplicateMap ? token.is_hidden : 0,
        token.summoner_token_id ? copiedIds.get(token.summoner_token_id) ?? null : null,
        now,
      )),
      env.DB.prepare(
        `INSERT INTO participants
         (id, encounter_id, name, role, session_secret, joined_at, last_seen_at)
         VALUES (?, ?, 'Kevin', 'dm', ?, ?, ?)`,
      ).bind(newParticipantId, scenarioId, newSessionSecret, now, now),
    ];
    await env.DB.batch(statements);
    await recordAction(env, scenarioId, newParticipantId, "scenario_created", {
      sourceEncounterId: encounter.id,
      mode,
      tokenCount: selectedTokens.length,
    }, now);
    const newParticipant: ParticipantRow = { id: newParticipantId, name: "Kevin", role: "dm" };
    return json({
      created: true,
      participantId: newParticipantId,
      sessionSecret: newSessionSecret,
      role: "dm",
      scenario: { code, name, status: "setup", updatedAt: now },
      state: await encounterState(env, code, newParticipant),
    });
  }

  if (command === "set-initiative") {
    const tokenId = cleanTokenId(body.tokenId);
    const initiative = Math.trunc(Number(body.initiative));
    const token = await env.DB.prepare(
      `SELECT id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
              summoner_token_id, initiative, initiative_group_id, initiative_order, turn_complete,
              movement_used, owner_participant_id, owner_name
       FROM tokens WHERE id = ? AND encounter_id = ?`,
    )
      .bind(tokenId, encounter.id)
      .first<TokenRow>();
    if (!token) return json({ error: "Token not found." }, { status: 404 });
    if (!(await canControlToken(env, encounter.id, token, participant))) {
      return json({ error: "You cannot set initiative for this token." }, { status: 403 });
    }
    if (encounter.status === "active" && participant.role !== "dm") {
      return json({ error: "Only the DM can correct initiative after combat starts." }, { status: 409 });
    }
    if (!Number.isInteger(initiative) || initiative < 0 || initiative > 99) {
      return json({ error: "Initiative must be a whole number from 0 to 99." }, { status: 400 });
    }
    const activeLeaderIds = await activeInitiativeLeaderIds(env, encounter);
    await env.DB.prepare(
      `UPDATE tokens SET initiative = ?, initiative_group_id = NULL, initiative_order = NULL,
       turn_complete = 0, movement_used = 0, movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ?
       WHERE id = ? AND encounter_id = ?`,
    )
      .bind(initiative, now, tokenId, encounter.id)
      .run();
    await rebuildInitiativeOrders(env, encounter, now, activeLeaderIds);
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "initiative_set", {
      tokenId,
      from: token.initiative,
      fromGroupId: token.initiative_group_id,
      to: initiative,
    }, now);
    return json({ updated: true, state: await state() });
  }

  if (command === "set-initiative-group") {
    const denied = requireDm();
    if (denied) return denied;
    const initiative = Math.trunc(Number(body.initiative));
    if (!Number.isInteger(initiative) || initiative < 0 || initiative > 99) {
      return json({ error: "Initiative must be a whole number from 0 to 99." }, { status: 400 });
    }
    const tokenIds = [...new Set(Array.isArray(body.tokenIds) ? body.tokenIds.map(cleanTokenId).filter(Boolean) : [])].slice(0, 100);
    if (tokenIds.length < 2) {
      return json({ error: "Choose at least two creatures for a shared initiative group." }, { status: 400 });
    }
    const placeholders = tokenIds.map(() => "?").join(", ");
    const tokens = await env.DB.prepare(
      `SELECT id, initiative, initiative_group_id, summoner_token_id
       FROM tokens WHERE encounter_id = ? AND id IN (${placeholders})`,
    ).bind(encounter.id, ...tokenIds).all<{
      id: string;
      initiative: number | null;
      initiative_group_id: string | null;
      summoner_token_id: string | null;
    }>();
    if (tokens.results.length !== tokenIds.length || tokens.results.some((token) => token.summoner_token_id)) {
      return json({ error: "Every initiative-group member must be a top-level creature in this encounter." }, { status: 400 });
    }
    const activeLeaderIds = await activeInitiativeLeaderIds(env, encounter);
    const groupId = crypto.randomUUID();
    await env.DB.batch(tokens.results.map((token) => env.DB.prepare(
      `UPDATE tokens SET initiative = ?, initiative_group_id = ?, initiative_order = NULL,
       turn_complete = 0, movement_used = 0, movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ? WHERE id = ? AND encounter_id = ?`,
    ).bind(initiative, groupId, now, token.id, encounter.id)));
    await rebuildInitiativeOrders(env, encounter, now, activeLeaderIds);
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "initiative_group_set", {
      groupId,
      to: initiative,
      members: tokens.results.map((token) => ({
        tokenId: token.id,
        from: token.initiative,
        fromGroupId: token.initiative_group_id,
      })),
    }, now);
    return json({ updated: true, groupId, state: await state() });
  }

  if (command === "start-combat") {
    const denied = requireDm();
    if (denied) return denied;
    const tokens = await env.DB.prepare(
      `SELECT id, name, initiative, initiative_group_id, summoner_token_id FROM tokens
       WHERE encounter_id = ? ORDER BY name, id`,
    )
      .bind(encounter.id)
      .all<{
        id: string;
        name: string;
        initiative: number | null;
        initiative_group_id: string | null;
        summoner_token_id: string | null;
      }>();
    const leaders = tokens.results
      .filter((token) => !token.summoner_token_id && token.initiative !== null)
      .sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0) || a.name.localeCompare(b.name));
    if (leaders.length === 0) {
      return json({ error: "Enter at least one initiative before starting combat." }, { status: 409 });
    }
    const groups = new Map<string, typeof leaders>();
    for (const leader of leaders) {
      const key = leader.initiative_group_id || leader.id;
      const members = groups.get(key);
      if (members) members.push(leader); else groups.set(key, [leader]);
    }
    const orderedGroups = [...groups.values()].sort((a, b) =>
      (b[0].initiative ?? 0) - (a[0].initiative ?? 0) || a[0].name.localeCompare(b[0].name));
    const statements = [env.DB.prepare(
      `UPDATE tokens SET initiative_order = NULL, turn_complete = 0,
       movement_used = 0, movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ? WHERE encounter_id = ?`,
    ).bind(now, encounter.id), ...orderedGroups.flatMap((members, order) => members.map((leader) =>
      env.DB.prepare(
        `UPDATE tokens SET initiative_order = ?, turn_complete = 0,
         movement_used = 0, movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ?
         WHERE encounter_id = ? AND (id = ? OR summoner_token_id = ?)`,
      ).bind(order, now, encounter.id, leader.id, leader.id),
    ))];
    statements.push(
      env.DB.prepare(
        `UPDATE encounters SET status = 'active', current_round = 1,
         active_initiative_order = 0, updated_at = ? WHERE id = ?`,
      ).bind(now, encounter.id),
    );
    await env.DB.batch(statements);
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "combat_started", {
      groups: orderedGroups.map((members, order) => ({ tokenIds: members.map((member) => member.id), order })),
    }, now);
    return json({ started: true, state: await state() });
  }

  if (command === "end-turn" || command === "advance-turn") {
    const tokenId = cleanTokenId(body.tokenId);
    if (encounter.status !== "active") {
      return json({ error: "Combat is not active." }, { status: 409 });
    }
    if (command === "advance-turn" && participant.role !== "dm") {
      return json({ error: "Only the DM can force the next turn." }, { status: 403 });
    }
    if (command === "end-turn") {
      const token = await env.DB.prepare(
        `SELECT id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
                summoner_token_id, initiative, initiative_order, turn_complete,
                movement_used, owner_participant_id, owner_name
         FROM tokens WHERE id = ? AND encounter_id = ?`,
      )
        .bind(tokenId, encounter.id)
        .first<TokenRow>();
      if (!token) return json({ error: "Token not found." }, { status: 404 });
      if (token.initiative_order !== encounter.active_initiative_order) {
        return json({ error: "That token is not in the active turn group." }, { status: 409 });
      }
      if (!(await canControlToken(env, encounter.id, token, participant))) {
        return json({ error: "You cannot end this token's turn." }, { status: 403 });
      }
      await env.DB.prepare(
        `UPDATE tokens SET turn_complete = 1, updated_at = ?
         WHERE encounter_id = ? AND initiative_order = ?`,
      ).bind(now, encounter.id, encounter.active_initiative_order).run();
    } else {
      await env.DB.prepare(
        `UPDATE tokens SET turn_complete = 1, updated_at = ?
         WHERE encounter_id = ? AND initiative_order = ?`,
      )
        .bind(now, encounter.id, encounter.active_initiative_order)
        .run();
    }
    const advanced = await advanceInitiative(env, encounter, now);
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "initiative_advanced", {
      tokenId: tokenId || null,
      ...advanced,
      forced: command === "advance-turn",
    }, now);
    return json({ advanced: true, ...advanced, state: await state() });
  }

  if (command === "correct-turn") {
    const denied = requireDm();
    if (denied) return denied;
    const round = Math.max(1, Math.trunc(Number(body.round)) || 1);
    const activeOrder = Math.trunc(Number(body.activeOrder));
    const exists = await env.DB.prepare(
      `SELECT 1 AS found FROM tokens
       WHERE encounter_id = ? AND initiative_order = ? LIMIT 1`,
    )
      .bind(encounter.id, activeOrder)
      .first<{ found: number }>();
    if (!exists) return json({ error: "Initiative position not found." }, { status: 404 });
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE encounters SET status = 'active', current_round = ?,
         active_initiative_order = ?, updated_at = ? WHERE id = ?`,
      ).bind(round, activeOrder, now, encounter.id),
      env.DB.prepare(
        `UPDATE tokens SET turn_complete = 0, movement_used = 0, movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ?
         WHERE encounter_id = ? AND initiative_order = ?`,
      ).bind(now, encounter.id, activeOrder),
    ]);
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "initiative_corrected", { round, activeOrder }, now);
    return json({ corrected: true, state: await state() });
  }

  if (command === "save-map-preset") {
    const denied = requireDm();
    if (denied) return denied;
    const mapPackage = cleanMapPackage(body.mapPackage);
    if (!mapPackage) return json({ error: "That map package is invalid or too large." }, { status: 400 });
    const name = cleanText(body.name, 72) || cleanText(mapPackage.name, 72) || "Untitled map";
    const description = cleanText(body.description, 240) || cleanText(mapPackage.description, 240);
    const sourcePrompt = cleanText(body.sourcePrompt, 600) || null;
    const requestedId = cleanTokenId(body.presetId);
    const presetId = requestedId || crypto.randomUUID();
    const serialized = JSON.stringify(mapPackage);
    if (requestedId) {
      const result = await env.DB.prepare(
        `UPDATE map_presets SET name = ?, description = ?, source_prompt = ?,
         package_json = ?, updated_at = ? WHERE id = ? AND encounter_id = ?`,
      ).bind(name, description, sourcePrompt, serialized, now, requestedId, encounter.id).run();
      if ((result.meta.changes ?? 0) === 0) return json({ error: "Saved map preset not found." }, { status: 404 });
    } else {
      await env.DB.prepare(
        `INSERT INTO map_presets
         (id, encounter_id, name, description, source_prompt, package_json,
          created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(presetId, encounter.id, name, description, sourcePrompt, serialized, participant.id, now, now).run();
    }
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, requestedId ? "map_preset_updated" : "map_preset_saved", { presetId, name }, now);
    return json({ saved: true, presetId, state: await state() });
  }

  if (command === "delete-map-preset") {
    const denied = requireDm();
    if (denied) return denied;
    const presetId = cleanTokenId(body.presetId);
    if (!presetId) return json({ error: "Saved map preset is required." }, { status: 400 });
    const result = await env.DB.prepare(
      "DELETE FROM map_presets WHERE id = ? AND encounter_id = ?",
    ).bind(presetId, encounter.id).run();
    if ((result.meta.changes ?? 0) === 0) return json({ error: "Saved map preset not found." }, { status: 404 });
    if (encounter.active_map_preset_id === presetId) {
      await env.DB.prepare("UPDATE encounters SET active_map_preset_id = NULL WHERE id = ?").bind(encounter.id).run();
    }
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "map_preset_deleted", { presetId }, now);
    return json({ deleted: true, state: await state() });
  }

  if (command === "apply-map-package") {
    const denied = requireDm();
    if (denied) return denied;
    const presetId = cleanTokenId(body.presetId) || null;
    let mapPackage = cleanMapPackage(body.mapPackage);
    let appliedPresetId: string | null = null;
    if (presetId) {
      const saved = await env.DB.prepare(
        "SELECT package_json FROM map_presets WHERE id = ? AND encounter_id = ?",
      ).bind(presetId, encounter.id).first<{ package_json: string }>();
      if (!saved) return json({ error: "Saved map preset not found." }, { status: 404 });
      const savedPackage = cleanMapPackage(saved.package_json);
      if (!mapPackage) mapPackage = savedPackage;
      if (savedPackage && mapPackage && JSON.stringify(savedPackage) === JSON.stringify(mapPackage)) appliedPresetId = presetId;
    }
    if (!mapPackage) return json({ error: "That map package is invalid or too large." }, { status: 400 });
    const serialized = JSON.stringify(mapPackage);
    const tokenRows = await env.DB.prepare(
      "SELECT id, x, y, size FROM tokens WHERE encounter_id = ?",
    ).bind(encounter.id).all<{ id: string; x: number; y: number; size: CreatureSize }>();
    const updates = tokenRows.results.map((token) => env.DB.prepare(
      "UPDATE tokens SET x = ?, y = ?, updated_at = ? WHERE id = ? AND encounter_id = ?",
    ).bind(
      clampTokenCoordinate(token.x, mapPackage!.width, token.size),
      clampTokenCoordinate(token.y, mapPackage!.height, token.size),
      now,
      token.id,
      encounter.id,
    ));
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE encounters SET map_package_json = ?, active_map_preset_id = ?,
         grid_width = ?, grid_height = ?, updated_at = ? WHERE id = ?`,
      ).bind(serialized, appliedPresetId, mapPackage.width, mapPackage.height, now, encounter.id),
      ...updates,
    ]);
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "map_package_applied", {
      presetId: appliedPresetId,
      mapId: mapPackage.id,
      name: mapPackage.name,
      previousMapPresetId: encounter.active_map_preset_id,
      previousGrid: { width: encounter.grid_width, height: encounter.grid_height },
      nextGrid: { width: mapPackage.width, height: mapPackage.height },
    }, now);
    return json({ applied: true, state: await state() });
  }

  if (command === "configure-encounter") {
    const denied = requireDm();
    if (denied) return denied;
    const status = ["setup", "active", "paused"].includes(String(body.status))
      ? String(body.status)
      : encounter.status;
    if (status === "setup") {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE encounters SET status = 'setup', current_round = 0,
           active_initiative_order = NULL, updated_at = ? WHERE id = ?`,
        ).bind(now, encounter.id),
        env.DB.prepare(
          `UPDATE tokens SET initiative_order = NULL, turn_complete = 0,
           movement_used = 0, movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ? WHERE encounter_id = ?`,
        ).bind(now, encounter.id),
      ]);
    } else {
      await env.DB.prepare(
        `UPDATE encounters SET status = ?, updated_at = ?
         WHERE id = ?`,
      )
        .bind(status, now, encounter.id)
        .run();
    }
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "encounter_configured", {
      previous: { status: encounter.status },
      next: { status },
    }, now);
    return json({ configured: true, state: await state() });
  }

  if (command === "set-strict-movement") {
    return commandOutcomeResponse(await setStrictMovement(annotationFogContext()));
  }
  if (command === "set-fog-mode") {
    return commandOutcomeResponse(await setFogMode(annotationFogContext()));
  }
  if (command === "set-vision-door-open") {
    return commandOutcomeResponse(await setVisionDoorOpen(annotationFogContext()));
  }
  if (command === "update-shared-fog") {
    return commandOutcomeResponse(await updateSharedFog(annotationFogContext()));
  }
  if (command === "create-spell-effect") {
    const spell = spellEffectById(body.spellId);
    if (!spell) return json({ error: "That spell effect is not available." }, { status: 400 });
    const summonerTokenId = cleanTokenId(body.summonerTokenId) || null;
    let summoner: TokenRow | null = null;
    if (summonerTokenId) {
      summoner = await env.DB.prepare(
        `SELECT id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
                summoner_token_id, initiative, initiative_group_id, initiative_order, turn_complete,
                movement_used, movement_origin_x, movement_origin_y, owner_participant_id, owner_name
         FROM tokens WHERE id = ? AND encounter_id = ?`,
      ).bind(summonerTokenId, encounter.id).first<TokenRow>();
      if (!summoner) return json({ error: "Caster token not found." }, { status: 404 });
    }
    if (participant.role === "player") {
      if (!summoner || summoner.kind !== "character" || summoner.summoner_token_id || !(await canControlToken(env, encounter.id, summoner, participant))) {
        return json({ error: "Player spell effects must belong to your character." }, { status: 403 });
      }
    }
    const x = clampTokenCoordinate(body.x, encounter.grid_width, spell.size);
    const y = clampTokenCoordinate(body.y, encounter.grid_height, spell.size);
    const tokenId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO tokens
       (id, encounter_id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
        summoner_token_id, initiative, initiative_order, turn_complete,
        movement_used, owner_participant_id, owner_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, ?, ?, ?, 0, 0, NULL, NULL, ?)`,
    ).bind(tokenId, encounter.id, spell.name, x, y, spell.artAsset, SPELL_EFFECT_KIND, spell.size,
      summonerTokenId, summoner?.initiative ?? null, summoner?.initiative_order ?? null, now).run();
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "token_created", {
      tokenId,
      token: {
        tokenId, name: spell.name, kind: SPELL_EFFECT_KIND, size: spell.size, x, y, speed: 0,
        hp: null, maxHp: null, hidden: false, summonerTokenId, artAsset: spell.artAsset,
        initiative: summoner?.initiative ?? null, initiativeGroupId: null,
        initiativeOrder: summoner?.initiative_order ?? null,
      },
    }, now);
    return json({ created: true, tokenId, state: await state() });
  }

  if (command === "create-token") {
    const name = cleanText(body.name, 48);
    if (!name) return json({ error: "Token name is required." }, { status: 400 });
    const requestedKind = ["character", "monster", "summon", "familiar"].includes(String(body.kind))
      ? String(body.kind)
      : "monster";
    const requestedArtAsset = String(body.artAsset ?? "");
    const artAsset = await isAllowedTokenArt(env, requestedArtAsset)
      ? requestedArtAsset
      : null;
    const size: CreatureSize = isCreatureSize(body.size) ? body.size : "medium";
    const x = clampTokenCoordinate(body.x, encounter.grid_width, size);
    const y = clampTokenCoordinate(body.y, encounter.grid_height, size);
    const speed = Math.min(120, Math.max(0, Math.trunc(Number(body.speed)) || 30));
    const maxHp = Number.isFinite(Number(body.maxHp)) ? Math.max(1, Math.trunc(Number(body.maxHp))) : null;
    const hp = maxHp === null ? null : Math.min(maxHp, Math.max(0, Math.trunc(Number(body.hp)) || maxHp));
    const summonerTokenId = cleanTokenId(body.summonerTokenId) || null;
    let summoner: TokenRow | null = null;
    if (summonerTokenId) {
      summoner = await env.DB.prepare(
        `SELECT id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
                summoner_token_id, initiative, initiative_group_id, initiative_order, turn_complete,
                movement_used, movement_origin_x, movement_origin_y, owner_participant_id, owner_name
         FROM tokens WHERE id = ? AND encounter_id = ?`,
      )
        .bind(summonerTokenId, encounter.id)
        .first<TokenRow>();
      if (!summoner) return json({ error: "Summoner token not found." }, { status: 404 });
    }
    if (participant.role === "player") {
      if (!summoner || summoner.kind !== "character" || summoner.summoner_token_id || !await canControlToken(env, encounter.id, summoner, participant)) {
        return json({ error: "Player-created creatures must be summons of your character." }, { status: 403 });
      }
    }
    const kind = participant.role === "player" ? "summon" : requestedKind;
    const hidden = participant.role === "dm" && Boolean(body.hidden);
    const tokenId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO tokens
       (id, encounter_id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
        summoner_token_id, initiative, initiative_order, turn_complete,
        movement_used, owner_participant_id, owner_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    )
      .bind(
        tokenId,
        encounter.id,
        name,
        x,
        y,
        artAsset,
        kind,
        size,
        speed,
        hp,
        maxHp,
        hidden ? 1 : 0,
        summonerTokenId,
        summoner?.initiative ?? null,
        summoner?.initiative_order ?? null,
        null,
        null,
        now,
      )
      .run();
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "token_created", {
      tokenId,
      token: { tokenId, name, kind, size, x, y, speed, hp, maxHp, hidden, summonerTokenId, artAsset, initiative: summoner?.initiative ?? null, initiativeGroupId: null, initiativeOrder: summoner?.initiative_order ?? null },
    }, now);
    return json({ created: true, tokenId, state: await state() });
  }

  if (command === "resize-spell-effect") {
    const tokenId = cleanTokenId(body.tokenId);
    const token = await env.DB.prepare(
      `SELECT id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
              summoner_token_id, initiative, initiative_order, turn_complete,
              movement_used, owner_participant_id, owner_name
       FROM tokens WHERE id = ? AND encounter_id = ?`,
    ).bind(tokenId, encounter.id).first<TokenRow>();
    if (!token || token.kind !== SPELL_EFFECT_KIND) {
      return json({ error: "Spell effect not found." }, { status: 404 });
    }
    if (!(await canControlToken(env, encounter.id, token, participant))) {
      return json({ error: "You cannot resize this spell effect." }, { status: 403 });
    }
    if (!isSpellAreaSize(body.size)) {
      return json({ error: "Choose a spell footprint from 5 to 20 feet." }, { status: 400 });
    }
    const size = body.size;
    const x = clampTokenCoordinate(token.x, encounter.grid_width, size);
    const y = clampTokenCoordinate(token.y, encounter.grid_height, size);
    await env.DB.prepare(
      "UPDATE tokens SET size = ?, x = ?, y = ?, updated_at = ? WHERE id = ? AND encounter_id = ?",
    ).bind(size, x, y, now, tokenId, encounter.id).run();
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "token_updated", {
      tokenId,
      previous: { name: token.name, size: token.size, x: token.x, y: token.y, speed: token.speed, hp: token.hp, maxHp: token.max_hp, hidden: Boolean(token.is_hidden), artAsset: token.art_asset },
      next: { name: token.name, size, x, y, speed: token.speed, hp: token.hp, maxHp: token.max_hp, hidden: Boolean(token.is_hidden), artAsset: token.art_asset },
    }, now);
    return json({ updated: true, state: await state() });
  }

  if (command === "update-token" || command === "apply-hp") {
    const tokenId = cleanTokenId(body.tokenId);
    const token = await env.DB.prepare(
      `SELECT id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
              summoner_token_id, initiative, initiative_order, turn_complete,
              movement_used, owner_participant_id, owner_name
       FROM tokens WHERE id = ? AND encounter_id = ?`,
    )
      .bind(tokenId, encounter.id)
      .first<TokenRow>();
    if (!token) return json({ error: "Token not found." }, { status: 404 });
    if (command === "update-token") {
      const denied = requireDm();
      if (denied) return denied;
      const name = cleanText(body.name, 48) || token.name;
      const speed = Number.isFinite(Number(body.speed))
        ? Math.min(120, Math.max(0, Math.trunc(Number(body.speed))))
        : token.speed;
      const hidden = typeof body.hidden === "boolean" ? (body.hidden ? 1 : 0) : token.is_hidden;
      const size: CreatureSize = isCreatureSize(body.size) ? body.size : token.size;
      const requestedArtAsset = String(body.artAsset ?? "");
      const artAsset = await isAllowedTokenArt(env, requestedArtAsset)
        ? requestedArtAsset
        : body.artAsset === ""
          ? null
          : token.art_asset;
      const maxHp = Number.isFinite(Number(body.maxHp))
        ? Math.max(1, Math.trunc(Number(body.maxHp)))
        : token.max_hp;
      const hp = maxHp === null ? null : Math.min(maxHp, token.hp ?? maxHp);
      const x = clampTokenCoordinate(token.x, encounter.grid_width, size);
      const y = clampTokenCoordinate(token.y, encounter.grid_height, size);
      await env.DB.prepare(
        `UPDATE tokens SET name = ?, size = ?, speed = ?, hp = ?, max_hp = ?, is_hidden = ?, art_asset = ?, x = ?, y = ?, updated_at = ?
         WHERE id = ? AND encounter_id = ?`,
      )
        .bind(name, size, speed, hp, maxHp, hidden, artAsset, x, y, now, tokenId, encounter.id)
        .run();
      await bumpEncounter(env, encounter.id, now);
      await recordAction(env, encounter.id, participant.id, "token_updated", {
        tokenId,
        previous: { name: token.name, size: token.size, x: token.x, y: token.y, speed: token.speed, hp: token.hp, maxHp: token.max_hp, hidden: Boolean(token.is_hidden), artAsset: token.art_asset },
        next: { name, size, x, y, speed, hp, maxHp, hidden: Boolean(hidden), artAsset },
      }, now);
      return json({ updated: true, state: await state() });
    }
    if (!(await canControlToken(env, encounter.id, token, participant))) {
      return json({ error: "You cannot change this token's HP." }, { status: 403 });
    }
    if (token.max_hp === null) {
      return json({ error: "Configure maximum HP before applying damage or healing." }, { status: 409 });
    }
    const delta = Math.trunc(Number(body.delta));
    if (!Number.isFinite(delta) || delta === 0) {
      return json({ error: "Enter non-zero damage or healing." }, { status: 400 });
    }
    const previousHp = token.hp ?? token.max_hp;
    const hp = Math.min(token.max_hp, Math.max(0, previousHp + delta));
    const concentration = await env.DB.prepare(
      `SELECT count(*) AS count FROM effects
       WHERE token_id = ? AND effect_type = 'concentration'`,
    )
      .bind(tokenId)
      .first<{ count: number }>();
    const concentrationCheckRequired = delta < 0 && (concentration?.count ?? 0) > 0;
    await env.DB.prepare(
      "UPDATE tokens SET hp = ?, updated_at = ? WHERE id = ? AND encounter_id = ?",
    )
      .bind(hp, now, tokenId, encounter.id)
      .run();
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "hp_changed", {
      tokenId,
      from: previousHp,
      to: hp,
      concentrationCheckRequired,
    }, now);
    return json({ updated: true, concentrationCheckRequired, state: await state() });
  }

  if (command === "add-effect") {
    const tokenId = cleanTokenId(body.tokenId);
    const token = await env.DB.prepare(
      `SELECT id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
              summoner_token_id, initiative, initiative_order, turn_complete,
              movement_used, owner_participant_id, owner_name
       FROM tokens WHERE id = ? AND encounter_id = ?`,
    )
      .bind(tokenId, encounter.id)
      .first<TokenRow>();
    if (!token) return json({ error: "Token not found." }, { status: 404 });
    if (!(await canControlToken(env, encounter.id, token, participant))) {
      return json({ error: "You cannot add an effect to this token." }, { status: 403 });
    }
    const name = cleanText(body.name, 48);
    if (!name) return json({ error: "Effect name is required." }, { status: 400 });
    const effectType = ["condition", "effect", "concentration"].includes(String(body.effectType))
      ? String(body.effectType)
      : "condition";
    const durationRounds = Number.isFinite(Number(body.durationRounds))
      ? Math.max(1, Math.min(99, Math.trunc(Number(body.durationRounds))))
      : null;
    const expiresRound = durationRounds === null
      ? null
      : Math.max(1, encounter.current_round || 1) + durationRounds;
    const reminderTiming = body.reminderTiming === "start" ? "start" : "end";
    const effectId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO effects
       (id, encounter_id, token_id, name, effect_type, duration_rounds,
        expires_round, reminder_timing, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(effectId, encounter.id, tokenId, name, effectType, durationRounds, expiresRound, reminderTiming, participant.id, now)
      .run();
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "effect_added", {
      effectId,
      tokenId,
      effect: { id: effectId, tokenId, name, effectType, durationRounds, expiresRound, reminderTiming, createdBy: participant.id, createdAt: now },
    }, now);
    return json({ added: true, effectId, state: await state() });
  }

  if (command === "remove-effect") {
    const effectId = cleanTokenId(body.effectId);
    const effect = await env.DB.prepare(
      `SELECT e.id, e.token_id, e.name, e.effect_type, e.duration_rounds,
              e.expires_round, e.reminder_timing, e.created_by, e.created_at,
              t.name AS token_name, t.x, t.y, t.art_asset, t.kind, t.size, t.speed,
              t.hp, t.max_hp, t.is_hidden, t.summoner_token_id, t.initiative,
              t.initiative_order, t.turn_complete, t.movement_used,
              t.owner_participant_id, t.owner_name
       FROM effects e JOIN tokens t ON t.id = e.token_id
       WHERE e.id = ? AND e.encounter_id = ?`,
    )
      .bind(effectId, encounter.id)
      .first<{
        id: string;
        token_id: string;
        name: string;
        effect_type: string;
        duration_rounds: number | null;
        expires_round: number | null;
        reminder_timing: string;
        created_by: string;
        created_at: number;
        token_name: string;
        x: number;
        y: number;
        art_asset: string | null;
        kind: string;
        size: CreatureSize;
        speed: number;
        hp: number | null;
        max_hp: number | null;
        is_hidden: number;
        owner_participant_id: string | null;
        owner_name: string | null;
      summoner_token_id: string | null;
      initiative: number | null;
      initiative_group_id: string | null;
      initiative_order: number | null;
        turn_complete: number;
        movement_used: number;
      }>();
    if (!effect) return json({ error: "Effect not found." }, { status: 404 });
    const allowed = await canControlToken(env, encounter.id, {
      id: effect.token_id,
      name: effect.token_name,
      x: effect.x,
      y: effect.y,
      art_asset: effect.art_asset,
      kind: effect.kind,
      size: effect.size,
      speed: effect.speed,
      hp: effect.hp,
      max_hp: effect.max_hp,
      is_hidden: effect.is_hidden,
      summoner_token_id: effect.summoner_token_id,
      initiative: effect.initiative,
      initiative_group_id: effect.initiative_group_id,
      initiative_order: effect.initiative_order,
      turn_complete: effect.turn_complete,
      movement_used: effect.movement_used,
      owner_participant_id: effect.owner_participant_id,
      owner_name: effect.owner_name,
    }, participant);
    if (!allowed) return json({ error: "You cannot remove this effect." }, { status: 403 });
    await env.DB.prepare("DELETE FROM effects WHERE id = ? AND encounter_id = ?")
      .bind(effectId, encounter.id)
      .run();
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "effect_removed", {
      effectId,
      tokenId: effect.token_id,
      effect: {
        id: effect.id,
        tokenId: effect.token_id,
        name: effect.name,
        effectType: effect.effect_type,
        durationRounds: effect.duration_rounds,
        expiresRound: effect.expires_round,
        reminderTiming: effect.reminder_timing,
        createdBy: effect.created_by,
        createdAt: effect.created_at,
      },
    }, now);
    return json({ removed: true, state: await state() });
  }

  if (command === "add-annotation") {
    return commandOutcomeResponse(await addAnnotation(annotationFogContext()));
  }
  if (command === "clear-annotations") {
    return commandOutcomeResponse(await clearAnnotations(annotationFogContext()));
  }
  if (command === "remove-annotation") {
    return commandOutcomeResponse(await removeAnnotation(annotationFogContext()));
  }
  if (command === "delete-token") {
    const tokenId = cleanTokenId(body.tokenId);
    const token = await env.DB.prepare(
      `SELECT id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
              summoner_token_id, initiative, initiative_group_id, initiative_order, turn_complete,
              movement_used, movement_origin_x, movement_origin_y, owner_participant_id, owner_name
       FROM tokens WHERE id = ? AND encounter_id = ?`,
    ).bind(tokenId, encounter.id).first<TokenRow>();
    if (!token) return json({ error: "Token not found." }, { status: 404 });
    if (participant.role !== "dm" && (token.kind !== SPELL_EFFECT_KIND || !(await canControlToken(env, encounter.id, token, participant)))) {
      return json({ error: "Only the DM can delete this token." }, { status: 403 });
    }
    await env.DB.prepare("DELETE FROM tokens WHERE id = ? AND encounter_id = ?")
      .bind(tokenId, encounter.id)
      .run();
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "token_deleted", { tokenId }, now);
    return json({ deleted: true, state: await state() });
  }

  return json({ error: "Unknown encounter command." }, { status: 400 });
}

async function handleApi(
  request: Request,
  env: Env,
  code: string,
  action: string,
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
    const state = await encounterState(env, code, viewer);
    return state
      ? json(state)
      : json({ error: "Encounter not found." }, { status: 404 });
  }
  if (action === "events") {
    return handleStatePoll(request, env, code);
  }

  const encounter = await findEncounter(env, code);
  if (!encounter) return json({ error: "Encounter not found." }, { status: 404 });

  const body = await readJson(request);
  const now = Date.now();
  if (action === "join") {
    const participantName = cleanName(body.participantName);
    const participantRole = cleanRole(body.role);
    if (!participantName) {
      return json({ error: "Display name is required." }, { status: 400 });
    }

    const participantId = crypto.randomUUID();
    const sessionSecret = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO participants
        (id, encounter_id, name, role, session_secret, joined_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        participantId,
        encounter.id,
        participantName,
        participantRole,
        sessionSecret,
        now,
        now,
      )
      .run();
    await recordAction(env, encounter.id, participantId, "participant_joined", {
      name: participantName,
      role: participantRole,
    });
    const joinedParticipant: ParticipantRow = {
      id: participantId,
      name: participantName,
      role: participantRole,
    };
    return json({
      participantId,
      sessionSecret,
      role: participantRole,
      state: await encounterState(env, code, joinedParticipant),
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
    return handleCommand(env, code, encounter, participant, body, now);
  }

  const tokenId = cleanTokenId(body.tokenId);
  if (!tokenId) {
    return json({ error: "Token is required." }, { status: 400 });
  }
  const token = await env.DB.prepare(
    `SELECT id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
            summoner_token_id, initiative, initiative_order, turn_complete,
            movement_used, movement_origin_x, movement_origin_y, owner_participant_id, owner_name
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
        { error: policyDenial.error, state: await encounterState(env, code, participant) },
        { status: policyDenial.status },
      );
    }
    const requestedX = Number(body.x);
    const requestedY = Number(body.y);
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
    const x = clampTokenCoordinate(requestedX, encounter.grid_width, token.size);
    const y = clampTokenCoordinate(requestedY, encounter.grid_height, token.size);
    const isSpellEffect = token.kind === SPELL_EFFECT_KIND;
    const previous = { x: token.x, y: token.y };
    const previousMovementOrigin = token.movement_origin_x === null || token.movement_origin_x === undefined || token.movement_origin_y === null || token.movement_origin_y === undefined
      ? null
      : { x: token.movement_origin_x, y: token.movement_origin_y };
    const movementOrigin = isSpellEffect ? null : encounter.status === "active" ? previousMovementOrigin ?? previous : previousMovementOrigin;
    const distance = isSpellEffect ? 0 : calculateDirectDistance(movementOrigin ?? previous, { x, y }, 5);
    const overBudget = !isSpellEffect && encounter.status === "active" && distance > token.speed + 0.05;
    const movementUsed = isSpellEffect ? 0 : encounter.status === "active"
      ? distance
      : token.movement_used;
    const result = await env.DB.prepare(
      `UPDATE tokens
       SET x = ?, y = ?, movement_used = ?, movement_origin_x = ?, movement_origin_y = ?, updated_at = ?
       WHERE id = ? AND encounter_id = ?`,
    )
      .bind(x, y, movementUsed, movementOrigin?.x ?? null, movementOrigin?.y ?? null, now, tokenId, encounter.id)
      .run();
    if ((result.meta.changes ?? 0) !== 1) {
      return json(
        { error: "The token could not be moved.", state: await encounterState(env, code, participant) },
        { status: 409 },
      );
    }
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participantId, "token_moved", {
      tokenId,
      from: previous,
      to: { x, y },
      distance,
      previousMovementUsed: token.movement_used,
      previousMovementOrigin,
      movementOrigin,
      movementUsed,
      overBudget,
    });
    return json({ moved: true, distance, movementUsed, overBudget, state: await encounterState(env, code, participant) });
  }

  return json({ error: "Method not allowed." }, { status: 405 });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: WorkerExecutionContext): Promise<Response> {
    const url = new URL(request.url);

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
        console.error("Creature catalog API error", error);
        return json({ error: "The creature catalog is temporarily unavailable." }, { status: 500 });
      }
    }

    if (url.pathname === "/api/encounters") {
      try {
        return await handleEncounterList(request, env);
      } catch (error) {
        console.error("Encounter list API error", error);
        return json({ error: "The scenario list is temporarily unavailable." }, { status: 500 });
      }
    }

    if (url.pathname === "/api/catalog/import") {
      try {
        return await handleCreatureCatalogImport(request, env);
      } catch (error) {
        console.error("Creature catalog import error", error);
        return json({ error: "The creature catalog batch could not be imported." }, { status: 500 });
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
        console.error("Handout API error", error);
        return json({ error: "The handout service is temporarily unavailable." }, { status: 500 });
      }
    }

    const apiMatch = url.pathname.match(API_ROUTE);
    if (apiMatch) {
      try {
        return await handleApi(
          request,
          env,
          cleanCode(apiMatch[1]),
          apiMatch[2],
        );
      } catch (error) {
        console.error("Battle map API error", error);
        return json({ error: "The encounter service is temporarily unavailable." }, { status: 500 });
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
