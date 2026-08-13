import type { TokenEffectRepository } from "../ports/token-effect-repository.ts";
import type { TokenRow } from "../types.ts";

const TOKEN_COLUMNS = `id, name, x, y, art_asset, kind, size, speed, hp, max_hp, is_hidden,
  summoner_token_id, initiative, initiative_group_id, initiative_order, turn_complete,
  movement_used, movement_origin_x, movement_origin_y, owner_participant_id, owner_name`;

export function createD1TokenEffectRepository(db: D1Database): TokenEffectRepository {
  return {
    async findToken(encounterId, tokenId) {
      return await db.prepare(
        `SELECT ${TOKEN_COLUMNS} FROM tokens WHERE id = ? AND encounter_id = ?`,
      ).bind(tokenId, encounterId).first<TokenRow>() ?? null;
    },
    async createToken(input) {
      await db.prepare(
        `INSERT INTO tokens
         (id, encounter_id, name, x, y, art_asset, kind, size, speed, hp, max_hp,
          is_hidden, summoner_token_id, initiative, initiative_order, turn_complete,
          movement_used, owner_participant_id, owner_name, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, ?)`,
      ).bind(
        input.id,
        input.encounterId,
        input.name,
        input.x,
        input.y,
        input.artAsset,
        input.kind,
        input.size,
        input.speed,
        input.hp,
        input.maxHp,
        input.hidden ? 1 : 0,
        input.summonerTokenId,
        input.initiative,
        input.initiativeOrder,
        input.now,
      ).run();
    },
    async resizeToken(encounterId, tokenId, size, x, y, now) {
      await db.prepare(
        "UPDATE tokens SET size = ?, x = ?, y = ?, updated_at = ? WHERE id = ? AND encounter_id = ?",
      ).bind(size, x, y, now, tokenId, encounterId).run();
    },
    async updateToken(input) {
      await db.prepare(
        `UPDATE tokens SET name = ?, size = ?, speed = ?, hp = ?, max_hp = ?,
         is_hidden = ?, art_asset = ?, x = ?, y = ?, updated_at = ?
         WHERE id = ? AND encounter_id = ?`,
      ).bind(
        input.name,
        input.size,
        input.speed,
        input.hp,
        input.maxHp,
        input.hidden ? 1 : 0,
        input.artAsset,
        input.x,
        input.y,
        input.now,
        input.id,
        input.encounterId,
      ).run();
    },
    async hasConcentration(tokenId) {
      const row = await db.prepare(
        "SELECT count(*) AS count FROM effects WHERE token_id = ? AND effect_type = 'concentration'",
      ).bind(tokenId).first<{ count: number }>();
      return (row?.count ?? 0) > 0;
    },
    async updateHp(encounterId, tokenId, hp, now) {
      await db.prepare(
        "UPDATE tokens SET hp = ?, updated_at = ? WHERE id = ? AND encounter_id = ?",
      ).bind(hp, now, tokenId, encounterId).run();
    },
    async addEffect(input) {
      await db.prepare(
        `INSERT INTO effects
         (id, encounter_id, token_id, name, effect_type, duration_rounds,
          expires_round, reminder_timing, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.id,
        input.encounterId,
        input.tokenId,
        input.name,
        input.effectType,
        input.durationRounds,
        input.expiresRound,
        input.reminderTiming,
        input.participantId,
        input.now,
      ).run();
    },
    async findEffect(encounterId, effectId) {
      const row = await db.prepare(
        `SELECT e.id, e.token_id, e.name, e.effect_type, e.duration_rounds,
                e.expires_round, e.reminder_timing, e.created_by, e.created_at,
                t.id AS t_id, t.name AS t_name, t.x, t.y, t.art_asset, t.kind, t.size,
                t.speed, t.hp, t.max_hp, t.is_hidden, t.summoner_token_id,
                t.initiative, t.initiative_group_id, t.initiative_order,
                t.turn_complete, t.movement_used, t.movement_origin_x,
                t.movement_origin_y, t.owner_participant_id, t.owner_name
         FROM effects e JOIN tokens t ON t.id = e.token_id
         WHERE e.id = ? AND e.encounter_id = ?`,
      ).bind(effectId, encounterId).first<{
        id: string; token_id: string; name: string; effect_type: string;
        duration_rounds: number | null; expires_round: number | null;
        reminder_timing: string; created_by: string; created_at: number;
        t_id: string; t_name: string; x: number; y: number; art_asset: string | null;
        kind: string; size: TokenRow["size"]; speed: number; hp: number | null;
        max_hp: number | null; is_hidden: number; summoner_token_id: string | null;
        initiative: number | null; initiative_group_id: string | null;
        initiative_order: number | null; turn_complete: number; movement_used: number;
        movement_origin_x: number | null; movement_origin_y: number | null;
        owner_participant_id: string | null; owner_name: string | null;
      }>();
      if (!row) return null;
      return {
        id: row.id,
        token_id: row.token_id,
        name: row.name,
        effect_type: row.effect_type,
        duration_rounds: row.duration_rounds,
        expires_round: row.expires_round,
        reminder_timing: row.reminder_timing,
        created_by: row.created_by,
        created_at: row.created_at,
        token: {
          id: row.t_id, name: row.t_name, x: row.x, y: row.y, art_asset: row.art_asset,
          kind: row.kind, size: row.size, speed: row.speed, hp: row.hp, max_hp: row.max_hp,
          is_hidden: row.is_hidden, summoner_token_id: row.summoner_token_id,
          initiative: row.initiative, initiative_group_id: row.initiative_group_id,
          initiative_order: row.initiative_order, turn_complete: row.turn_complete,
          movement_used: row.movement_used, movement_origin_x: row.movement_origin_x,
          movement_origin_y: row.movement_origin_y,
          owner_participant_id: row.owner_participant_id, owner_name: row.owner_name,
        },
      };
    },
    async removeEffect(encounterId, effectId) {
      await db.prepare("DELETE FROM effects WHERE id = ? AND encounter_id = ?")
        .bind(effectId, encounterId).run();
    },
    async deleteToken(encounterId, tokenId) {
      await db.prepare("DELETE FROM tokens WHERE id = ? AND encounter_id = ?")
        .bind(tokenId, encounterId).run();
    },
  };
}
