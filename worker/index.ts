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

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
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
  lock_owner_id: string | null;
  lock_owner_name: string | null;
  lock_expires_at: number | null;
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

const GRID_WIDTH = 16;
const GRID_HEIGHT = 11;
const LOCK_TTL_MS = 12_000;
const PARTICIPANT_PRESENCE_TTL_MS = 120_000;
const PING_TTL_MS = 2_000;
const API_ROUTE =
  /^\/api\/encounters\/([^/]+)\/(join|state|events|heartbeat|claim|relinquish|lock|move|unlock|command)$/;

let schemaReady: Promise<void> | null = null;

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
          map_asset TEXT DEFAULT '/assets/terrain/terrain-dungeon-flagstone-01.png' NOT NULL,
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
          lock_owner_id TEXT,
          lock_owner_name TEXT,
          lock_expires_at INTEGER,
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
        ["map_asset", "ALTER TABLE encounters ADD COLUMN map_asset TEXT DEFAULT '/assets/terrain/terrain-dungeon-flagstone-01.png' NOT NULL"],
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
            (id, encounter_id, name, x, y, owner_participant_id, owner_name,
             lock_owner_id, lock_owner_name, lock_expires_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
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
            (id, encounter_id, name, x, y, owner_participant_id, owner_name,
             lock_owner_id, lock_owner_name, lock_expires_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
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
            (id, encounter_id, name, x, y, owner_participant_id, owner_name,
             lock_owner_id, lock_owner_name, lock_expires_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?)`,
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
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

async function findEncounter(env: Env, code: string): Promise<EncounterRow | null> {
  return env.DB.prepare(
    `SELECT id, code, name, version, status, map_asset, current_round,
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

async function expireLock(env: Env, encounter: EncounterRow): Promise<void> {
  const now = Date.now();
  const expired = await env.DB.prepare(
    `SELECT id, lock_owner_id, lock_expires_at FROM tokens
     WHERE encounter_id = ? AND lock_owner_id IS NOT NULL
       AND lock_expires_at IS NOT NULL AND lock_expires_at <= ?`,
  )
    .bind(encounter.id, now)
    .all<{
      id: string;
      lock_owner_id: string;
      lock_expires_at: number;
    }>();
  for (const token of expired.results) {
    const result = await env.DB.prepare(
      `UPDATE tokens
       SET lock_owner_id = NULL, lock_owner_name = NULL, lock_expires_at = NULL, updated_at = ?
       WHERE id = ? AND lock_owner_id = ? AND lock_expires_at = ?`,
    )
      .bind(
        now,
        token.id,
        token.lock_owner_id,
        token.lock_expires_at,
      )
      .run();
    if ((result.meta.changes ?? 0) > 0) {
      await bumpEncounter(env, encounter.id, now);
      await recordAction(
        env,
        encounter.id,
        token.lock_owner_id,
        "token_lock_expired",
        { tokenId: token.id, expiresAt: token.lock_expires_at },
        now,
      );
    }
  }
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
       SET owner_participant_id = NULL, owner_name = NULL,
           lock_owner_id = NULL, lock_owner_name = NULL,
           lock_expires_at = NULL, updated_at = ?
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
  await expireLock(env, encounter);
  await expireAnnotations(env, encounter);
  encounter = await findEncounter(env, code);
  const tokens = await env.DB.prepare(
    `SELECT id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
            summoner_token_id, initiative, initiative_order, turn_complete,
            movement_used, owner_participant_id, owner_name,
            lock_owner_id, lock_owner_name, lock_expires_at
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
      mapAsset: encounter!.map_asset,
      currentRound: encounter!.current_round,
      activeInitiativeOrder: encounter!.active_initiative_order,
      updatedAt: encounter!.updated_at,
    },
    grid: { width: GRID_WIDTH, height: GRID_HEIGHT, feetPerCell: 5 },
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
        lock:
          token.lock_owner_id &&
          token.lock_owner_name &&
          token.lock_expires_at &&
          token.lock_expires_at > Date.now()
            ? {
                ownerId: token.lock_owner_id,
                ownerName: token.lock_owner_name,
                expiresAt: token.lock_expires_at,
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
    availableMaps: [
      "/assets/terrain/terrain-dungeon-flagstone-01.png",
      "/assets/terrain/terrain-meadow-grass-01.png",
      "/assets/terrain/terrain-shallow-water-01.png",
      "/assets/terrain/terrain-packed-earth-01.png",
    ],
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

function pathDistance(
  body: Record<string, unknown>,
  from: { x: number; y: number },
  to: { x: number; y: number },
): { distance: number; path: Array<{ x: number; y: number }> } {
  const supplied = Array.isArray(body.path) ? body.path : [];
  const points = [
    from,
    ...supplied.slice(0, 200).flatMap((point) => {
      if (!point || typeof point !== "object") return [];
      const x = Number((point as Record<string, unknown>).x);
      const y = Number((point as Record<string, unknown>).y);
      return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
    }),
    to,
  ];
  const deduped = points.filter(
    (point, index) =>
      index === 0 ||
      Math.hypot(
        point.x - points[index - 1].x,
        point.y - points[index - 1].y,
      ) > 0.001,
  );
  let gridSquares = 0;
  for (let index = 1; index < deduped.length; index += 1) {
    gridSquares += Math.max(
      Math.abs(deduped[index].x - deduped[index - 1].x),
      Math.abs(deduped[index].y - deduped[index - 1].y),
    );
  }
  return {
    distance: Math.round(gridSquares * 5 * 10) / 10,
    path: deduped.map((point) => ({
      x: Math.round(point.x * 1_000) / 1_000,
      y: Math.round(point.y * 1_000) / 1_000,
    })),
  };
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
        `UPDATE tokens SET x = ?, y = ?, movement_used = ?, lock_owner_id = NULL,
         lock_owner_name = NULL, lock_expires_at = NULL, updated_at = ?
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
    } else if (action.action_type === "token_created") {
      const result = await env.DB.prepare(
        `DELETE FROM tokens WHERE id = ? AND encounter_id = ?
         AND owner_participant_id IS NULL AND lock_owner_id IS NULL`,
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
          .bind(cleanText(previous.name, 48), isCreatureSize(previous.size) ? previous.size : current?.size ?? "medium", Number.isFinite(Number(previous.x)) ? Number(previous.x) : current?.x ?? GRID_WIDTH / 2, Number.isFinite(Number(previous.y)) ? Number(previous.y) : current?.y ?? GRID_HEIGHT / 2, Number(previous.speed), previous.hp ?? null, previous.maxHp ?? null, previous.hidden ? 1 : 0, previous.artAsset ?? null, now, tokenId, encounter.id)
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
              movement_used, owner_participant_id, owner_name, lock_owner_id,
              lock_owner_name, lock_expires_at
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
                movement_used, owner_participant_id, owner_name, lock_owner_id,
                lock_owner_name, lock_expires_at
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

  if (command === "configure-encounter") {
    const denied = requireDm();
    if (denied) return denied;
    const status = ["setup", "active", "paused"].includes(String(body.status))
      ? String(body.status)
      : encounter.status;
    const allowedMaps = [
      "/assets/terrain/terrain-dungeon-flagstone-01.png",
      "/assets/terrain/terrain-meadow-grass-01.png",
      "/assets/terrain/terrain-shallow-water-01.png",
      "/assets/terrain/terrain-packed-earth-01.png",
    ];
    const mapAsset = allowedMaps.includes(String(body.mapAsset))
      ? String(body.mapAsset)
      : encounter.map_asset;
    if (status === "setup") {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE encounters SET status = 'setup', map_asset = ?, current_round = 0,
           active_initiative_order = NULL, updated_at = ? WHERE id = ?`,
        ).bind(mapAsset, now, encounter.id),
        env.DB.prepare(
          `UPDATE tokens SET initiative_order = NULL, turn_complete = 0,
           movement_used = 0, updated_at = ? WHERE encounter_id = ?`,
        ).bind(now, encounter.id),
      ]);
    } else {
      await env.DB.prepare(
        `UPDATE encounters SET status = ?, map_asset = ?, updated_at = ?
         WHERE id = ?`,
      )
        .bind(status, mapAsset, now, encounter.id)
        .run();
    }
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participant.id, "encounter_configured", {
      previous: { status: encounter.status, mapAsset: encounter.map_asset },
      next: { status, mapAsset },
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
    const x = clampTokenCoordinate(body.x, GRID_WIDTH, size);
    const y = clampTokenCoordinate(body.y, GRID_HEIGHT, size);
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
        movement_used, owner_participant_id, owner_name, lock_owner_id,
        lock_owner_name, lock_expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NULL, NULL, NULL, ?)`,
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
              movement_used, owner_participant_id, owner_name, lock_owner_id,
              lock_owner_name, lock_expires_at
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
      const x = clampTokenCoordinate(token.x, GRID_WIDTH, size);
      const y = clampTokenCoordinate(token.y, GRID_HEIGHT, size);
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
              movement_used, owner_participant_id, owner_name, lock_owner_id,
              lock_owner_name, lock_expires_at
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
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > GRID_WIDTH || y > GRID_HEIGHT) {
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
            movement_used, owner_participant_id, owner_name,
            lock_owner_id, lock_owner_name, lock_expires_at
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
       SET owner_participant_id = ?, owner_name = ?, lock_owner_id = NULL,
           lock_owner_name = NULL, lock_expires_at = NULL, updated_at = ?
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
       SET owner_participant_id = NULL, owner_name = NULL, lock_owner_id = NULL,
           lock_owner_name = NULL, lock_expires_at = NULL, updated_at = ?
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

  if (action === "lock") {
    if (!(await canControlToken(env, encounter.id, token, participant))) {
      return json(
        { error: "Claim this token before moving it.", state: await encounterState(env, code, participant) },
        { status: 403 },
      );
    }
    const expiresAt = now + LOCK_TTL_MS;
    const result = await env.DB.prepare(
      `UPDATE tokens
       SET lock_owner_id = ?, lock_owner_name = ?, lock_expires_at = ?, updated_at = ?
       WHERE id = ? AND encounter_id = ?
         AND (lock_owner_id IS NULL OR lock_owner_id = ? OR lock_expires_at <= ?)`,
    )
      .bind(
        participantId,
        participant.name,
        expiresAt,
        now,
        tokenId,
        encounter.id,
        participantId,
        now,
      )
      .run();
    const acquired = (result.meta.changes ?? 0) === 1;
    if (acquired) {
      await bumpEncounter(env, encounter.id, now);
      await recordAction(env, encounter.id, participantId, "token_locked", {
        tokenId,
        expiresAt,
      });
    }
    return json(
      { acquired, state: await encounterState(env, code, participant) },
      { status: acquired ? 200 : 409 },
    );
  }

  if (action === "unlock") {
    const result = await env.DB.prepare(
      `UPDATE tokens
       SET lock_owner_id = NULL, lock_owner_name = NULL, lock_expires_at = NULL, updated_at = ?
       WHERE id = ? AND encounter_id = ? AND lock_owner_id = ?`,
    )
      .bind(now, tokenId, encounter.id, participantId)
      .run();
    if ((result.meta.changes ?? 0) === 1) {
      await bumpEncounter(env, encounter.id, now);
      await recordAction(env, encounter.id, participantId, "token_unlocked", {
        tokenId,
      });
    }
    return json({ released: (result.meta.changes ?? 0) === 1, state: await encounterState(env, code, participant) });
  }

  if (action === "move") {
    if (!(await canControlToken(env, encounter.id, token, participant))) {
      return json(
        { error: "Claim this token before moving it.", state: await encounterState(env, code, participant) },
        { status: 403 },
      );
    }
    const dmOverride = participant.role === "dm" && body.override === true;
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
      requestedX > GRID_WIDTH ||
      requestedY > GRID_HEIGHT
    ) {
      return json({ error: "Destination is outside the map." }, { status: 400 });
    }
    const x = clampTokenCoordinate(requestedX, GRID_WIDTH, token.size);
    const y = clampTokenCoordinate(requestedY, GRID_HEIGHT, token.size);
    const previous = { x: token.x, y: token.y };
    const movement = pathDistance(body, previous, { x, y });
    const remaining = Math.max(0, token.speed - token.movement_used);
    if (encounter.status === "active" && movement.distance > remaining + 0.05 && !dmOverride) {
      return json(
        {
          error: `That path costs ${movement.distance} ft; ${remaining} ft remains this turn.`,
          distance: movement.distance,
          remaining,
          state: await encounterState(env, code, participant),
        },
        { status: 409 },
      );
    }
    const movementUsed = encounter.status === "active"
      ? Math.round((token.movement_used + movement.distance) * 10) / 10
      : token.movement_used;
    const result = await env.DB.prepare(
      `UPDATE tokens
       SET x = ?, y = ?, movement_used = ?, lock_owner_id = NULL,
           lock_owner_name = NULL, lock_expires_at = NULL, updated_at = ?
       WHERE id = ? AND encounter_id = ?
         AND lock_owner_id = ? AND lock_expires_at > ?`,
    )
      .bind(x, y, movementUsed, now, tokenId, encounter.id, participantId, now)
      .run();
    if ((result.meta.changes ?? 0) !== 1) {
      return json(
        { error: "The token lock expired or belongs to someone else.", state: await encounterState(env, code, participant) },
        { status: 409 },
      );
    }
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participantId, "token_moved", {
      tokenId,
      from: previous,
      to: { x, y },
      path: movement.path,
      distance: movement.distance,
      previousMovementUsed: token.movement_used,
      movementUsed,
      override: dmOverride,
    });
    return json({ moved: true, distance: movement.distance, movementUsed, state: await encounterState(env, code, participant) });
  }

  return json({ error: "Method not allowed." }, { status: 405 });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

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
