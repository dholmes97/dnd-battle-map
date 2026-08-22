import type {
  ChatHandoutRepository,
  ChatMessageWrite,
  HandoutObjectStorage,
} from "../ports/chat-handout-repository.ts";
import { MAX_CHAT_MESSAGES_PER_ENCOUNTER } from "../../shared/resource-limits.ts";
import {
  queueStorageCleanupStatement,
  reconcileStorageLifecycle,
} from "./d1-storage-lifecycle.ts";

export function createD1ChatHandoutRepository(db: D1Database): ChatHandoutRepository {
  return {
    async handoutIsAvailable(encounterId, handoutId) {
      const row = await db.prepare(
        "SELECT id FROM handouts WHERE id = ? AND encounter_id = ? AND deleted_at IS NULL",
      ).bind(handoutId, encounterId).first<{ id: string }>();
      return Boolean(row);
    },

    async writeChatMessage(message: ChatMessageWrite) {
      const count = await db.prepare(
        "SELECT COUNT(*) AS value FROM chat_messages WHERE encounter_id = ?",
      ).bind(message.encounterId).first<{ value: number }>();
      if ((Number(count?.value) || 0) >= MAX_CHAT_MESSAGES_PER_ENCOUNTER) return false;
      const result = await db.prepare(
        `INSERT INTO chat_messages
         (id, encounter_id, sender_name, sender_role, recipient_name, body, handout_id, show_immediately, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT COUNT(*) FROM chat_messages WHERE encounter_id = ?) < ?`,
      ).bind(
        message.id,
        message.encounterId,
        message.senderName,
        message.senderRole,
        message.recipientName,
        message.body,
        message.handoutId,
        message.showImmediately ? 1 : 0,
        message.createdAt,
        message.encounterId,
        MAX_CHAT_MESSAGES_PER_ENCOUNTER,
      ).run();
      return (result.meta.changes ?? 0) === 1;
    },

    async findDeletableHandout(encounterId, handoutId) {
      const row = await db.prepare(
        `SELECT id, display_key, thumbnail_key
         FROM handouts WHERE id = ? AND encounter_id = ? AND deleted_at IS NULL`,
      ).bind(handoutId, encounterId).first<{
        id: string;
        display_key: string;
        thumbnail_key: string;
      }>();
      return row
        ? { id: row.id, displayKey: row.display_key, thumbnailKey: row.thumbnail_key }
        : null;
    },

    async countHandoutReferences(encounterId, handoutId) {
      const row = await db.prepare(
        "SELECT COUNT(*) AS value FROM chat_messages WHERE encounter_id = ? AND handout_id = ?",
      ).bind(encounterId, handoutId).first<{ value: number }>();
      return Number(row?.value) || 0;
    },

    async markHandoutDeleted(encounterId, handout, deletedAt) {
      await db.batch([
        db.prepare(
          `UPDATE handouts SET display_key = '', thumbnail_key = '', updated_at = ?, deleted_at = ?
           WHERE id = ? AND encounter_id = ? AND deleted_at IS NULL`,
        ).bind(deletedAt, deletedAt, handout.id, encounterId),
        queueStorageCleanupStatement(db, handout.displayKey, "handout-deleted", deletedAt),
        queueStorageCleanupStatement(db, handout.thumbnailKey, "handout-deleted", deletedAt),
      ]);
    },
  };
}

export function createR2HandoutObjectStorage(
  bucket: R2Bucket | undefined,
  db: D1Database,
): HandoutObjectStorage {
  return {
    available: Boolean(bucket),
    async reconcileCleanup() {
      await reconcileStorageLifecycle(db, bucket);
    },
  };
}
