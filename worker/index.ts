import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  TOKEN_ART_ASSETS,
  type CreatureSize,
  isCreatureSize,
  tokenRadiusCells,
} from "../shared/creature-library";
import { parseMapPackage, type MapPackage } from "../shared/map-package";
import { FULL_SCENE_MAPS, createFullSceneMap } from "../shared/full-scene-maps";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MAP_ASSETS?: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type EncounterRow = {
  id: string;
  code: string;
  name: string;
  version: number;
  status: string;
  map_asset: string;
  map_package_json: string | null;
  active_map_preset_id: string | null;
  grid_width: number;
  grid_height: number;
  current_round: number;
  active_initiative_order: number | null;
  updated_at: number;
};

type TokenRow = {
  id: string;
  name: string;
  x: number;
  y: number;
  art_asset: string | null;
  kind: string;
  size: CreatureSize;
  speed: number;
  hp: number | null;
  max_hp: number | null;
  is_hidden: number;
  summoner_token_id: string | null;
  initiative: number | null;
  initiative_order: number | null;
  turn_complete: number;
  movement_used: number;
  owner_participant_id: string | null;
  owner_name: string | null;
};

type ParticipantRow = {
  id: string;
  name: string;
  role: "dm" | "player";
};

type EffectRow = {
  id: string;
  token_id: string;
  name: string;
  effect_type: string;
  duration_rounds: number | null;
  expires_round: number | null;
  reminder_timing: string;
};

type AnnotationRow = {
  id: string;
  annotation_type: string;
  x: number;
  y: number;
  x2: number | null;
  y2: number | null;
  color: string;
  label: string | null;
  created_by: string;
  expires_at: number | null;
};

type ActionRow = {
  id: string;
  action_type: string;
  payload_json: string;
  created_at: number;
};

type MapPresetRow = {
  id: string;
  name: string;
  description: string;
  source_prompt: string | null;
  package_json: string;
  created_at: number;
  updated_at: number;
};

const PARTICIPANT_PRESENCE_TTL_MS = 120_000;
const PING_TTL_MS = 2_000;
const API_ROUTE =
  /^\/api\/encounters\/([^/]+)\/(join|state|events|heartbeat|claim|relinquish|move|command)$/;

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
  "scene-kits/forest-log.png",
  "scene-kits/forest-rocks.png",
  "scene-kits/temple-debris.png",
  "scene-kits/temple-table.png",
  "scene-kits/coast-boat.png",
  "scene-kits/coast-barricade.png",
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

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
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

async function ensureSchema(env: Env): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = env.DB;
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS encounters (
          id TEXT PRIMARY KEY NOT NULL,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          version INTEGER DEFAULT 1 NOT NULL,
          status TEXT DEFAULT 'setup' NOT NULL,
          map_asset TEXT DEFAULT '' NOT NULL,
          map_package_json TEXT,
          active_map_preset_id TEXT,
          grid_width INTEGER DEFAULT 16 NOT NULL,
          grid_height INTEGER DEFAULT 11 NOT NULL,
          current_round INTEGER DEFAULT 0 NOT NULL,
          active_initiative_order INTEGER,
          updated_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS participants (
          id TEXT PRIMARY KEY NOT NULL,
          encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          role TEXT DEFAULT 'player' NOT NULL,
          session_secret TEXT NOT NULL,
          joined_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS tokens (
          id TEXT PRIMARY KEY NOT NULL,
          encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          x REAL NOT NULL,
          y REAL NOT NULL,
          art_asset TEXT,
          kind TEXT DEFAULT 'character' NOT NULL,
          size TEXT DEFAULT 'medium' NOT NULL,
          speed INTEGER DEFAULT 30 NOT NULL,
          hp INTEGER,
          max_hp INTEGER,
          is_hidden INTEGER DEFAULT 0 NOT NULL,
          summoner_token_id TEXT,
          initiative INTEGER,
          initiative_order INTEGER,
          turn_complete INTEGER DEFAULT 0 NOT NULL,
          movement_used REAL DEFAULT 0 NOT NULL,
          owner_participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
          owner_name TEXT,
          updated_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS actions (
          id TEXT PRIMARY KEY NOT NULL,
          encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
          participant_id TEXT NOT NULL,
          action_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS effects (
          id TEXT PRIMARY KEY NOT NULL,
          encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
          token_id TEXT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          effect_type TEXT DEFAULT 'condition' NOT NULL,
          duration_rounds INTEGER,
          expires_round INTEGER,
          reminder_timing TEXT DEFAULT 'end' NOT NULL,
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS annotations (
          id TEXT PRIMARY KEY NOT NULL,
          encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
          annotation_type TEXT NOT NULL,
          x REAL NOT NULL,
          y REAL NOT NULL,
          x2 REAL,
          y2 REAL,
          color TEXT DEFAULT '#f5c65c' NOT NULL,
          label TEXT,
          created_by TEXT NOT NULL,
          expires_at INTEGER,
          created_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS map_presets (
          id TEXT PRIMARY KEY NOT NULL,
          encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT DEFAULT '' NOT NULL,
          source_prompt TEXT,
          package_json TEXT NOT NULL,
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS idx_participants_encounter_id ON participants(encounter_id)",
        ),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS idx_tokens_encounter_id ON tokens(encounter_id)",
        ),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS idx_actions_encounter_created_at ON actions(encounter_id, created_at)",
        ),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS idx_effects_encounter_token ON effects(encounter_id, token_id)",
        ),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS idx_annotations_encounter_created_at ON annotations(encounter_id, created_at)",
        ),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS idx_map_presets_encounter_updated ON map_presets(encounter_id, updated_at)",
        ),
      ]);

      // Preserve local/preview databases created by the earlier POC schema.
      const participantColumns = await db
        .prepare("PRAGMA table_info(participants)")
        .all<{ name: string }>();
      if (
        !participantColumns.results.some(
          (column) => column.name === "session_secret",
        )
      ) {
        await db
          .prepare("ALTER TABLE participants ADD COLUMN session_secret TEXT")
          .run();
        await db
          .prepare(
            `UPDATE participants
             SET session_secret = lower(hex(randomblob(32)))
             WHERE session_secret IS NULL`,
          )
          .run();
      }
      if (!participantColumns.results.some((column) => column.name === "role")) {
        await db
          .prepare("ALTER TABLE participants ADD COLUMN role TEXT DEFAULT 'player' NOT NULL")
          .run();
      }
      await db
        .prepare(
          "CREATE UNIQUE INDEX IF NOT EXISTS participants_session_secret_unique ON participants(session_secret)",
        )
        .run();

      const tokenColumns = await db
        .prepare("PRAGMA table_info(tokens)")
        .all<{ name: string }>();
      if (
        !tokenColumns.results.some(
          (column) => column.name === "owner_participant_id",
        )
      ) {
        await db
          .prepare("ALTER TABLE tokens ADD COLUMN owner_participant_id TEXT")
          .run();
      }
      if (
        !tokenColumns.results.some((column) => column.name === "owner_name")
      ) {
        await db.prepare("ALTER TABLE tokens ADD COLUMN owner_name TEXT").run();
      }
      const tokenAdditions = [
        ["art_asset", "ALTER TABLE tokens ADD COLUMN art_asset TEXT"],
        ["kind", "ALTER TABLE tokens ADD COLUMN kind TEXT DEFAULT 'character' NOT NULL"],
        ["size", "ALTER TABLE tokens ADD COLUMN size TEXT DEFAULT 'medium' NOT NULL"],
        ["speed", "ALTER TABLE tokens ADD COLUMN speed INTEGER DEFAULT 30 NOT NULL"],
        ["hp", "ALTER TABLE tokens ADD COLUMN hp INTEGER"],
        ["max_hp", "ALTER TABLE tokens ADD COLUMN max_hp INTEGER"],
        ["is_hidden", "ALTER TABLE tokens ADD COLUMN is_hidden INTEGER DEFAULT 0 NOT NULL"],
        ["summoner_token_id", "ALTER TABLE tokens ADD COLUMN summoner_token_id TEXT"],
        ["initiative", "ALTER TABLE tokens ADD COLUMN initiative INTEGER"],
        ["initiative_order", "ALTER TABLE tokens ADD COLUMN initiative_order INTEGER"],
        ["turn_complete", "ALTER TABLE tokens ADD COLUMN turn_complete INTEGER DEFAULT 0 NOT NULL"],
        ["movement_used", "ALTER TABLE tokens ADD COLUMN movement_used REAL DEFAULT 0 NOT NULL"],
      ] as const;
      for (const [columnName, statement] of tokenAdditions) {
        if (!tokenColumns.results.some((column) => column.name === columnName)) {
          await db.prepare(statement).run();
        }
      }

      const encounterColumns = await db
        .prepare("PRAGMA table_info(encounters)")
        .all<{ name: string }>();
      const encounterAdditions = [
        ["status", "ALTER TABLE encounters ADD COLUMN status TEXT DEFAULT 'setup' NOT NULL"],
        ["map_asset", "ALTER TABLE encounters ADD COLUMN map_asset TEXT DEFAULT '' NOT NULL"],
        ["map_package_json", "ALTER TABLE encounters ADD COLUMN map_package_json TEXT"],
        ["active_map_preset_id", "ALTER TABLE encounters ADD COLUMN active_map_preset_id TEXT"],
        ["grid_width", "ALTER TABLE encounters ADD COLUMN grid_width INTEGER DEFAULT 16 NOT NULL"],
        ["grid_height", "ALTER TABLE encounters ADD COLUMN grid_height INTEGER DEFAULT 11 NOT NULL"],
        ["current_round", "ALTER TABLE encounters ADD COLUMN current_round INTEGER DEFAULT 0 NOT NULL"],
        ["active_initiative_order", "ALTER TABLE encounters ADD COLUMN active_initiative_order INTEGER"],
      ] as const;
      for (const [columnName, statement] of encounterAdditions) {
        if (!encounterColumns.results.some((column) => column.name === columnName)) {
          await db.prepare(statement).run();
        }
      }
      await db
        .prepare("DROP INDEX IF EXISTS tokens_owner_participant_id_unique")
        .run();
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS idx_tokens_owner_participant_id
           ON tokens(owner_participant_id)`,
        )
        .run();

      const now = Date.now();
      const seedResults = await db.batch([
        db.prepare(
          `INSERT OR IGNORE INTO encounters (id, code, name, version, updated_at)
           VALUES (?, ?, ?, 1, ?)`,
        ).bind("encounter-ember-keep", "EMBER-KEEP", "The Ember Keep", now),
        db.prepare(
          `INSERT OR IGNORE INTO tokens
            (id, encounter_id, name, x, y, owner_participant_id, owner_name, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
        ).bind(
          "token-bronze-warden",
          "encounter-ember-keep",
          "Bronze Warden",
          7,
          5,
          now,
        ),
        db.prepare(
          `INSERT OR IGNORE INTO tokens
            (id, encounter_id, name, x, y, owner_participant_id, owner_name, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
        ).bind(
          "token-ember-scout",
          "encounter-ember-keep",
          "Ember Scout",
          5.5,
          3.5,
          now,
        ),
        db.prepare(
          `INSERT OR IGNORE INTO tokens
            (id, encounter_id, name, x, y, owner_participant_id, owner_name, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
        ).bind(
          "token-ash-mystic",
          "encounter-ember-keep",
          "Ash Mystic",
          10.5,
          7.5,
          now,
        ),
      ]);
      if (
        seedResults
          .slice(1)
          .some((result) => (result.meta.changes ?? 0) > 0)
      ) {
        await db
          .prepare(
            "UPDATE encounters SET version = version + 1, updated_at = ? WHERE id = ?",
          )
          .bind(now, "encounter-ember-keep")
          .run();
      }
      const portraitResults = await db.batch([
        db.prepare(
          `UPDATE tokens SET name = ?, art_asset = ?, kind = 'character', updated_at = ?
           WHERE id = ? AND name = ?`,
        ).bind("Dar'eleth", TOKEN_ART_ASSETS[0], now, "token-bronze-warden", "Bronze Warden"),
        db.prepare(
          `UPDATE tokens SET name = ?, art_asset = ?, kind = 'character', updated_at = ?
           WHERE id = ? AND name = ?`,
        ).bind("Malichar", TOKEN_ART_ASSETS[1], now, "token-ember-scout", "Ember Scout"),
        db.prepare(
          `UPDATE tokens SET name = ?, art_asset = ?, kind = 'character', updated_at = ?
           WHERE id = ? AND name = ?`,
        ).bind("Jelton", TOKEN_ART_ASSETS[2], now, "token-ash-mystic", "Ash Mystic"),
      ]);
      if (portraitResults.some((result) => (result.meta.changes ?? 0) > 0)) {
        await db.prepare(
          "UPDATE encounters SET version = version + 1, updated_at = ? WHERE id = ?",
        ).bind(now, "encounter-ember-keep").run();
      }
      const defaultScene = createFullSceneMap(FULL_SCENE_MAPS[0]);
      const migratedScenes = await db.prepare(
        `UPDATE encounters SET map_package_json = ?, active_map_preset_id = NULL,
         map_asset = '', grid_width = ?, grid_height = ?, version = version + 1,
         updated_at = ? WHERE map_package_json IS NULL OR instr(map_package_json, '"visual"') = 0`,
      ).bind(JSON.stringify(defaultScene), defaultScene.width, defaultScene.height, now).run();
      if ((migratedScenes.meta.changes ?? 0) > 0) {
        await db.prepare(
          `INSERT INTO actions (id, encounter_id, participant_id, action_type, payload_json, created_at)
           SELECT lower(hex(randomblob(16))), id, 'system', 'map_scene_migrated', ?, ?
           FROM encounters WHERE map_package_json = ?`,
        ).bind(JSON.stringify({ mapId: defaultScene.id, reason: "full_scene_only" }), now, JSON.stringify(defaultScene)).run();
      }
      await db.prepare(`DELETE FROM map_presets WHERE instr(package_json, '"visual"') = 0`).run();
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

async function findEncounter(env: Env, code: string): Promise<EncounterRow | null> {
  return env.DB.prepare(
    `SELECT id, code, name, version, status, map_asset, map_package_json,
            active_map_preset_id, grid_width, grid_height, current_round,
            active_initiative_order, updated_at
     FROM encounters WHERE code = ?`,
  )
    .bind(code)
    .first<EncounterRow>();
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

async function bumpEncounter(env: Env, encounterId: string, now = Date.now()) {
  await env.DB.prepare(
    "UPDATE encounters SET version = version + 1, updated_at = ? WHERE id = ?",
  )
    .bind(now, encounterId)
    .run();
}

async function expireStaleClaims(
  env: Env,
  encounter: EncounterRow,
): Promise<void> {
  const now = Date.now();
  const staleBefore = now - PARTICIPANT_PRESENCE_TTL_MS;
  const staleClaims = await env.DB.prepare(
    `SELECT t.id, t.owner_participant_id, t.owner_name, p.last_seen_at
     FROM tokens t
     JOIN participants p ON p.id = t.owner_participant_id
     WHERE t.encounter_id = ? AND p.last_seen_at <= ?`,
  )
    .bind(encounter.id, staleBefore)
    .all<{
      id: string;
      owner_participant_id: string;
      owner_name: string;
      last_seen_at: number;
    }>();

  for (const token of staleClaims.results) {
    const result = await env.DB.prepare(
      `UPDATE tokens
       SET owner_participant_id = NULL, owner_name = NULL, updated_at = ?
       WHERE id = ? AND owner_participant_id = ?
         AND EXISTS (
           SELECT 1 FROM participants
           WHERE id = ? AND last_seen_at <= ?
         )`,
    )
      .bind(
        now,
        token.id,
        token.owner_participant_id,
        token.owner_participant_id,
        staleBefore,
      )
      .run();
    if ((result.meta.changes ?? 0) > 0) {
      await bumpEncounter(env, encounter.id, now);
      await recordAction(
        env,
        encounter.id,
        token.owner_participant_id,
        "token_claim_expired",
        {
          tokenId: token.id,
          ownerName: token.owner_name,
          lastSeenAt: token.last_seen_at,
        },
        now,
      );
    }
  }
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

function coarseHealth(hp: number | null, maxHp: number | null): string | null {
  if (hp === null || maxHp === null || maxHp <= 0) return null;
  const ratio = hp / maxHp;
  if (ratio <= 0.25) return "near-death";
  if (ratio <= 0.5) return "bloodied";
  return "steady";
}

async function encounterState(
  env: Env,
  code: string,
  viewer: ParticipantRow | null = null,
) {
  let encounter = await findEncounter(env, code);
  if (!encounter) return null;
  await expireStaleClaims(env, encounter);
  await expireAnnotations(env, encounter);
  encounter = await findEncounter(env, code);
  const tokens = await env.DB.prepare(
    `SELECT id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
            summoner_token_id, initiative, initiative_order, turn_complete,
            movement_used, owner_participant_id, owner_name
     FROM tokens WHERE encounter_id = ? ORDER BY name, id`,
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
  const availableUndo = viewer
    ? await undoStack(env, encounter!.id, viewer.id)
    : [];
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
  const visibleTokens = tokens.results.filter(
    (token) =>
      !token.is_hidden ||
      viewer?.role === "dm" ||
      token.owner_participant_id === viewer?.id,
  );
  return {
    encounter: {
      code: encounter!.code,
      name: encounter!.name,
      version: encounter!.version,
      status: encounter!.status,
      mapPackage: activeMapPackage,
      activeMapPresetId: encounter!.active_map_preset_id,
      currentRound: encounter!.current_round,
      activeInitiativeOrder: encounter!.active_initiative_order,
      updatedAt: encounter!.updated_at,
    },
    grid: { width: encounter!.grid_width, height: encounter!.grid_height, feetPerCell: 5 },
    viewer: viewer ? { id: viewer.id, role: viewer.role } : null,
    undo: {
      available: availableUndo.length,
      lastAction: availableUndo[0]?.action_type ?? null,
    },
    tokens: visibleTokens.map((token) => {
      const canSeeExactHp =
        viewer?.role === "dm" || token.owner_participant_id === viewer?.id;
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
        initiativeOrder: token.initiative_order,
        turnComplete: Boolean(token.turn_complete),
        movementUsed: token.movement_used,
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
        owner:
          token.owner_participant_id && token.owner_name
            ? {
                participantId: token.owner_participant_id,
                name: token.owner_name,
              }
            : null,
      };
    }),
    annotations: annotations.results.map((annotation) => ({
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
    availableArt: TOKEN_ART_ASSETS,
  };
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
  "effect_added",
  "effect_removed",
  "annotation_added",
  "annotation_removed",
  "token_created",
  "token_updated",
]);

async function undoStack(
  env: Env,
  encounterId: string,
  participantId: string,
): Promise<ActionRow[]> {
  const rows = await env.DB.prepare(
    `SELECT id, action_type, payload_json, created_at FROM actions
     WHERE encounter_id = ? AND participant_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 200`,
  )
    .bind(encounterId, participantId)
    .all<ActionRow>();
  const undoneIds = new Set<string>();
  for (const row of rows.results) {
    if (row.action_type !== "action_undone") continue;
    try {
      const payload = JSON.parse(row.payload_json) as { actionId?: string };
      if (payload.actionId) undoneIds.add(payload.actionId);
    } catch {
      // Ignore a malformed historical payload; it remains in the audit log.
    }
  }
  return rows.results
    .filter((row) => REVERSIBLE_ACTION_TYPES.has(row.action_type))
    .slice(0, 10)
    .filter((row) => !undoneIds.has(row.id));
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
  const state = await encounterState(env, code, viewer);
  if (!state) return json({ error: "Encounter not found." }, { status: 404 });
  if (state.encounter.version !== lastVersion) return json(state);

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

async function canControlToken(
  env: Env,
  encounterId: string,
  token: TokenRow,
  participant: ParticipantRow,
): Promise<boolean> {
  if (participant.role === "dm" || token.owner_participant_id === participant.id) {
    return true;
  }
  if (!token.summoner_token_id) return false;
  const summoner = await env.DB.prepare(
    `SELECT owner_participant_id FROM tokens
     WHERE id = ? AND encounter_id = ?`,
  )
    .bind(token.summoner_token_id, encounterId)
    .first<{ owner_participant_id: string | null }>();
  return summoner?.owner_participant_id === participant.id;
}

function directDistance(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  const gridSquares = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return Math.round(gridSquares * 5 * 10) / 10;
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
  const currentIndex = orders.results.findIndex(
    (row) => row.initiative_order === encounter.active_initiative_order,
  );
  const wraps = currentIndex < 0 || currentIndex === orders.results.length - 1;
  const nextOrder = wraps
    ? orders.results[0].initiative_order
    : orders.results[currentIndex + 1].initiative_order;
  const nextRound = wraps
    ? Math.max(1, encounter.current_round + 1)
    : encounter.current_round;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE tokens SET turn_complete = 0, movement_used = 0, updated_at = ?
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
  const command = cleanText(body.command, 40);
  const state = () => encounterState(env, code, participant);
  const requireDm = () =>
    participant.role === "dm"
      ? null
      : json({ error: "This action requires the DM role." }, { status: 403 });

  if (command === "undo") {
    const stack = await undoStack(env, encounter.id, participant.id);
    const action = stack[0];
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
    let changes = 0;
    if (action.action_type === "token_moved") {
      const from = payload.from as { x?: unknown; y?: unknown } | undefined;
      const to = payload.to as { x?: unknown; y?: unknown } | undefined;
      const result = await env.DB.prepare(
        `UPDATE tokens SET x = ?, y = ?, movement_used = ?, updated_at = ?
         WHERE id = ? AND encounter_id = ? AND x = ? AND y = ?`,
      )
        .bind(Number(from?.x), Number(from?.y), Number(payload.previousMovementUsed) || 0, now, tokenId, encounter.id, Number(to?.x), Number(to?.y))
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
        `UPDATE tokens SET initiative = ?, initiative_order = NULL,
         turn_complete = 0, movement_used = 0, updated_at = ?
         WHERE id = ? AND encounter_id = ? AND initiative = ?`,
      )
        .bind(payload.from ?? null, now, tokenId, encounter.id, payload.to)
        .run();
      changes = result.meta.changes ?? 0;
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
    if (changes !== 1) {
      return json({ error: "That action can no longer be undone because its shared state changed." }, { status: 409 });
    }
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "action_undone", {
      actionId: action.id,
      actionType: action.action_type,
    }, now);
    return json({ undone: true, actionType: action.action_type, state: await state() });
  }

  if (command === "set-initiative") {
    const tokenId = cleanTokenId(body.tokenId);
    const initiative = Math.trunc(Number(body.initiative));
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
      return json({ error: "You cannot set initiative for this token." }, { status: 403 });
    }
    if (encounter.status === "active" && participant.role !== "dm") {
      return json({ error: "Only the DM can correct initiative after combat starts." }, { status: 409 });
    }
    if (!Number.isInteger(initiative) || initiative < 0 || initiative > 99) {
      return json({ error: "Initiative must be a whole number from 0 to 99." }, { status: 400 });
    }
    await env.DB.prepare(
      `UPDATE tokens SET initiative = ?, initiative_order = NULL,
       turn_complete = 0, movement_used = 0, updated_at = ?
       WHERE id = ? AND encounter_id = ?`,
    )
      .bind(initiative, now, tokenId, encounter.id)
      .run();
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "initiative_set", {
      tokenId,
      from: token.initiative,
      to: initiative,
    }, now);
    return json({ updated: true, state: await state() });
  }

  if (command === "start-combat") {
    const denied = requireDm();
    if (denied) return denied;
    const tokens = await env.DB.prepare(
      `SELECT id, name, initiative, summoner_token_id FROM tokens
       WHERE encounter_id = ? ORDER BY name, id`,
    )
      .bind(encounter.id)
      .all<{
        id: string;
        name: string;
        initiative: number | null;
        summoner_token_id: string | null;
      }>();
    const leaders = tokens.results
      .filter((token) => !token.summoner_token_id && token.initiative !== null)
      .sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0) || a.name.localeCompare(b.name));
    if (leaders.length === 0) {
      return json({ error: "Enter at least one initiative before starting combat." }, { status: 409 });
    }
    const statements = leaders.flatMap((leader, order) => [
      env.DB.prepare(
        `UPDATE tokens SET initiative_order = ?, turn_complete = 0,
         movement_used = 0, updated_at = ?
         WHERE encounter_id = ? AND (id = ? OR summoner_token_id = ?)`,
      ).bind(order, now, encounter.id, leader.id, leader.id),
    ]);
    statements.push(
      env.DB.prepare(
        `UPDATE encounters SET status = 'active', current_round = 1,
         active_initiative_order = 0, updated_at = ? WHERE id = ?`,
      ).bind(now, encounter.id),
    );
    await env.DB.batch(statements);
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "combat_started", {
      groups: leaders.map((leader, order) => ({ tokenId: leader.id, order })),
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
         WHERE id = ? AND encounter_id = ?`,
      )
        .bind(now, tokenId, encounter.id)
        .run();
      const remaining = await env.DB.prepare(
        `SELECT count(*) AS count FROM tokens
         WHERE encounter_id = ? AND initiative_order = ? AND turn_complete = 0`,
      )
        .bind(encounter.id, encounter.active_initiative_order)
        .first<{ count: number }>();
      if ((remaining?.count ?? 0) > 0) {
        await bumpEncounter(env, encounter.id, now);
        await recordAction(env, encounter.id, participant.id, "turn_member_ended", { tokenId }, now);
        return json({ advanced: false, state: await state() });
      }
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
        `UPDATE tokens SET turn_complete = 0, movement_used = 0, updated_at = ?
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
    const sourcePrompt = cleanText(body.sourcePrompt, 600) || cleanText(mapPackage.source.prompt, 600) || null;
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
           movement_used = 0, updated_at = ? WHERE encounter_id = ?`,
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

  if (command === "create-token") {
    const denied = requireDm();
    if (denied) return denied;
    const name = cleanText(body.name, 48);
    if (!name) return json({ error: "Token name is required." }, { status: 400 });
    const kind = ["character", "monster", "summon", "familiar"].includes(String(body.kind))
      ? String(body.kind)
      : "monster";
    const artAsset = TOKEN_ART_ASSETS.includes(String(body.artAsset))
      ? String(body.artAsset)
      : null;
    const size: CreatureSize = isCreatureSize(body.size) ? body.size : "medium";
    const x = clampTokenCoordinate(body.x, encounter.grid_width, size);
    const y = clampTokenCoordinate(body.y, encounter.grid_height, size);
    const speed = Math.min(120, Math.max(0, Math.trunc(Number(body.speed)) || 30));
    const maxHp = Number.isFinite(Number(body.maxHp)) ? Math.max(1, Math.trunc(Number(body.maxHp))) : null;
    const hp = maxHp === null ? null : Math.min(maxHp, Math.max(0, Math.trunc(Number(body.hp)) || maxHp));
    const summonerTokenId = cleanTokenId(body.summonerTokenId) || null;
    let inherited: {
      owner_participant_id: string | null;
      owner_name: string | null;
      initiative: number | null;
      initiative_order: number | null;
    } | null = null;
    if (summonerTokenId) {
      inherited = await env.DB.prepare(
        `SELECT owner_participant_id, owner_name, initiative, initiative_order
         FROM tokens WHERE id = ? AND encounter_id = ?`,
      )
        .bind(summonerTokenId, encounter.id)
        .first<{
          owner_participant_id: string | null;
          owner_name: string | null;
          initiative: number | null;
          initiative_order: number | null;
        }>();
      if (!inherited) return json({ error: "Summoner token not found." }, { status: 404 });
    }
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
        body.hidden ? 1 : 0,
        summonerTokenId,
        inherited?.initiative ?? null,
        inherited?.initiative_order ?? null,
        inherited?.owner_participant_id ?? null,
        inherited?.owner_name ?? null,
        now,
      )
      .run();
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "token_created", { tokenId, name, kind, size, x, y, summonerTokenId, artAsset }, now);
    return json({ created: true, tokenId, state: await state() });
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
      const artAsset = TOKEN_ART_ASSETS.includes(String(body.artAsset))
        ? String(body.artAsset)
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
    await recordAction(env, encounter.id, participant.id, "effect_added", { effectId, tokenId, name, effectType, expiresRound }, now);
    return json({ added: true, effectId, state: await state() });
  }

  if (command === "remove-effect") {
    const effectId = cleanTokenId(body.effectId);
    const effect = await env.DB.prepare(
      `SELECT e.id, e.token_id, e.name, e.effect_type, e.duration_rounds,
              e.expires_round, e.reminder_timing, e.created_by, e.created_at,
              t.owner_participant_id, t.summoner_token_id
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
        owner_participant_id: string | null;
        summoner_token_id: string | null;
      }>();
    if (!effect) return json({ error: "Effect not found." }, { status: 404 });
    const allowed = participant.role === "dm" || effect.owner_participant_id === participant.id ||
      (effect.summoner_token_id
        ? await env.DB.prepare("SELECT 1 AS found FROM tokens WHERE id = ? AND owner_participant_id = ?")
          .bind(effect.summoner_token_id, participant.id)
          .first<{ found: number }>()
        : null);
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
    const annotationType = ["ping", "drawing", "spotlight"].includes(String(body.annotationType))
      ? String(body.annotationType)
      : "ping";
    if (annotationType === "spotlight" && participant.role !== "dm") {
      return json({ error: "Only the DM can place a spotlight." }, { status: 403 });
    }
    const x = Number(body.x);
    const y = Number(body.y);
    const x2 = Number.isFinite(Number(body.x2)) ? Number(body.x2) : null;
    const y2 = Number.isFinite(Number(body.y2)) ? Number(body.y2) : null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > encounter.grid_width || y > encounter.grid_height) {
      return json({ error: "Annotation is outside the map." }, { status: 400 });
    }
    const expiresAt = annotationType === "ping"
      ? now + PING_TTL_MS
      : annotationType === "spotlight"
        ? now + 15_000
        : null;
    const annotationId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO annotations
       (id, encounter_id, annotation_type, x, y, x2, y2, color, label,
        created_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(annotationId, encounter.id, annotationType, x, y, x2, y2, cleanText(body.color, 16) || "#f5c65c", cleanText(body.label, 48) || null, participant.id, expiresAt, now)
      .run();
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "annotation_added", { annotationId, annotationType, x, y, x2, y2 }, now);
    return json({ added: true, annotationId, state: await state() });
  }

  if (command === "clear-annotations") {
    const denied = requireDm();
    if (denied) return denied;
    await env.DB.prepare("DELETE FROM annotations WHERE encounter_id = ?")
      .bind(encounter.id)
      .run();
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "annotations_cleared", {}, now);
    return json({ cleared: true, state: await state() });
  }

  if (command === "remove-annotation") {
    const annotationId = cleanTokenId(body.annotationId);
    const annotation = await env.DB.prepare(
      `SELECT id, annotation_type, x, y, x2, y2, color, label, created_by,
              expires_at, created_at
       FROM annotations WHERE id = ? AND encounter_id = ?`,
    )
      .bind(annotationId, encounter.id)
      .first<AnnotationRow & { created_at: number }>();
    if (!annotation || annotation.annotation_type !== "drawing") {
      return json({ error: "Drawn line not found." }, { status: 404 });
    }
    if (participant.role !== "dm" && annotation.created_by !== participant.id) {
      return json({ error: "You can only erase lines you drew." }, { status: 403 });
    }
    const result = await env.DB.prepare(
      "DELETE FROM annotations WHERE id = ? AND encounter_id = ?",
    )
      .bind(annotationId, encounter.id)
      .run();
    if ((result.meta.changes ?? 0) !== 1) {
      return json({ error: "That line was already removed." }, { status: 409 });
    }
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "annotation_removed", {
      annotationId,
      annotation: {
        id: annotation.id,
        annotationType: annotation.annotation_type,
        x: annotation.x,
        y: annotation.y,
        x2: annotation.x2,
        y2: annotation.y2,
        color: annotation.color,
        label: annotation.label,
        createdBy: annotation.created_by,
        expiresAt: annotation.expires_at,
        createdAt: annotation.created_at,
      },
    }, now);
    return json({ removed: true, state: await state() });
  }

  if (command === "delete-token") {
    const denied = requireDm();
    if (denied) return denied;
    const tokenId = cleanTokenId(body.tokenId);
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
    return json({
      present: true,
      claimExpiresAt: now + PARTICIPANT_PRESENCE_TTL_MS,
    });
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
            movement_used, owner_participant_id, owner_name
     FROM tokens WHERE id = ? AND encounter_id = ?`,
  )
    .bind(tokenId, encounter.id)
    .first<TokenRow>();
  if (!token) {
    return json({ error: "Token not found." }, { status: 404 });
  }

  if (action === "claim") {
    if (token.summoner_token_id || !["character", "monster"].includes(token.kind)) {
      return json({ error: "This token is controlled through its summoner." }, { status: 409 });
    }
    const participantClaim = await env.DB.prepare(
      `SELECT id, name FROM tokens
       WHERE encounter_id = ? AND owner_participant_id = ?
         AND summoner_token_id IS NULL LIMIT 1`,
    )
      .bind(encounter.id, participantId)
      .first<{ id: string; name: string }>();
    if (participantClaim && participantClaim.id !== tokenId) {
      return json(
        {
          error: `You already control ${participantClaim.name}. Release it before claiming another token.`,
          state: await encounterState(env, code, participant),
        },
        { status: 409 },
      );
    }

    const nameClaim = await env.DB.prepare(
      `SELECT id, name FROM tokens
       WHERE encounter_id = ? AND lower(owner_name) = lower(?)
         AND summoner_token_id IS NULL LIMIT 1`,
    )
      .bind(encounter.id, participant.name)
      .first<{ id: string; name: string }>();
    if (nameClaim && nameClaim.id !== tokenId) {
      return json(
        {
          error: `${participant.name} already controls ${nameClaim.name}. Use that token or choose a different display name.`,
          state: await encounterState(env, code, participant),
        },
        { status: 409 },
      );
    }

    const sameNameRecovery =
      token.owner_participant_id !== null &&
      token.owner_participant_id !== participantId &&
      token.owner_name?.toLocaleLowerCase() === participant.name.toLocaleLowerCase();
    if (
      token.owner_participant_id &&
      token.owner_participant_id !== participantId &&
      !sameNameRecovery
    ) {
      return json(
        {
          error: `${token.name} is already claimed by ${token.owner_name ?? "another player"}.`,
          state: await encounterState(env, code, participant),
        },
        { status: 409 },
      );
    }

    if (token.owner_participant_id === participantId) {
      return json({ claimed: true, recovered: false, state: await encounterState(env, code, participant) });
    }

    const result = await env.DB.prepare(
      `UPDATE tokens
       SET owner_participant_id = ?, owner_name = ?, updated_at = ?
       WHERE id = ? AND encounter_id = ?
         AND (owner_participant_id IS NULL OR lower(owner_name) = lower(?))`,
    )
      .bind(participantId, participant.name, now, tokenId, encounter.id, participant.name)
      .run();
    if ((result.meta.changes ?? 0) !== 1) {
      return json(
        { error: "That token was claimed by someone else.", state: await encounterState(env, code, participant) },
        { status: 409 },
      );
    }
    await bumpEncounter(env, encounter.id, now);
    await recordAction(
      env,
      encounter.id,
      participantId,
      sameNameRecovery ? "token_claim_recovered" : "token_claimed",
      { tokenId, previousParticipantId: token.owner_participant_id },
      now,
    );
    return json({ claimed: true, recovered: sameNameRecovery, state: await encounterState(env, code, participant) });
  }

  if (action === "relinquish") {
    if (token.owner_participant_id !== participantId) {
      return json(
        { error: "You do not control this token.", state: await encounterState(env, code, participant) },
        { status: 403 },
      );
    }
    const result = await env.DB.prepare(
      `UPDATE tokens
       SET owner_participant_id = NULL, owner_name = NULL, updated_at = ?
       WHERE encounter_id = ? AND owner_participant_id = ?
         AND (id = ? OR summoner_token_id = ?)`,
    )
      .bind(now, encounter.id, participantId, tokenId, tokenId)
      .run();
    if ((result.meta.changes ?? 0) > 0) {
      await bumpEncounter(env, encounter.id, now);
      await recordAction(env, encounter.id, participantId, "token_relinquished", { tokenId }, now);
    }
    return json({ released: (result.meta.changes ?? 0) > 0, state: await encounterState(env, code, participant) });
  }

  if (action === "move") {
    if (!(await canControlToken(env, encounter.id, token, participant))) {
      return json(
        { error: "Claim this token before moving it.", state: await encounterState(env, code, participant) },
        { status: 403 },
      );
    }
    if (
      encounter.status === "paused" &&
      participant.role !== "dm"
    ) {
      return json({ error: "The encounter is paused." }, { status: 409 });
    }
    if (
      encounter.status === "active" &&
      participant.role !== "dm" &&
      token.initiative_order !== null &&
      (token.initiative_order !== encounter.active_initiative_order || token.turn_complete)
    ) {
      return json({ error: "This token is not in the active turn group." }, { status: 409 });
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
    const previous = { x: token.x, y: token.y };
    const distance = directDistance(previous, { x, y });
    const remainingBeforeMove = Math.max(0, token.speed - token.movement_used);
    const overBudget = encounter.status === "active" && distance > remainingBeforeMove + 0.05;
    const movementUsed = encounter.status === "active"
      ? Math.round((token.movement_used + distance) * 10) / 10
      : token.movement_used;
    const result = await env.DB.prepare(
      `UPDATE tokens
       SET x = ?, y = ?, movement_used = ?, updated_at = ?
       WHERE id = ? AND encounter_id = ?`,
    )
      .bind(x, y, movementUsed, now, tokenId, encounter.id)
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
      movementUsed,
      overBudget,
    });
    return json({ moved: true, distance, movementUsed, overBudget, state: await encounterState(env, code, participant) });
  }

  return json({ error: "Method not allowed." }, { status: 405 });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/map-assets/")) {
      const key = url.pathname.slice("/map-assets/".length);
      return handleMapAsset(request, env, key);
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
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) =>
            env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
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
