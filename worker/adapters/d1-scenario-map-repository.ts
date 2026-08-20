import type { ScenarioMapRepository } from "../ports/scenario-map-repository.ts";
import type { TokenRow } from "../types.ts";

const TOKEN_COLUMNS = `id, name, x, y, art_asset, kind, size, speed, fly_speed, swim_speed,
  climb_speed, burrow_speed, armor_class, hp, max_hp, is_hidden,
  summoner_token_id, initiative, initiative_group_id, initiative_order, turn_complete,
  movement_used, altitude, movement_origin_x, movement_origin_y, owner_participant_id, owner_name`;

export function createD1ScenarioMapRepository(db: D1Database): ScenarioMapRepository {
  return {
    async renameScenario(encounterId, name, now) {
      await db.prepare(
        "UPDATE encounters SET name = ?, version = version + 1, updated_at = ? WHERE id = ?",
      ).bind(name, now, encounterId).run();
    },
    async scenarioCodeExists(code) {
      return Boolean(await db.prepare(
        "SELECT 1 AS found FROM encounters WHERE code = ? LIMIT 1",
      ).bind(code).first());
    },
    async listScenarioTokens(encounterId) {
      const rows = await db.prepare(
        `SELECT ${TOKEN_COLUMNS} FROM tokens WHERE encounter_id = ? ORDER BY id`,
      ).bind(encounterId).all<TokenRow>();
      return rows.results;
    },
    async createScenario(input) {
      await db.batch([
        db.prepare(
          `INSERT INTO encounters
           (id, code, name, version, status, map_asset, map_package_json, active_map_preset_id,
            grid_width, grid_height, current_round, active_initiative_order, strict_movement, updated_at)
           VALUES (?, ?, ?, 1, 'setup', ?, ?, NULL, ?, ?, 0, NULL, ?, ?)`,
        ).bind(
          input.id,
          input.code,
          input.name,
          input.mapAsset,
          input.mapPackageJson,
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
    async saveMapPreset(input, update) {
      if (update) {
        const result = await db.prepare(
          `UPDATE map_presets SET name = ?, description = ?, source_prompt = ?,
           package_json = ?, updated_at = ? WHERE id = ? AND encounter_id = ?`,
        ).bind(
          input.name,
          input.description,
          input.sourcePrompt,
          input.packageJson,
          input.now,
          input.id,
          input.encounterId,
        ).run();
        return (result.meta.changes ?? 0) === 1;
      }
      await db.prepare(
        `INSERT INTO map_presets
         (id, encounter_id, name, description, source_prompt, package_json,
          created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.id,
        input.encounterId,
        input.name,
        input.description,
        input.sourcePrompt,
        input.packageJson,
        input.participantId,
        input.now,
        input.now,
      ).run();
      return true;
    },
    async deleteMapPreset(encounterId, presetId) {
      const result = await db.prepare(
        "DELETE FROM map_presets WHERE id = ? AND encounter_id = ?",
      ).bind(presetId, encounterId).run();
      return (result.meta.changes ?? 0) === 1;
    },
    async clearActivePreset(encounterId) {
      await db.prepare(
        "UPDATE encounters SET active_map_preset_id = NULL WHERE id = ?",
      ).bind(encounterId).run();
    },
    async loadMapPreset(encounterId, presetId) {
      const row = await db.prepare(
        "SELECT package_json FROM map_presets WHERE id = ? AND encounter_id = ?",
      ).bind(presetId, encounterId).first<{ package_json: string }>();
      return row?.package_json ?? null;
    },
    async listTokenPositions(encounterId) {
      const rows = await db.prepare(
        "SELECT id, x, y, size FROM tokens WHERE encounter_id = ?",
      ).bind(encounterId).all<{
        id: string;
        x: number;
        y: number;
        size: TokenRow["size"];
      }>();
      return rows.results;
    },
    async applyMapPackage(input) {
      await db.batch([
        db.prepare(
          `UPDATE encounters SET map_package_json = ?, active_map_preset_id = ?,
           grid_width = ?, grid_height = ?, updated_at = ? WHERE id = ?`,
        ).bind(
          input.packageJson,
          input.activePresetId,
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
