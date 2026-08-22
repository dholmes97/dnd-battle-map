import type { HistoryRepository } from "../ports/history-repository.ts";
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
  };
}
