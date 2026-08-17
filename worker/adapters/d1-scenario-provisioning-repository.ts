import { HANDOUT_MAX_PER_SCENARIO } from "../../shared/handout-domain.ts";
import { scenarioCodeFromName } from "../../shared/encounter-domain.ts";
import { tokenRadiusCells, type CreatureSize } from "../../shared/creature-library.ts";
import type { ScenarioProvisioningManifest } from "../../shared/scenario-provisioning.ts";
import type {
  ScenarioProvisioningAssetRecord,
  ScenarioProvisioningFinalizeResult,
  ScenarioProvisioningJobRecord,
  ScenarioProvisioningMailMessageRecord,
  ScenarioProvisioningMailReplyRecord,
  ScenarioProvisioningObjectStorage,
  ScenarioProvisioningRepository,
} from "../ports/scenario-provisioning-repository.ts";
import { ScenarioProvisioningWriteError } from "../ports/scenario-provisioning-repository.ts";
import type { TokenRow } from "../types.ts";

type JobRow = {
  id: string; idempotency_key: string; revision: number; operation: "create" | "revise";
  status: ScenarioProvisioningJobRecord["status"]; manifest_json: string; manifest_hash: string;
  scenario_id: string | null; scenario_code: string | null; base_scenario_version: number | null; summary: string; error_code: string | null;
  result_json: string | null; created_at: number; updated_at: number;
};

type AssetRow = {
  id: string; job_id: string; asset_id: string; kind: ScenarioProvisioningAssetRecord["kind"];
  r2_key: string; content_type: string; width: number; height: number; byte_length: number;
  sha256: string; committed_at: number | null; created_at: number;
};

type MailReplyRow = {
  id: string; job_id: string; mailbox_key: string; thread_id: string;
  reply_kind: ScenarioProvisioningMailReplyRecord["replyKind"];
  response_marker: string; created_at: number;
};

type MailMessageRow = {
  id: string; reply_id: string; mailbox_key: string; thread_id: string;
  provider_message_id: string; recorded_at: number;
};

type CatalogRow = {
  id: string; name: string; size: CreatureSize; default_hp: number; armor_class: number; walk_speed: number;
  token_asset: string; thumbnail_asset: string; is_active: number;
};

type EncounterTarget = {
  id: string; code: string; name: string; version: number; status: string; grid_width: number; grid_height: number;
};

const JOB_COLUMNS = `id, idempotency_key, revision, operation, status, manifest_json,
  manifest_hash, scenario_id, scenario_code, base_scenario_version, summary, error_code, result_json, created_at, updated_at`;
const ASSET_COLUMNS = `id, job_id, asset_id, kind, r2_key, content_type, width, height,
  byte_length, sha256, committed_at, created_at`;
const MAIL_REPLY_COLUMNS = `id, job_id, mailbox_key, thread_id, reply_kind, response_marker, created_at`;
const MAIL_MESSAGE_COLUMNS = `id, reply_id, mailbox_key, thread_id, provider_message_id, recorded_at`;
const PARTY_NAMES = ["Dar'eleth", "Jelton", "Malichar"];

export function createD1ScenarioProvisioningRepository(db: D1Database): ScenarioProvisioningRepository {
  return {
    async findJobByIdempotencyKey(idempotencyKey) {
      const row = await db.prepare(
        `SELECT ${JOB_COLUMNS} FROM scenario_provisioning_jobs WHERE idempotency_key = ?`,
      ).bind(idempotencyKey).first<JobRow>();
      return row ? mapJob(row) : null;
    },
    async findJobById(jobId) {
      const row = await db.prepare(
        `SELECT ${JOB_COLUMNS} FROM scenario_provisioning_jobs WHERE id = ?`,
      ).bind(jobId).first<JobRow>();
      return row ? mapJob(row) : null;
    },
    async countJobsCreatedSince(timestamp) {
      const row = await db.prepare(
        "SELECT COUNT(*) AS value FROM scenario_provisioning_jobs WHERE created_at >= ?",
      ).bind(timestamp).first<{ value: number }>();
      return row?.value ?? 0;
    },
    async findScenarioRevisionTarget(code) {
      return db.prepare("SELECT id, code, version FROM encounters WHERE code = ?")
        .bind(code).first<{ id: string; code: string; version: number }>();
    },
    async createJob(job) {
      await db.prepare(
        `INSERT INTO scenario_provisioning_jobs
         (id, idempotency_key, revision, operation, status, manifest_json, manifest_hash,
          scenario_id, scenario_code, base_scenario_version, summary, error_code, result_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        job.id, job.idempotencyKey, job.revision, job.operation, job.status, job.manifestJson,
        job.manifestHash, job.scenarioId, job.scenarioCode, job.baseScenarioVersion, job.summary, job.errorCode,
        job.resultJson, job.createdAt, job.updatedAt,
      ).run();
    },
    async updateJobStatus(input) {
      const result = await db.prepare(
        `UPDATE scenario_provisioning_jobs SET status = ?, summary = ?, error_code = ?, updated_at = ?
         WHERE id = ? AND status = ?`,
      ).bind(input.to, input.summary, input.errorCode, input.now, input.jobId, input.from).run();
      return (result.meta.changes ?? 0) === 1;
    },
    async findAsset(jobId, assetId) {
      const row = await db.prepare(
        `SELECT ${ASSET_COLUMNS} FROM scenario_provisioning_assets WHERE job_id = ? AND asset_id = ?`,
      ).bind(jobId, assetId).first<AssetRow>();
      return row ? mapAsset(row) : null;
    },
    async listAssets(jobId) {
      const rows = await db.prepare(
        `SELECT ${ASSET_COLUMNS} FROM scenario_provisioning_assets WHERE job_id = ? ORDER BY asset_id`,
      ).bind(jobId).all<AssetRow>();
      return rows.results.map(mapAsset);
    },
    async upsertAsset(asset) {
      const result = await db.prepare(
        `INSERT INTO scenario_provisioning_assets
         (id, job_id, asset_id, kind, r2_key, content_type, width, height, byte_length,
          sha256, committed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT(job_id, asset_id) DO UPDATE SET
          kind = excluded.kind, r2_key = excluded.r2_key, content_type = excluded.content_type,
          width = excluded.width, height = excluded.height, byte_length = excluded.byte_length,
          sha256 = excluded.sha256
         WHERE scenario_provisioning_assets.committed_at IS NULL
           AND scenario_provisioning_assets.id = excluded.id`,
      ).bind(
        asset.id, asset.jobId, asset.assetId, asset.kind, asset.r2Key, asset.contentType,
        asset.width, asset.height, asset.byteLength, asset.sha256, asset.createdAt,
      ).run();
      return (result.meta.changes ?? 0) === 1;
    },
    async findMailReply(jobId, replyKind) {
      const row = await db.prepare(
        `SELECT ${MAIL_REPLY_COLUMNS} FROM scenario_provisioning_mail_replies
         WHERE job_id = ? AND reply_kind = ?`,
      ).bind(jobId, replyKind).first<MailReplyRow>();
      return row ? mapMailReply(row) : null;
    },
    async findMailReplyById(replyId) {
      const row = await db.prepare(
        `SELECT ${MAIL_REPLY_COLUMNS} FROM scenario_provisioning_mail_replies WHERE id = ?`,
      ).bind(replyId).first<MailReplyRow>();
      return row ? mapMailReply(row) : null;
    },
    async findMailReplyByMarker(responseMarker) {
      const row = await db.prepare(
        `SELECT ${MAIL_REPLY_COLUMNS} FROM scenario_provisioning_mail_replies WHERE response_marker = ?`,
      ).bind(responseMarker).first<MailReplyRow>();
      return row ? mapMailReply(row) : null;
    },
    async createMailReply(reply) {
      await db.prepare(
        `INSERT INTO scenario_provisioning_mail_replies
         (id, job_id, mailbox_key, thread_id, reply_kind, response_marker, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        reply.id, reply.jobId, reply.mailboxKey, reply.threadId,
        reply.replyKind, reply.responseMarker, reply.createdAt,
      ).run();
    },
    async findMailMessage(mailboxKey, providerMessageId) {
      const row = await db.prepare(
        `SELECT ${MAIL_MESSAGE_COLUMNS} FROM scenario_provisioning_mail_messages
         WHERE mailbox_key = ? AND provider_message_id = ?`,
      ).bind(mailboxKey, providerMessageId).first<MailMessageRow>();
      return row ? mapMailMessage(row) : null;
    },
    async recordMailMessage(message) {
      const result = await db.prepare(
        `INSERT INTO scenario_provisioning_mail_messages
         (id, reply_id, mailbox_key, thread_id, provider_message_id, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(mailbox_key, provider_message_id) DO NOTHING`,
      ).bind(
        message.id, message.replyId, message.mailboxKey, message.threadId,
        message.providerMessageId, message.recordedAt,
      ).run();
      return (result.meta.changes ?? 0) === 1;
    },
    finalize: (input) => finalizeProvisioning(db, input),
    async findCommittedMapAsset(jobId, assetId) {
      const row = await db.prepare(
        `SELECT a.r2_key, a.content_type
         FROM scenario_provisioning_assets a
         JOIN scenario_provisioning_jobs j ON j.id = a.job_id
         WHERE a.job_id = ? AND a.asset_id = ? AND a.kind = 'map'
           AND a.committed_at IS NOT NULL AND j.status = 'ready'`,
      ).bind(jobId, assetId).first<{ r2_key: string; content_type: string }>();
      return row ? { r2Key: row.r2_key, contentType: row.content_type } : null;
    },
  };
}

function mapMailReply(row: MailReplyRow): ScenarioProvisioningMailReplyRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    mailboxKey: row.mailbox_key,
    threadId: row.thread_id,
    replyKind: row.reply_kind,
    responseMarker: row.response_marker,
    createdAt: row.created_at,
  };
}

function mapMailMessage(row: MailMessageRow): ScenarioProvisioningMailMessageRecord {
  return {
    id: row.id,
    replyId: row.reply_id,
    mailboxKey: row.mailbox_key,
    threadId: row.thread_id,
    providerMessageId: row.provider_message_id,
    recordedAt: row.recorded_at,
  };
}

export function createR2ScenarioProvisioningStorage(bucket: R2Bucket | undefined): ScenarioProvisioningObjectStorage {
  return {
    available: Boolean(bucket),
    async put(key, bytes, contentType) {
      if (!bucket) throw new Error("Scenario asset storage is unavailable.");
      await bucket.put(key, bytes, { httpMetadata: { contentType, cacheControl: "private, no-store" } });
    },
    async delete(key) {
      if (bucket) await bucket.delete(key);
    },
    async get(key) {
      return bucket ? bucket.get(key) : null;
    },
  };
}

async function finalizeProvisioning(
  db: D1Database,
  input: Parameters<ScenarioProvisioningRepository["finalize"]>[0],
): Promise<ScenarioProvisioningFinalizeResult> {
  if (input.job.status !== "finalizing") throw new ScenarioProvisioningWriteError("job_not_finalizing", "The job must be claimed before it is finalized.");
  const target = input.manifest.operation === "revise"
    ? await findTargetEncounter(db, input.manifest.targetScenarioCode!)
    : null;
  if (input.manifest.operation === "revise" && !target) throw new ScenarioProvisioningWriteError("scenario_not_found", "The scenario to revise was not found.", 404);
  if (target && input.job.baseScenarioVersion !== target.version) {
    throw new ScenarioProvisioningWriteError("scenario_changed", "The target scenario changed after this revision job was accepted. Review the latest scenario before retrying.");
  }
  if (target && input.mapPackage && (target.grid_width !== input.mapPackage.width || target.grid_height !== input.mapPackage.height)) {
    throw new ScenarioProvisioningWriteError("revision_map_size_changed", "A revision cannot change map dimensions automatically; prepare a new scenario or adjust it in Map Workshop.");
  }
  const scenarioId = target?.id ?? input.createId();
  const scenarioCode = target?.code ?? await uniqueScenarioCode(db, input.manifest.scenario.name);
  const scenarioName = input.manifest.scenario.name;
  const mapPackage = input.mapPackage;
  if (!target && !mapPackage) throw new ScenarioProvisioningWriteError("map_required", "A new scenario requires a prepared map.");

  const dmParticipant = target
    ? await db.prepare("SELECT id FROM participants WHERE encounter_id = ? AND name = 'Kevin' AND role = 'dm' ORDER BY joined_at LIMIT 1")
        .bind(scenarioId).first<{ id: string }>()
    : null;
  const dmParticipantId = dmParticipant?.id ?? input.createId();
  const statements: D1PreparedStatement[] = [];
  if (!dmParticipant) statements.push(db.prepare(
    `INSERT INTO participants (id, encounter_id, name, role, session_secret, joined_at, last_seen_at)
     VALUES (?, ?, 'Kevin', 'dm', ?, ?, ?)`,
  ).bind(dmParticipantId, scenarioId, input.createId(), input.now, input.now));

  const presetId = mapPackage ? input.createId() : null;
  if (!target) {
    statements.unshift(db.prepare(
      `INSERT INTO encounters
       (id, code, name, dm_briefing, version, status, map_asset, map_package_json,
        active_map_preset_id, grid_width, grid_height, current_round,
        active_initiative_order, strict_movement, updated_at)
       VALUES (?, ?, ?, ?, 1, 'setup', ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    ).bind(
      scenarioId, scenarioCode, scenarioName, input.manifest.scenario.briefing,
      mapPackage!.visual.assetUrl, JSON.stringify(mapPackage), presetId,
      mapPackage!.width, mapPackage!.height,
      (input.manifest.settings.strictMovement ?? true) ? 1 : 0,
      input.now,
    ));
  } else {
    const briefing = input.manifest.scenario.briefing;
    if (mapPackage) {
      statements.push(db.prepare(
        `UPDATE encounters SET name = ?, dm_briefing = CASE WHEN ? = '' THEN dm_briefing ELSE ? END,
         map_asset = ?, map_package_json = ?, active_map_preset_id = ?,
         strict_movement = COALESCE(?, strict_movement), version = version + 1, updated_at = ?
         WHERE id = ?`,
      ).bind(
        scenarioName, briefing, briefing, mapPackage.visual.assetUrl, JSON.stringify(mapPackage), presetId,
        booleanInteger(input.manifest.settings.strictMovement), input.now, scenarioId,
      ));
    } else {
      statements.push(db.prepare(
        `UPDATE encounters SET name = ?, dm_briefing = CASE WHEN ? = '' THEN dm_briefing ELSE ? END,
         strict_movement = COALESCE(?, strict_movement), version = version + 1, updated_at = ?
         WHERE id = ?`,
      ).bind(scenarioName, briefing, briefing, booleanInteger(input.manifest.settings.strictMovement), input.now, scenarioId));
    }
  }
  if (mapPackage && presetId) statements.push(db.prepare(
    `INSERT INTO map_presets
     (id, encounter_id, name, description, source_prompt, package_json, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    presetId, scenarioId, input.manifest.scenario.presetName,
    input.manifest.scenario.presetDescription, input.manifest.map?.sourcePrompt ?? null,
    JSON.stringify(mapPackage), dmParticipantId, input.now, input.now,
  ));

  const dimensions = mapPackage
    ? { width: mapPackage.width, height: mapPackage.height }
    : { width: target!.grid_width, height: target!.grid_height };
  const placedTokenIds: string[] = [];
  if (!target && input.manifest.party.include) {
    const party = await loadParty(db, input.manifest.party.sourceScenarioCode);
    if (party.length !== PARTY_NAMES.length) throw new ScenarioProvisioningWriteError("party_source_incomplete", "The configured source scenario does not contain the complete established party.");
    const requested = new Map(input.manifest.party.placements.map((placement) => [placement.name.toLowerCase(), placement]));
    party.forEach((token, index) => {
      const placement = requested.get(token.name.toLowerCase()) ?? defaultPartyPlacement(index, dimensions.width, dimensions.height);
      requireTokenPosition(placement.x, placement.y, token.size, dimensions.width, dimensions.height, token.name);
      const tokenId = input.createId();
      placedTokenIds.push(tokenId);
      statements.push(insertToken(db, {
        id: tokenId, encounterId: scenarioId, name: token.name, x: placement.x, y: placement.y,
        artAsset: token.art_asset, kind: token.kind, size: token.size, speed: token.speed,
        armorClass: token.armor_class, hp: token.max_hp, maxHp: token.max_hp, hidden: false, now: input.now,
      }));
    });
  }

  const catalog = await prepareCatalog(db, input.manifest, input.assets, input.job.id, input.now);
  statements.push(...catalog.statements);
  for (const requested of input.manifest.creatures) {
    const creature = catalog.records.get(requested.catalogId);
    if (!creature) throw new ScenarioProvisioningWriteError("catalog_missing", `Creature ${requested.catalogId} is not available.`);
    for (const placement of requested.placements) {
      requireTokenPosition(placement.x, placement.y, creature.size, dimensions.width, dimensions.height, creature.name);
      const tokenId = input.createId();
      const maxHp = placement.maxHp ?? creature.defaultHp;
      const hp = placement.hp ?? maxHp;
      placedTokenIds.push(tokenId);
      statements.push(insertToken(db, {
        id: tokenId, encounterId: scenarioId, name: placement.name ?? creature.name,
        x: placement.x, y: placement.y, artAsset: creature.tokenAsset, kind: "monster",
        size: creature.size, speed: creature.walkSpeed, armorClass: creature.armorClass, hp, maxHp,
        hidden: placement.hidden, now: input.now,
      }));
    }
  }

  const handoutIds = await prepareHandouts(db, input.manifest, input.assets, scenarioId, dmParticipantId, input.now, input.createId, statements);
  statements.push(db.prepare(
    "UPDATE scenario_provisioning_assets SET committed_at = ? WHERE job_id = ? AND committed_at IS NULL",
  ).bind(input.now, input.job.id));
  const result: ScenarioProvisioningFinalizeResult = {
    jobId: input.job.id,
    status: "ready",
    scenario: { id: scenarioId, code: scenarioCode, name: scenarioName },
    presetId,
    handoutIds,
    placedTokenIds,
    createdCatalogIds: catalog.created,
    reusedCatalogIds: catalog.reused,
    assumptions: input.manifest.assumptions,
    reviewWarnings: input.manifest.reviewWarnings,
  };
  statements.push(db.prepare(
    `UPDATE scenario_provisioning_jobs SET status = 'ready', scenario_id = ?, scenario_code = ?,
     summary = ?, error_code = NULL, result_json = ?, updated_at = ?
     WHERE id = ? AND status = 'finalizing'`,
  ).bind(
    scenarioId, scenarioCode, `Scenario ${scenarioName} is ready to test.`, JSON.stringify(result),
    input.now, input.job.id,
  ));
  await db.batch(statements);
  return result;
}

async function prepareCatalog(
  db: D1Database,
  manifest: ScenarioProvisioningManifest,
  assets: ScenarioProvisioningAssetRecord[],
  jobId: string,
  now: number,
) {
  const records = new Map<string, { id: string; name: string; size: CreatureSize; defaultHp: number; armorClass: number; walkSpeed: number; tokenAsset: string; thumbnailAsset: string }>();
  const statements: D1PreparedStatement[] = [];
  const created: string[] = [];
  const reused: string[] = [];
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const maximum = await db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS value FROM creature_catalog").first<{ value: number }>();
  let sortOrder = maximum?.value ?? 0;
  for (const requested of manifest.creatures) {
    const existing = await db.prepare(
      `SELECT id, name, size, default_hp, armor_class, walk_speed, token_asset, thumbnail_asset, is_active
       FROM creature_catalog WHERE id = ?`,
    ).bind(requested.catalogId).first<CatalogRow>();
    if (existing) {
      if (!existing.is_active) throw new ScenarioProvisioningWriteError("catalog_inactive", `Creature ${requested.catalogId} exists but is inactive.`);
      records.set(requested.catalogId, {
        id: existing.id, name: existing.name, size: existing.size, defaultHp: existing.default_hp,
        armorClass: existing.armor_class, walkSpeed: existing.walk_speed,
        tokenAsset: existing.token_asset, thumbnailAsset: existing.thumbnail_asset,
      });
      reused.push(requested.catalogId);
      continue;
    }
    if (!requested.create) throw new ScenarioProvisioningWriteError("catalog_missing", `Creature ${requested.catalogId} is not in the catalog and no prepared catalog entry was supplied.`);
    const nameCollision = await db.prepare("SELECT id FROM creature_catalog WHERE lower(name) = lower(?) LIMIT 1")
      .bind(requested.create.name).first<{ id: string }>();
    if (nameCollision) throw new ScenarioProvisioningWriteError("catalog_duplicate_name", `${requested.create.name} already exists as ${nameCollision.id}.`);
    const original = assetById.get(requested.create.originalAssetId);
    const thumbnail = assetById.get(requested.create.thumbnailAssetId);
    if (!original || !thumbnail) throw new ScenarioProvisioningWriteError("catalog_assets_missing", `Prepared art is missing for ${requested.create.name}.`);
    if (original.kind !== "creature-original" || original.contentType !== "image/png" || thumbnail.kind !== "creature-thumbnail" || thumbnail.contentType !== "image/png") {
      throw new ScenarioProvisioningWriteError("catalog_asset_path_invalid", `Prepared art storage is invalid for ${requested.create.name}.`);
    }
    const tokenAsset = `/creature-assets/tokens/provisioned/${jobId}/${requested.create.originalAssetId}.png`;
    const thumbnailAsset = `/creature-assets/tokens/provisioned/${jobId}/${requested.create.thumbnailAssetId}.png?variant=thumbnail&v=1`;
    sortOrder += 10;
    const creature = requested.create;
    statements.push(db.prepare(
      `INSERT INTO creature_catalog
       (id, name, family, creature_type, size, default_hp, hit_dice, armor_class, challenge_rating,
        default_speed, walk_speed, fly_speed, swim_speed, climb_speed, burrow_speed, source_asset,
        token_asset, thumbnail_asset, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      requested.catalogId, creature.name, creature.family, creature.creatureType, creature.size,
      creature.defaultHp, creature.hitDice, creature.armorClass, creature.challengeRating,
      creature.speeds.walk, creature.speeds.walk, creature.speeds.fly, creature.speeds.swim,
      creature.speeds.climb, creature.speeds.burrow, `r2://${original.r2Key}`,
      tokenAsset, thumbnailAsset, sortOrder, now, now,
    ));
    records.set(requested.catalogId, {
      id: requested.catalogId, name: creature.name, size: creature.size, defaultHp: creature.defaultHp,
      armorClass: creature.armorClass, walkSpeed: creature.speeds.walk, tokenAsset, thumbnailAsset,
    });
    created.push(requested.catalogId);
  }
  return { records, statements, created, reused };
}

async function prepareHandouts(
  db: D1Database,
  manifest: ScenarioProvisioningManifest,
  assets: ScenarioProvisioningAssetRecord[],
  scenarioId: string,
  participantId: string,
  now: number,
  createId: () => string,
  statements: D1PreparedStatement[],
): Promise<string[]> {
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const additions = manifest.handouts.filter((handout) => !handout.replaceHandoutId).length;
  const count = await db.prepare("SELECT COUNT(*) AS value FROM handouts WHERE encounter_id = ? AND deleted_at IS NULL")
    .bind(scenarioId).first<{ value: number }>();
  if ((count?.value ?? 0) + additions > HANDOUT_MAX_PER_SCENARIO) throw new ScenarioProvisioningWriteError("handout_limit", "The scenario handout limit would be exceeded.");
  const ids: string[] = [];
  for (const handout of manifest.handouts) {
    const display = assetById.get(handout.displayAssetId);
    const thumbnail = assetById.get(handout.thumbnailAssetId);
    if (!display || !thumbnail || display.contentType !== thumbnail.contentType) throw new ScenarioProvisioningWriteError("handout_assets_invalid", `Prepared assets are invalid for ${handout.title}.`);
    const handoutId = handout.replaceHandoutId ?? createId();
    if (handout.replaceHandoutId) {
      const existing = await db.prepare("SELECT 1 AS found FROM handouts WHERE id = ? AND encounter_id = ? AND deleted_at IS NULL")
        .bind(handoutId, scenarioId).first<{ found: number }>();
      if (!existing) throw new ScenarioProvisioningWriteError("handout_not_found", `The handout to replace for ${handout.title} was not found.`, 404);
      statements.push(db.prepare(
        `UPDATE handouts SET title = ?, display_key = ?, thumbnail_key = ?, mime_type = ?,
         width = ?, height = ?, display_bytes = ?, thumbnail_bytes = ?, updated_at = ?
         WHERE id = ? AND encounter_id = ? AND deleted_at IS NULL`,
      ).bind(
        handout.title, display.r2Key, thumbnail.r2Key, display.contentType,
        display.width, display.height, display.byteLength, thumbnail.byteLength,
        now, handoutId, scenarioId,
      ));
    } else {
      statements.push(db.prepare(
        `INSERT INTO handouts
         (id, encounter_id, title, display_key, thumbnail_key, mime_type, width, height,
          display_bytes, thumbnail_bytes, created_by, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).bind(
        handoutId, scenarioId, handout.title, display.r2Key, thumbnail.r2Key,
        display.contentType, display.width, display.height, display.byteLength,
        thumbnail.byteLength, participantId, now, now,
      ));
    }
    ids.push(handoutId);
  }
  return ids;
}

function insertToken(db: D1Database, token: {
  id: string; encounterId: string; name: string; x: number; y: number; artAsset: string | null;
  kind: string; size: CreatureSize; speed: number; armorClass: number | null; hp: number | null; maxHp: number | null;
  hidden: boolean; now: number;
}) {
  return db.prepare(
    `INSERT INTO tokens
     (id, encounter_id, name, x, y, art_asset, kind, size, speed, armor_class, hp, max_hp,
      is_hidden, summoner_token_id, initiative, initiative_group_id, initiative_order,
      turn_complete, movement_used, movement_origin_x, movement_origin_y,
      owner_participant_id, owner_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL, NULL, ?)`,
  ).bind(
    token.id, token.encounterId, token.name, token.x, token.y, token.artAsset, token.kind,
    token.size, token.speed, token.armorClass, token.hp, token.maxHp, token.hidden ? 1 : 0, token.now,
  );
}

async function loadParty(db: D1Database, code: string): Promise<TokenRow[]> {
  const rows = await db.prepare(
    `SELECT t.id, t.name, t.x, t.y, t.art_asset, t.kind, t.size, t.speed, t.armor_class, t.hp, t.max_hp,
            t.is_hidden, t.summoner_token_id, t.initiative, t.initiative_group_id,
            t.initiative_order, t.turn_complete, t.movement_used, t.movement_origin_x,
            t.movement_origin_y, t.owner_participant_id, t.owner_name
     FROM tokens t JOIN encounters e ON e.id = t.encounter_id
     WHERE e.code = ? AND t.summoner_token_id IS NULL AND t.name IN (?, ?, ?)
     ORDER BY CASE t.name WHEN ? THEN 0 WHEN ? THEN 1 WHEN ? THEN 2 ELSE 3 END`,
  ).bind(code, ...PARTY_NAMES, ...PARTY_NAMES).all<TokenRow>();
  return rows.results;
}

async function findTargetEncounter(db: D1Database, code: string): Promise<EncounterTarget | null> {
  return db.prepare(
    "SELECT id, code, name, version, status, grid_width, grid_height FROM encounters WHERE code = ?",
  ).bind(code).first<EncounterTarget>();
}

async function uniqueScenarioCode(db: D1Database, name: string): Promise<string> {
  const base = scenarioCodeFromName(name);
  for (let attempt = 1; attempt <= 99; attempt += 1) {
    const suffix = attempt === 1 ? "" : `-${attempt}`;
    const code = `${base.slice(0, 24 - suffix.length)}${suffix}`;
    const exists = await db.prepare("SELECT 1 AS found FROM encounters WHERE code = ? LIMIT 1").bind(code).first();
    if (!exists) return code;
  }
  throw new ScenarioProvisioningWriteError("scenario_code_exhausted", "No unique scenario code is available.");
}

function defaultPartyPlacement(index: number, width: number, height: number) {
  return { x: Math.min(width - 1, 2 + index * 1.5), y: Math.max(1, height - 2) };
}

function requireTokenPosition(x: number, y: number, size: CreatureSize, width: number, height: number, name: string) {
  const radius = tokenRadiusCells(size);
  if (x < radius || x > width - radius || y < radius || y > height - radius) {
    throw new ScenarioProvisioningWriteError("token_out_of_bounds", `${name} is placed outside the usable map bounds.`);
  }
}

function booleanInteger(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function mapJob(row: JobRow): ScenarioProvisioningJobRecord {
  return {
    id: row.id, idempotencyKey: row.idempotency_key, revision: row.revision,
    operation: row.operation, status: row.status, manifestJson: row.manifest_json,
    manifestHash: row.manifest_hash, scenarioId: row.scenario_id, scenarioCode: row.scenario_code,
    baseScenarioVersion: row.base_scenario_version,
    summary: row.summary, errorCode: row.error_code, resultJson: row.result_json,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapAsset(row: AssetRow): ScenarioProvisioningAssetRecord {
  return {
    id: row.id, jobId: row.job_id, assetId: row.asset_id, kind: row.kind,
    r2Key: row.r2_key, contentType: row.content_type, width: row.width, height: row.height,
    byteLength: row.byte_length, sha256: row.sha256, committedAt: row.committed_at,
    createdAt: row.created_at,
  };
}
