import type { InitiativeCombatRepository } from "../ports/initiative-combat-repository.ts";
import type { TokenRow } from "../types.ts";

const TOKEN_COLUMNS = `id, name, x, y, art_asset, kind, size, speed, armor_class, hp, max_hp, is_hidden,
  summoner_token_id, initiative, initiative_group_id, initiative_order, turn_complete,
  movement_used, movement_origin_x, movement_origin_y, owner_participant_id, owner_name`;

export function createD1InitiativeCombatRepository(db: D1Database): InitiativeCombatRepository {
  return {
    async findToken(encounterId, tokenId) {
      return await db.prepare(
        `SELECT ${TOKEN_COLUMNS} FROM tokens WHERE id = ? AND encounter_id = ?`,
      ).bind(tokenId, encounterId).first<TokenRow>() ?? null;
    },
    async activeLeaderIds(encounterId, activeOrder) {
      if (activeOrder === null) return [];
      const rows = await db.prepare(
        `SELECT DISTINCT CASE WHEN summoner_token_id IS NULL THEN id ELSE summoner_token_id END AS id
         FROM tokens WHERE encounter_id = ? AND initiative_order = ?`,
      ).bind(encounterId, activeOrder).all<{ id: string }>();
      return rows.results.map((row) => row.id);
    },
    async listInitiativeTokens(encounterId) {
      const rows = await db.prepare(
        `SELECT id, name, initiative, initiative_group_id, summoner_token_id
         FROM tokens WHERE encounter_id = ? ORDER BY name, id`,
      ).bind(encounterId).all<{
        id: string;
        name: string;
        initiative: number | null;
        initiative_group_id: string | null;
        summoner_token_id: string | null;
      }>();
      return rows.results;
    },
    async setInitiative(encounterId, tokenId, initiative, now) {
      await db.prepare(
        `UPDATE tokens SET initiative = ?, initiative_group_id = NULL, initiative_order = NULL,
         turn_complete = 0, movement_used = 0, movement_origin_x = NULL,
         movement_origin_y = NULL, updated_at = ? WHERE id = ? AND encounter_id = ?`,
      ).bind(initiative, now, tokenId, encounterId).run();
    },
    async setInitiativeGroup(encounterId, tokenIds, initiative, groupId, now) {
      await db.batch(tokenIds.map((tokenId) => db.prepare(
        `UPDATE tokens SET initiative = ?, initiative_group_id = ?, initiative_order = NULL,
         turn_complete = 0, movement_used = 0, movement_origin_x = NULL,
         movement_origin_y = NULL, updated_at = ? WHERE id = ? AND encounter_id = ?`,
      ).bind(initiative, groupId, now, tokenId, encounterId)));
    },
    async rebuildOrders(encounterId, groups, activeOrder, now) {
      await db.batch([
        db.prepare(
          "UPDATE tokens SET initiative_order = NULL, updated_at = ? WHERE encounter_id = ?",
        ).bind(now, encounterId),
        ...groups.flatMap((members, order) => members.map((leaderId) => db.prepare(
          `UPDATE tokens SET initiative_order = ?, updated_at = ?
           WHERE encounter_id = ? AND (id = ? OR summoner_token_id = ?)`,
        ).bind(order, now, encounterId, leaderId, leaderId))),
        db.prepare(
          "UPDATE encounters SET active_initiative_order = ?, updated_at = ? WHERE id = ?",
        ).bind(groups.length ? activeOrder : null, now, encounterId),
      ]);
    },
    async startCombat(encounterId, groups, now) {
      await db.batch([
        db.prepare(
          `UPDATE tokens SET initiative_order = NULL, turn_complete = 0, movement_used = 0,
           movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ? WHERE encounter_id = ?`,
        ).bind(now, encounterId),
        ...groups.flatMap((members, order) => members.map((leaderId) => db.prepare(
          `UPDATE tokens SET initiative_order = ?, turn_complete = 0, movement_used = 0,
           movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ?
           WHERE encounter_id = ? AND (id = ? OR summoner_token_id = ?)`,
        ).bind(order, now, encounterId, leaderId, leaderId))),
        db.prepare(
          `UPDATE encounters SET status = 'active', current_round = 1,
           active_initiative_order = 0, updated_at = ? WHERE id = ?`,
        ).bind(now, encounterId),
      ]);
    },
    async completeOrder(encounterId, order, now) {
      await db.prepare(
        "UPDATE tokens SET turn_complete = 1, updated_at = ? WHERE encounter_id = ? AND initiative_order = ?",
      ).bind(now, encounterId, order).run();
    },
    async listOrders(encounterId) {
      const rows = await db.prepare(
        `SELECT DISTINCT initiative_order FROM tokens
         WHERE encounter_id = ? AND initiative_order IS NOT NULL ORDER BY initiative_order`,
      ).bind(encounterId).all<{ initiative_order: number }>();
      return rows.results.map((row) => row.initiative_order);
    },
    async exitCombat(encounterId, now) {
      await db.prepare(
        `UPDATE encounters SET status = 'setup', current_round = 0,
         active_initiative_order = NULL, updated_at = ? WHERE id = ?`,
      ).bind(now, encounterId).run();
    },
    async enterTurn(encounterId, round, order, now) {
      await db.batch([
        db.prepare(
          `UPDATE tokens SET turn_complete = 0, movement_used = 0,
           movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ?
           WHERE encounter_id = ? AND initiative_order = ?`,
        ).bind(now, encounterId, order),
        db.prepare(
          `UPDATE encounters SET current_round = ?, active_initiative_order = ?,
           updated_at = ? WHERE id = ?`,
        ).bind(round, order, now, encounterId),
      ]);
    },
    async orderExists(encounterId, order) {
      return Boolean(await db.prepare(
        "SELECT 1 AS found FROM tokens WHERE encounter_id = ? AND initiative_order = ? LIMIT 1",
      ).bind(encounterId, order).first());
    },
    async correctTurn(encounterId, round, order, now) {
      await db.batch([
        db.prepare(
          `UPDATE encounters SET status = 'active', current_round = ?,
           active_initiative_order = ?, updated_at = ? WHERE id = ?`,
        ).bind(round, order, now, encounterId),
        db.prepare(
          `UPDATE tokens SET turn_complete = 0, movement_used = 0,
           movement_origin_x = NULL, movement_origin_y = NULL, updated_at = ?
           WHERE encounter_id = ? AND initiative_order = ?`,
        ).bind(now, encounterId, order),
      ]);
    },
  };
}
