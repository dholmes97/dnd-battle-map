import { isCreatureSize, type CreatureSize } from "../../shared/creature-library.ts";
import { orderedInitiativeGroups } from "../../shared/initiative-domain.ts";
import type { HistoryDirection, HistoryRepository } from "../ports/history-repository.ts";
import type { ActionRow } from "../types.ts";

export function createD1HistoryRepository(db: D1Database): HistoryRepository {
  return {
    async listParticipantActions(encounterId, participantId) {
      const rows = await db.prepare(
        `SELECT id, action_type, payload_json, created_at FROM actions
         WHERE encounter_id = ? AND participant_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 200`,
      ).bind(encounterId, participantId).all<ActionRow>();
      return rows.results;
    },
    async activeLeaderIds(encounterId, activeOrder) {
      if (activeOrder === null) return [];
      const rows = await db.prepare(
        `SELECT DISTINCT CASE WHEN summoner_token_id IS NULL THEN id ELSE summoner_token_id END AS id
         FROM tokens WHERE encounter_id = ? AND initiative_order = ?`,
      ).bind(encounterId, activeOrder).all<{ id: string }>();
      return rows.results.map((row) => row.id);
    },
    async applyAction(input) {
      const expectedChanges = input.actionType === "initiative_group_set"
        ? members(input.payload).length
        : 1;
      const changes = await applyAction(db, input);
      return { changes, expectedChanges };
    },
    async rebuildInitiativeOrders(encounterId, activeLeaderIds, now) {
      const tokens = await db.prepare(
        `SELECT id, name, initiative, initiative_group_id, summoner_token_id
         FROM tokens WHERE encounter_id = ? ORDER BY name, id`,
      ).bind(encounterId).all<{
        id: string; name: string; initiative: number | null;
        initiative_group_id: string | null; summoner_token_id: string | null;
      }>();
      const groups = orderedInitiativeGroups(tokens.results.map((token) => ({
        id: token.id,
        name: token.name,
        initiative: token.initiative,
        initiativeGroupId: token.initiative_group_id,
        summonerTokenId: token.summoner_token_id,
        kind: "monster",
        artAsset: null,
        initiativeOrder: null,
        controlledByViewer: false,
      }))).map((group) => group.map((token) => token.id));
      const activeOrder = Math.max(0, groups.findIndex((group) =>
        group.some((id) => activeLeaderIds.includes(id))
      ));
      await db.batch([
        db.prepare(
          "UPDATE tokens SET initiative_order = NULL, updated_at = ? WHERE encounter_id = ?",
        ).bind(now, encounterId),
        ...groups.flatMap((group, order) => group.map((leaderId) => db.prepare(
          `UPDATE tokens SET initiative_order = ?, updated_at = ?
           WHERE encounter_id = ? AND (id = ? OR summoner_token_id = ?)`,
        ).bind(order, now, encounterId, leaderId, leaderId))),
        db.prepare(
          "UPDATE encounters SET active_initiative_order = ?, updated_at = ? WHERE id = ?",
        ).bind(groups.length ? activeOrder : null, now, encounterId),
      ]);
    },
  };
}

async function applyAction(
  db: D1Database,
  input: Parameters<HistoryRepository["applyAction"]>[0],
): Promise<number> {
  const { direction, encounterId, participantId, actionType, payload, now } = input;
  const tokenId = cleanId(payload.tokenId);
  const undo = direction === "undo";
  if (actionType === "token_moved") {
    const from = point(payload.from)!;
    const to = point(payload.to)!;
    const origin = point(undo ? payload.previousMovementOrigin : payload.movementOrigin, true);
    const result = await db.prepare(
      `UPDATE tokens SET x = ?, y = ?, movement_used = ?, movement_origin_x = ?,
       movement_origin_y = ?, updated_at = ?
       WHERE id = ? AND encounter_id = ? AND x = ? AND y = ?`,
    ).bind(
      undo ? from.x : to.x,
      undo ? from.y : to.y,
      Number(undo ? payload.previousMovementUsed : payload.movementUsed) || 0,
      origin?.x ?? null,
      origin?.y ?? null,
      now,
      tokenId,
      encounterId,
      undo ? to.x : from.x,
      undo ? to.y : from.y,
    ).run();
    return changes(result);
  }
  if (actionType === "hp_changed") {
    const result = await db.prepare(
      "UPDATE tokens SET hp = ?, updated_at = ? WHERE id = ? AND encounter_id = ? AND hp = ?",
    ).bind(
      Number(undo ? payload.from : payload.to),
      now,
      tokenId,
      encounterId,
      Number(undo ? payload.to : payload.from),
    ).run();
    return changes(result);
  }
  if (actionType === "initiative_set") {
    const result = undo
      ? await db.prepare(
        `UPDATE tokens SET initiative = ?, initiative_group_id = ?, initiative_order = NULL,
         turn_complete = 0, movement_used = 0, movement_origin_x = NULL,
         movement_origin_y = NULL, updated_at = ?
         WHERE id = ? AND encounter_id = ? AND initiative = ? AND initiative_group_id IS NULL`,
      ).bind(payload.from ?? null, payload.fromGroupId ?? null, now, tokenId, encounterId, payload.to).run()
      : await db.prepare(
        `UPDATE tokens SET initiative = ?, initiative_group_id = NULL, initiative_order = NULL,
         turn_complete = 0, movement_used = 0, movement_origin_x = NULL,
         movement_origin_y = NULL, updated_at = ?
         WHERE id = ? AND encounter_id = ? AND initiative IS ? AND initiative_group_id IS ?`,
      ).bind(payload.to, now, tokenId, encounterId, payload.from ?? null, payload.fromGroupId ?? null).run();
    return changes(result);
  }
  if (actionType === "initiative_group_set") {
    return applyInitiativeGroup(db, direction, encounterId, payload, now);
  }
  if (actionType === "effect_added") {
    return undo
      ? deleteRow(db, "effects", cleanId(payload.effectId), encounterId)
      : insertEffect(db, encounterId, (payload.effect ?? payload) as Record<string, unknown>, participantId, now);
  }
  if (actionType === "effect_removed") {
    return undo
      ? insertEffect(db, encounterId, payload.effect as Record<string, unknown>, participantId, now)
      : deleteRow(db, "effects", cleanId(payload.effectId), encounterId);
  }
  if (actionType === "annotation_added") {
    return undo
      ? deleteRow(db, "annotations", cleanId(payload.annotationId), encounterId)
      : insertAnnotation(db, encounterId, (payload.annotation ?? payload) as Record<string, unknown>, participantId, now);
  }
  if (actionType === "annotation_removed") {
    return undo
      ? insertAnnotation(db, encounterId, payload.annotation as Record<string, unknown>, participantId, now)
      : deleteRow(db, "annotations", cleanId(payload.annotationId), encounterId);
  }
  if (actionType === "token_created") {
    if (undo) {
      const result = await db.prepare(
        "DELETE FROM tokens WHERE id = ? AND encounter_id = ? AND owner_participant_id IS NULL",
      ).bind(tokenId, encounterId).run();
      return changes(result);
    }
    return insertToken(db, encounterId, tokenId, (payload.token ?? payload) as Record<string, unknown>, now);
  }
  if (actionType === "token_updated") {
    const value = payload[undo ? "previous" : "next"] as Record<string, unknown> | undefined;
    return value ? updateToken(db, encounterId, tokenId, value, input, now) : 0;
  }
  return 0;
}

async function applyInitiativeGroup(
  db: D1Database,
  direction: HistoryDirection,
  encounterId: string,
  payload: Record<string, unknown>,
  now: number,
) {
  const values = members(payload);
  const groupId = cleanId(payload.groupId);
  if (!values.length) return 0;
  if (direction === "undo") {
    const current = await db.prepare(
      "SELECT id FROM tokens WHERE encounter_id = ? AND initiative_group_id = ? AND initiative = ?",
    ).bind(encounterId, groupId, payload.to).all<{ id: string }>();
    if (current.results.length !== values.length ||
        !values.every((member) => current.results.some((row) => row.id === cleanId(member.tokenId)))) return 0;
    const results = await db.batch(values.map((member) => db.prepare(
      `UPDATE tokens SET initiative = ?, initiative_group_id = ?, initiative_order = NULL,
       turn_complete = 0, movement_used = 0, movement_origin_x = NULL,
       movement_origin_y = NULL, updated_at = ?
       WHERE id = ? AND encounter_id = ? AND initiative_group_id = ? AND initiative = ?`,
    ).bind(member.from ?? null, member.fromGroupId ?? null, now, cleanId(member.tokenId), encounterId, groupId, payload.to)));
    return results.reduce((sum, result) => sum + changes(result), 0);
  }
  const valid = await Promise.all(values.map((member) => db.prepare(
    "SELECT id FROM tokens WHERE id = ? AND encounter_id = ? AND initiative IS ? AND initiative_group_id IS ?",
  ).bind(cleanId(member.tokenId), encounterId, member.from ?? null, member.fromGroupId ?? null).first()));
  if (!valid.every(Boolean)) return 0;
  const results = await db.batch(values.map((member) => db.prepare(
    `UPDATE tokens SET initiative = ?, initiative_group_id = ?, initiative_order = NULL,
     turn_complete = 0, movement_used = 0, movement_origin_x = NULL,
     movement_origin_y = NULL, updated_at = ?
     WHERE id = ? AND encounter_id = ? AND initiative IS ? AND initiative_group_id IS ?`,
  ).bind(payload.to, groupId, now, cleanId(member.tokenId), encounterId, member.from ?? null, member.fromGroupId ?? null)));
  return results.reduce((sum, result) => sum + changes(result), 0);
}

async function insertEffect(db: D1Database, encounterId: string, effect: Record<string, unknown> | undefined, participantId: string, now: number) {
  if (!effect) return 0;
  const result = await db.prepare(
    `INSERT OR IGNORE INTO effects
     (id, encounter_id, token_id, name, effect_type, duration_rounds,
      expires_round, reminder_timing, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    cleanId(effect.id ?? effect.effectId), encounterId, cleanId(effect.tokenId),
    cleanText(effect.name, 48), cleanText(effect.effectType, 24) || "effect",
    effect.durationRounds ?? null, effect.expiresRound ?? null,
    cleanText(effect.reminderTiming, 16) || "end",
    cleanId(effect.createdBy) || participantId, Number(effect.createdAt) || now,
  ).run();
  return changes(result);
}

async function insertAnnotation(db: D1Database, encounterId: string, annotation: Record<string, unknown> | undefined, participantId: string, now: number) {
  if (!annotation) return 0;
  const result = await db.prepare(
    `INSERT OR IGNORE INTO annotations
     (id, encounter_id, annotation_type, x, y, x2, y2, color, label,
      created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    cleanId(annotation.id ?? annotation.annotationId), encounterId,
    cleanText(annotation.annotationType, 24), Number(annotation.x), Number(annotation.y),
    annotation.x2 ?? null, annotation.y2 ?? null,
    cleanText(annotation.color, 16) || "#f5c65c", cleanText(annotation.label, 48) || null,
    cleanId(annotation.createdBy) || participantId, annotation.expiresAt ?? null,
    Number(annotation.createdAt) || now,
  ).run();
  return changes(result);
}

async function insertToken(db: D1Database, encounterId: string, tokenId: string, token: Record<string, unknown>, now: number) {
  const result = await db.prepare(
    `INSERT OR IGNORE INTO tokens
     (id, encounter_id, name, x, y, art_asset, kind, size, speed, armor_class, hp, max_hp,
      is_hidden, summoner_token_id, initiative, initiative_order, turn_complete,
      movement_used, owner_participant_id, owner_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, ?)`,
  ).bind(
    tokenId, encounterId, cleanText(token.name, 48), Number(token.x), Number(token.y),
    token.artAsset ?? null, cleanText(token.kind, 16) || "monster",
    isCreatureSize(token.size) ? token.size : "medium", Number(token.speed) || 30,
    cleanArmorClass(token.armorClass), token.hp ?? null, token.maxHp ?? null, token.hidden ? 1 : 0,
    cleanId(token.summonerTokenId) || null, token.initiative ?? null,
    token.initiativeOrder ?? null, now,
  ).run();
  return changes(result);
}

async function updateToken(
  db: D1Database,
  encounterId: string,
  tokenId: string,
  value: Record<string, unknown>,
  input: Parameters<HistoryRepository["applyAction"]>[0],
  now: number,
) {
  const current = await db.prepare(
    "SELECT x, y, size, armor_class FROM tokens WHERE id = ? AND encounter_id = ?",
  ).bind(tokenId, encounterId).first<{ x: number; y: number; size: CreatureSize; armor_class: number | null }>();
  const result = await db.prepare(
    `UPDATE tokens SET name = ?, size = ?, x = ?, y = ?, speed = ?, armor_class = ?, hp = ?,
     max_hp = ?, is_hidden = ?, art_asset = ?, updated_at = ?
     WHERE id = ? AND encounter_id = ?`,
  ).bind(
    cleanText(value.name, 48), isCreatureSize(value.size) ? value.size : current?.size ?? "medium",
    Number.isFinite(Number(value.x)) ? Number(value.x) : current?.x ?? input.gridWidth / 2,
    Number.isFinite(Number(value.y)) ? Number(value.y) : current?.y ?? input.gridHeight / 2,
    Number(value.speed), value.armorClass === undefined ? current?.armor_class ?? null : cleanArmorClass(value.armorClass),
    value.hp ?? null, value.maxHp ?? null, value.hidden ? 1 : 0,
    value.artAsset ?? null, now, tokenId, encounterId,
  ).run();
  return changes(result);
}

function cleanArmorClass(value: unknown) {
  const armorClass = Math.trunc(Number(value));
  return Number.isFinite(armorClass) && armorClass >= 1 && armorClass <= 40 ? armorClass : null;
}

async function deleteRow(db: D1Database, table: "effects" | "annotations", id: string, encounterId: string) {
  const result = await db.prepare(`DELETE FROM ${table} WHERE id = ? AND encounter_id = ?`)
    .bind(id, encounterId).run();
  return changes(result);
}

function members(payload: Record<string, unknown>) {
  return Array.isArray(payload.members) ? payload.members as Array<Record<string, unknown>> : [];
}

function point(value: unknown, optional = false): { x: number; y: number } | null {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return { x: Number(record.x), y: Number(record.y) };
  }
  return optional ? null : { x: 0, y: 0 };
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function cleanId(value: unknown) {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) : "";
}

function changes(result: D1Result) {
  return result.meta.changes ?? 0;
}
