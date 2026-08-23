import type { ScenarioMapRepository } from "../ports/scenario-map-repository.ts";
import type { TokenRow } from "../types.ts";
import {
  MAX_TOKENS_PER_ENCOUNTER,
} from "../../shared/resource-limits.ts";
import { mapImageFromRow } from "../map-images.ts";
import type { MapImageRow } from "../types.ts";

const TOKEN_COLUMNS = `id, name, x, y, art_asset, kind, size, speed, fly_speed, swim_speed,
  climb_speed, burrow_speed, armor_class, hp, max_hp, is_hidden,
  summoner_token_id, initiative, initiative_group_id, initiative_order, turn_complete,
  movement_used, altitude, movement_origin_x, movement_origin_y, owner_participant_id, owner_name`;

export function createD1ScenarioMapRepository(db: D1Database): ScenarioMapRepository {
  return {
    async renameScenario(encounterId, name, now) {
      await db.prepare(
        "UPDATE encounters SET name = ?, updated_at = ? WHERE id = ?",
      ).bind(name, now, encounterId).run();
    },
    async countScenarios() {
      const row = await db.prepare("SELECT COUNT(*) AS value FROM encounters").first<{ value: number }>();
      return Number(row?.value) || 0;
    },
    async scenarioCodeExists(code) {
      return Boolean(await db.prepare(
        "SELECT 1 AS found FROM encounters WHERE code = ? LIMIT 1",
      ).bind(code).first());
    },
    async listScenarioTokens(encounterId) {
      const rows = await db.prepare(
        `SELECT ${TOKEN_COLUMNS} FROM tokens WHERE encounter_id = ? ORDER BY id LIMIT ?`,
      ).bind(encounterId, MAX_TOKENS_PER_ENCOUNTER).all<TokenRow>();
      return rows.results;
    },
    async createScenario(input) {
      await db.batch([
        db.prepare(
          `INSERT INTO encounters
           (id, code, name, version, status, map_asset, map_package_json, active_map_preset_id,
            active_map_image_id, active_map_setup_json, draft_map_image_id, draft_map_setup_json,
            draft_updated_at, grid_width, grid_height, current_round, active_initiative_order,
            strict_movement, updated_at)
           VALUES (?, ?, ?, 1, 'setup', '', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
        ).bind(
          input.id,
          input.code,
          input.name,
          input.activeMapImageId,
          input.activeMapSetupJson,
          input.draftMapImageId,
          input.draftMapSetupJson,
          input.draftMapSetupJson ? input.now : null,
          input.width,
          input.height,
          input.strictMovement ? 1 : 0,
          input.now,
        ),
        ...input.tokens.map((token) => db.prepare(
          `INSERT INTO tokens
           (id, encounter_id, name, x, y, art_asset, kind, size, speed, fly_speed, swim_speed,
            climb_speed, burrow_speed, armor_class, hp, max_hp,
            is_hidden, summoner_token_id, initiative, initiative_group_id, initiative_order,
            turn_complete, movement_used, altitude, movement_origin_x, movement_origin_y,
            owner_participant_id, owner_name, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, 0, ?, NULL, NULL, NULL, NULL, ?)`,
        ).bind(
          token.copiedId,
          input.id,
          token.name,
          token.x,
          token.y,
          token.art_asset,
          token.kind,
          token.size,
          token.speed,
          token.fly_speed,
          token.swim_speed,
          token.climb_speed,
          token.burrow_speed,
          token.armor_class,
          token.copiedHp,
          token.max_hp,
          token.copiedHidden ? 1 : 0,
          token.copiedSummonerId,
          token.copiedAltitude,
          input.now,
        )),
        db.prepare(
          `INSERT INTO participants
           (id, encounter_id, name, role, session_secret, joined_at, last_seen_at)
           VALUES (?, ?, 'Kevin', 'dm', ?, ?, ?)`,
        ).bind(input.participantId, input.id, input.sessionSecret, input.now, input.now),
      ]);
    },
    async findMapImage(mapImageId) {
      const row = await db.prepare(
        `SELECT id, name, description, biome, mood, asset_path, grid_width, grid_height,
                pixel_width, pixel_height, source_kind, source_prompt, is_active,
                created_at, updated_at
         FROM map_images WHERE id = ? AND is_active = 1`,
      ).bind(mapImageId).first<MapImageRow>();
      return row ? mapImageFromRow(row) : null;
    },
    async saveMapDraft(encounterId, mapImageId, setupJson, now) {
      await db.prepare(
        `UPDATE encounters SET draft_map_image_id = ?, draft_map_setup_json = ?,
         draft_updated_at = ? WHERE id = ?`,
      ).bind(mapImageId, setupJson, now, encounterId).run();
    },
    async discardMapDraft(encounterId, now) {
      await db.prepare(
        `UPDATE encounters SET draft_map_image_id = active_map_image_id,
         draft_map_setup_json = active_map_setup_json, draft_updated_at = ? WHERE id = ?`,
      ).bind(now, encounterId).run();
    },
    async listTokenPositions(encounterId) {
      const rows = await db.prepare(
        "SELECT id, x, y, size FROM tokens WHERE encounter_id = ? LIMIT ?",
      ).bind(encounterId, MAX_TOKENS_PER_ENCOUNTER).all<{
        id: string;
        x: number;
        y: number;
        size: TokenRow["size"];
      }>();
      return rows.results;
    },
    async applyMapDraft(input) {
      await db.batch([
        db.prepare(
          `UPDATE encounters SET active_map_image_id = ?, active_map_setup_json = ?,
           draft_map_image_id = ?, draft_map_setup_json = ?, draft_updated_at = ?,
           grid_width = ?, grid_height = ?, updated_at = ? WHERE id = ?`,
        ).bind(
          input.mapImageId,
          input.setupJson,
          input.mapImageId,
          input.setupJson,
          input.now,
          input.width,
          input.height,
          input.now,
          input.encounterId,
        ),
        ...input.tokenPositions.map((token) => db.prepare(
          "UPDATE tokens SET x = ?, y = ?, updated_at = ? WHERE id = ? AND encounter_id = ?",
        ).bind(token.x, token.y, input.now, token.id, input.encounterId)),
      ]);
    },
    async configureEncounter(encounterId, status, now) {
      if (status === "setup") {
        await db.batch([
          db.prepare(
            `UPDATE encounters SET status = 'setup', current_round = 0,
             active_initiative_order = NULL, updated_at = ? WHERE id = ?`,
          ).bind(now, encounterId),
          db.prepare(
            `UPDATE tokens SET initiative_order = NULL, turn_complete = 0,
             movement_used = 0, movement_origin_x = NULL, movement_origin_y = NULL,
             updated_at = ? WHERE encounter_id = ?`,
          ).bind(now, encounterId),
        ]);
      } else {
        await db.prepare(
          "UPDATE encounters SET status = ?, updated_at = ? WHERE id = ?",
        ).bind(status, now, encounterId).run();
      }
    },
  };
}
