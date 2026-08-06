import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

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
  updated_at: number;
};

type TokenRow = {
  id: string;
  name: string;
  x: number;
  y: number;
  owner_participant_id: string | null;
  owner_name: string | null;
  lock_owner_id: string | null;
  lock_owner_name: string | null;
  lock_expires_at: number | null;
};

type ParticipantRow = {
  id: string;
  name: string;
};

const GRID_WIDTH = 16;
const GRID_HEIGHT = 11;
const LOCK_TTL_MS = 12_000;
const PARTICIPANT_PRESENCE_TTL_MS = 120_000;
const API_ROUTE =
  /^\/api\/encounters\/([^/]+)\/(join|state|events|heartbeat|claim|relinquish|lock|move|unlock)$/;

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
          updated_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS participants (
          id TEXT PRIMARY KEY NOT NULL,
          encounter_id TEXT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
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
        db.prepare(
          "CREATE INDEX IF NOT EXISTS idx_participants_encounter_id ON participants(encounter_id)",
        ),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS idx_tokens_encounter_id ON tokens(encounter_id)",
        ),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS idx_actions_encounter_created_at ON actions(encounter_id, created_at)",
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
      await db
        .prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS tokens_owner_participant_id_unique
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
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

async function findEncounter(env: Env, code: string): Promise<EncounterRow | null> {
  return env.DB.prepare(
    "SELECT id, code, name, version, updated_at FROM encounters WHERE code = ?",
  )
    .bind(code)
    .first<EncounterRow>();
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

async function encounterState(env: Env, code: string) {
  let encounter = await findEncounter(env, code);
  if (!encounter) return null;
  await expireStaleClaims(env, encounter);
  await expireLock(env, encounter);
  encounter = await findEncounter(env, code);
  const tokens = await env.DB.prepare(
    `SELECT id, name, x, y, owner_participant_id, owner_name,
            lock_owner_id, lock_owner_name, lock_expires_at
     FROM tokens WHERE encounter_id = ? ORDER BY name, id`,
  )
    .bind(encounter!.id)
    .all<TokenRow>();

  if (tokens.results.length === 0) return null;
  return {
    encounter: {
      code: encounter!.code,
      name: encounter!.name,
      version: encounter!.version,
      updatedAt: encounter!.updated_at,
    },
    grid: { width: GRID_WIDTH, height: GRID_HEIGHT, feetPerCell: 5 },
    tokens: tokens.results.map((token) => ({
      id: token.id,
      name: token.name,
      x: token.x,
      y: token.y,
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
    })),
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

async function handleStatePoll(
  request: Request,
  env: Env,
  code: string,
): Promise<Response> {
  const requestedVersion = Number(new URL(request.url).searchParams.get("since"));
  const lastVersion = Number.isFinite(requestedVersion) ? requestedVersion : 0;
  const state = await encounterState(env, code);
  if (!state) return json({ error: "Encounter not found." }, { status: 404 });
  if (state.encounter.version !== lastVersion) return json(state);

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
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
    const state = await encounterState(env, code);
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
    if (!participantName) {
      return json({ error: "Display name is required." }, { status: 400 });
    }

    const participantId = crypto.randomUUID();
    const sessionSecret = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO participants
        (id, encounter_id, name, session_secret, joined_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        participantId,
        encounter.id,
        participantName,
        sessionSecret,
        now,
        now,
      )
      .run();
    await recordAction(env, encounter.id, participantId, "participant_joined", {
      name: participantName,
    });
    return json({
      participantId,
      sessionSecret,
      state: await encounterState(env, code),
    });
  }

  const participantId = cleanParticipantId(body.participantId);
  const sessionSecret = cleanSessionSecret(body.sessionSecret);
  if (!participantId || !sessionSecret) {
    return json({ error: "Participant session is required." }, { status: 401 });
  }
  const participant = await env.DB.prepare(
    `SELECT id, name FROM participants
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

  const tokenId = cleanTokenId(body.tokenId);
  if (!tokenId) {
    return json({ error: "Token is required." }, { status: 400 });
  }
  const token = await env.DB.prepare(
    `SELECT id, name, x, y, owner_participant_id, owner_name,
            lock_owner_id, lock_owner_name, lock_expires_at
     FROM tokens WHERE id = ? AND encounter_id = ?`,
  )
    .bind(tokenId, encounter.id)
    .first<TokenRow>();
  if (!token) {
    return json({ error: "Token not found." }, { status: 404 });
  }

  if (action === "claim") {
    const participantClaim = await env.DB.prepare(
      `SELECT id, name FROM tokens
       WHERE encounter_id = ? AND owner_participant_id = ? LIMIT 1`,
    )
      .bind(encounter.id, participantId)
      .first<{ id: string; name: string }>();
    if (participantClaim && participantClaim.id !== tokenId) {
      return json(
        {
          error: `You already control ${participantClaim.name}. Release it before claiming another token.`,
          state: await encounterState(env, code),
        },
        { status: 409 },
      );
    }

    const nameClaim = await env.DB.prepare(
      `SELECT id, name FROM tokens
       WHERE encounter_id = ? AND lower(owner_name) = lower(?) LIMIT 1`,
    )
      .bind(encounter.id, participant.name)
      .first<{ id: string; name: string }>();
    if (nameClaim && nameClaim.id !== tokenId) {
      return json(
        {
          error: `${participant.name} already controls ${nameClaim.name}. Use that token or choose a different display name.`,
          state: await encounterState(env, code),
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
          state: await encounterState(env, code),
        },
        { status: 409 },
      );
    }

    if (token.owner_participant_id === participantId) {
      return json({ claimed: true, recovered: false, state: await encounterState(env, code) });
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
        { error: "That token was claimed by someone else.", state: await encounterState(env, code) },
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
    return json({ claimed: true, recovered: sameNameRecovery, state: await encounterState(env, code) });
  }

  if (action === "relinquish") {
    if (token.owner_participant_id !== participantId) {
      return json(
        { error: "You do not control this token.", state: await encounterState(env, code) },
        { status: 403 },
      );
    }
    const result = await env.DB.prepare(
      `UPDATE tokens
       SET owner_participant_id = NULL, owner_name = NULL, lock_owner_id = NULL,
           lock_owner_name = NULL, lock_expires_at = NULL, updated_at = ?
       WHERE id = ? AND encounter_id = ? AND owner_participant_id = ?`,
    )
      .bind(now, tokenId, encounter.id, participantId)
      .run();
    if ((result.meta.changes ?? 0) === 1) {
      await bumpEncounter(env, encounter.id, now);
      await recordAction(env, encounter.id, participantId, "token_relinquished", { tokenId }, now);
    }
    return json({ released: (result.meta.changes ?? 0) === 1, state: await encounterState(env, code) });
  }

  if (action === "lock") {
    if (token.owner_participant_id !== participantId) {
      return json(
        { error: "Claim this token before moving it.", state: await encounterState(env, code) },
        { status: 403 },
      );
    }
    const expiresAt = now + LOCK_TTL_MS;
    const result = await env.DB.prepare(
      `UPDATE tokens
       SET lock_owner_id = ?, lock_owner_name = ?, lock_expires_at = ?, updated_at = ?
       WHERE id = ? AND encounter_id = ? AND owner_participant_id = ?
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
      { acquired, state: await encounterState(env, code) },
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
    return json({ released: (result.meta.changes ?? 0) === 1, state: await encounterState(env, code) });
  }

  if (action === "move") {
    if (token.owner_participant_id !== participantId) {
      return json(
        { error: "Claim this token before moving it.", state: await encounterState(env, code) },
        { status: 403 },
      );
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
    const x = Math.round(requestedX * 1_000) / 1_000;
    const y = Math.round(requestedY * 1_000) / 1_000;
    const previous = await env.DB.prepare(
      "SELECT x, y FROM tokens WHERE id = ? AND encounter_id = ?",
    )
      .bind(tokenId, encounter.id)
      .first<{ x: number; y: number }>();
    const result = await env.DB.prepare(
      `UPDATE tokens
       SET x = ?, y = ?, lock_owner_id = NULL, lock_owner_name = NULL,
           lock_expires_at = NULL, updated_at = ?
       WHERE id = ? AND encounter_id = ? AND owner_participant_id = ?
         AND lock_owner_id = ? AND lock_expires_at > ?`,
    )
      .bind(x, y, now, tokenId, encounter.id, participantId, participantId, now)
      .run();
    if ((result.meta.changes ?? 0) !== 1) {
      return json(
        { error: "The token lock expired or belongs to someone else.", state: await encounterState(env, code) },
        { status: 409 },
      );
    }
    await bumpEncounter(env, encounter.id, now);
    await recordAction(env, encounter.id, participantId, "token_moved", {
      tokenId,
      from: previous,
      to: { x, y },
    });
    return json({ moved: true, state: await encounterState(env, code) });
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
