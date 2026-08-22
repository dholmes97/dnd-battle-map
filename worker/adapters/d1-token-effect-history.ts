import { isCreatureSize, type CreatureSize } from "../../shared/creature-library.ts";
import type { HistoryReplayInput } from "../ports/history-repository.ts";

export async function replayTokenEffectHistory(
  db: D1Database,
  input: HistoryReplayInput,
): Promise<number> {
  const { actionType, direction, encounterId, payload, now } = input;
  const undo = direction === "undo";
  const tokenId = cleanId(payload.tokenId);
  if (actionType === "token_moved") {
    const from = point(payload.from)!;
    const to = point(payload.to)!;
    const expected = undo ? to : from;
    const current = await db.prepare(
      "SELECT x, y, altitude FROM tokens WHERE id = ? AND encounter_id = ?",
    ).bind(tokenId, encounterId).first<{ x: number; y: number; altitude: number }>();
    const expectedAltitude = Number(undo ? payload.altitude : payload.previousAltitude) || 0;
    if (!current || current.x !== expected.x || current.y !== expected.y || current.altitude !== expectedAltitude) return 0;
    const destination = undo ? from : to;
    const origin = point(undo ? payload.previousMovementOrigin : payload.movementOrigin, true);
    await db.prepare(
      `UPDATE tokens SET x = ?, y = ?, altitude = ?, movement_used = ?,
       movement_origin_x = ?, movement_origin_y = ?, updated_at = ?
       WHERE id = ? AND encounter_id = ?`,
    ).bind(
      destination.x,
      destination.y,
      Number(undo ? payload.previousAltitude : payload.altitude) || 0,
      Number(undo ? payload.previousMovementUsed : payload.movementUsed) || 0,
      origin?.x ?? null,
      origin?.y ?? null,
      now,
      tokenId,
      encounterId,
    ).run();
    return 1;
  }
  if (actionType === "hp_changed") {
    const expected = Number(undo ? payload.to : payload.from);
    const current = await db.prepare(
      "SELECT hp FROM tokens WHERE id = ? AND encounter_id = ?",
    ).bind(tokenId, encounterId).first<{ hp: number | null }>();
    if (!current || current.hp !== expected) return 0;
    await db.prepare(
      "UPDATE tokens SET hp = ?, updated_at = ? WHERE id = ? AND encounter_id = ?",
    ).bind(Number(undo ? payload.from : payload.to), now, tokenId, encounterId).run();
    return 1;
  }
  if (actionType === "effect_added" || actionType === "effect_removed") {
    const effectId = cleanId(payload.effectId);
    const shouldInsert = (actionType === "effect_added") === !undo;
    const exists = Boolean(await db.prepare(
      "SELECT 1 AS found FROM effects WHERE id = ? AND encounter_id = ?",
    ).bind(effectId, encounterId).first());
    if (shouldInsert === exists) return 0;
    if (!shouldInsert) {
      await db.prepare("DELETE FROM effects WHERE id = ? AND encounter_id = ?")
        .bind(effectId, encounterId).run();
      return 1;
    }
    const effect = (payload.effect ?? payload) as Record<string, unknown>;
    await db.prepare(
      `INSERT INTO effects
       (id, encounter_id, token_id, name, effect_type, duration_rounds,
        expires_round, reminder_timing, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      cleanId(effect.id ?? effect.effectId), encounterId, cleanId(effect.tokenId),
      cleanText(effect.name, 48), cleanText(effect.effectType, 24) || "effect",
      effect.durationRounds ?? null, effect.expiresRound ?? null,
      cleanText(effect.reminderTiming, 16) || "end",
      cleanId(effect.createdBy) || input.participantId, Number(effect.createdAt) || now,
    ).run();
    return 1;
  }
  if (actionType === "token_created" || actionType === "spell_effect_dismissed") {
    const shouldInsert = (actionType === "token_created") === !undo;
    const exists = Boolean(await db.prepare(
      "SELECT 1 AS found FROM tokens WHERE id = ? AND encounter_id = ?",
    ).bind(tokenId, encounterId).first());
    if (shouldInsert === exists) return 0;
    if (!shouldInsert) {
      await db.prepare("DELETE FROM tokens WHERE id = ? AND encounter_id = ?")
        .bind(tokenId, encounterId).run();
      return 1;
    }
    await insertToken(db, encounterId, tokenId, (payload.token ?? payload) as Record<string, unknown>, now);
    return 1;
  }
  if (actionType === "token_updated") {
    const expected = payload[undo ? "next" : "previous"] as Record<string, unknown> | undefined;
    const value = payload[undo ? "previous" : "next"] as Record<string, unknown> | undefined;
    if (!expected || !value) return 0;
    const current = await db.prepare(
      `SELECT name, size, speed, fly_speed, swim_speed, climb_speed, burrow_speed,
       altitude, armor_class, hp, max_hp, is_hidden, art_asset, x, y
       FROM tokens WHERE id = ? AND encounter_id = ?`,
    ).bind(tokenId, encounterId).first<Record<string, unknown>>();
    if (!current || !tokenSnapshotMatches(current, expected)) return 0;
    await updateToken(db, encounterId, tokenId, value, current, input, now);
    return 1;
  }
  return 0;
}

async function insertToken(
  db: D1Database,
  encounterId: string,
  tokenId: string,
  token: Record<string, unknown>,
  now: number,
) {
  await db.prepare(
    `INSERT INTO tokens
     (id, encounter_id, name, x, y, art_asset, kind, size, speed, fly_speed, swim_speed,
      climb_speed, burrow_speed, armor_class, hp, max_hp, is_hidden, summoner_token_id,
      initiative, initiative_order, turn_complete, movement_used, altitude,
      owner_participant_id, owner_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, NULL, ?)`,
  ).bind(
    tokenId, encounterId, cleanText(token.name, 48), Number(token.x), Number(token.y),
    token.artAsset ?? null, cleanText(token.kind, 16) || "monster",
    isCreatureSize(token.size) ? token.size : "medium",
    finiteNumber(token.speed, 30), cleanSecondarySpeed(token.flySpeed),
    cleanSecondarySpeed(token.swimSpeed), cleanSecondarySpeed(token.climbSpeed),
    cleanSecondarySpeed(token.burrowSpeed), cleanArmorClass(token.armorClass),
    token.hp ?? null, token.maxHp ?? null, token.hidden ? 1 : 0,
    cleanId(token.summonerTokenId) || null, token.initiative ?? null,
    token.initiativeOrder ?? null, finiteNumber(token.altitude, 0), now,
  ).run();
}

async function updateToken(
  db: D1Database,
  encounterId: string,
  tokenId: string,
  value: Record<string, unknown>,
  current: Record<string, unknown>,
  input: HistoryReplayInput,
  now: number,
) {
  await db.prepare(
    `UPDATE tokens SET name = ?, size = ?, x = ?, y = ?, speed = ?, fly_speed = ?, swim_speed = ?,
     climb_speed = ?, burrow_speed = ?, altitude = ?, armor_class = ?, hp = ?, max_hp = ?,
     is_hidden = ?, art_asset = ?, updated_at = ? WHERE id = ? AND encounter_id = ?`,
  ).bind(
    cleanText(value.name, 48), isCreatureSize(value.size) ? value.size : current.size as CreatureSize,
    finiteNumber(value.x, Number(current.x) || input.gridWidth / 2),
    finiteNumber(value.y, Number(current.y) || input.gridHeight / 2),
    finiteNumber(value.speed, 30), value.flySpeed === undefined ? current.fly_speed : cleanSecondarySpeed(value.flySpeed),
    value.swimSpeed === undefined ? current.swim_speed : cleanSecondarySpeed(value.swimSpeed),
    value.climbSpeed === undefined ? current.climb_speed : cleanSecondarySpeed(value.climbSpeed),
    value.burrowSpeed === undefined ? current.burrow_speed : cleanSecondarySpeed(value.burrowSpeed),
    finiteNumber(value.altitude, Number(current.altitude) || 0),
    value.armorClass === undefined ? current.armor_class : cleanArmorClass(value.armorClass),
    value.hp ?? null, value.maxHp ?? null, value.hidden ? 1 : 0, value.artAsset ?? null,
    now, tokenId, encounterId,
  ).run();
}

function tokenSnapshotMatches(current: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  const pairs: Array<[string, string]> = [
    ["name", "name"], ["size", "size"], ["speed", "speed"], ["fly_speed", "flySpeed"],
    ["swim_speed", "swimSpeed"], ["climb_speed", "climbSpeed"], ["burrow_speed", "burrowSpeed"],
    ["altitude", "altitude"], ["armor_class", "armorClass"], ["hp", "hp"],
    ["max_hp", "maxHp"], ["art_asset", "artAsset"], ["x", "x"], ["y", "y"],
  ];
  return pairs.every(([column, property]) => expected[property] === undefined || current[column] === expected[property]) &&
    (expected.hidden === undefined || Boolean(current.is_hidden) === Boolean(expected.hidden));
}

function point(value: unknown, optional = false): { x: number; y: number } | null {
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    const x = Number(item.x);
    const y = Number(item.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  return optional ? null : { x: 0, y: 0 };
}

function cleanArmorClass(value: unknown) {
  const armorClass = Math.trunc(Number(value));
  return Number.isFinite(armorClass) && armorClass >= 1 && armorClass <= 40 ? armorClass : null;
}

function cleanSecondarySpeed(value: unknown) {
  const speed = Math.trunc(Number(value));
  return Number.isFinite(speed) && speed > 0 ? Math.min(240, speed) : null;
}

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function cleanId(value: unknown) {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) : "";
}
