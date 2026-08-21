import type {
  AnnotationFogRepository,
  DurableAnnotation,
} from "../ports/annotation-fog-repository.ts";
import { MAX_ANNOTATIONS_PER_ENCOUNTER } from "../../shared/resource-limits.ts";

export function createD1AnnotationFogRepository(db: D1Database): AnnotationFogRepository {
  return {
    async updateStrictMovement(encounterId, enabled, updatedAt) {
      await db.prepare(
        "UPDATE encounters SET strict_movement = ?, updated_at = ? WHERE id = ?",
      ).bind(enabled ? 1 : 0, updatedAt, encounterId).run();
    },

    async updateMapPackage(encounterId, serialized, updatedAt) {
      await db.prepare(
        "UPDATE encounters SET map_package_json = ?, updated_at = ? WHERE id = ?",
      ).bind(serialized, updatedAt, encounterId).run();
    },

    async insertAnnotation(encounterId, annotation) {
      const result = await db.prepare(
        `INSERT INTO annotations
         (id, encounter_id, annotation_type, x, y, x2, y2, color, label,
          created_by, expires_at, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT COUNT(*) FROM annotations WHERE encounter_id = ?) < ?`,
      ).bind(
        annotation.id,
        encounterId,
        annotation.annotationType,
        annotation.x,
        annotation.y,
        annotation.x2,
        annotation.y2,
        annotation.color,
        annotation.label,
        annotation.createdBy,
        annotation.expiresAt,
        annotation.createdAt,
        encounterId,
        MAX_ANNOTATIONS_PER_ENCOUNTER,
      ).run();
      return (result.meta.changes ?? 0) === 1;
    },

    async clearAnnotations(encounterId) {
      await db.prepare("DELETE FROM annotations WHERE encounter_id = ?").bind(encounterId).run();
    },

    async findAnnotation(encounterId, annotationId) {
      const row = await db.prepare(
        `SELECT id, annotation_type, x, y, x2, y2, color, label, created_by,
                expires_at, created_at
         FROM annotations WHERE id = ? AND encounter_id = ?`,
      ).bind(annotationId, encounterId).first<{
        id: string;
        annotation_type: DurableAnnotation["annotationType"];
        x: number;
        y: number;
        x2: number | null;
        y2: number | null;
        color: string;
        label: string | null;
        created_by: string;
        expires_at: number | null;
        created_at: number;
      }>();
      return row ? {
        id: row.id,
        annotationType: row.annotation_type,
        x: row.x,
        y: row.y,
        x2: row.x2,
        y2: row.y2,
        color: row.color,
        label: row.label,
        createdBy: row.created_by,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      } : null;
    },

    async removeAnnotation(encounterId, annotationId) {
      const result = await db.prepare(
        "DELETE FROM annotations WHERE id = ? AND encounter_id = ?",
      ).bind(annotationId, encounterId).run();
      return (result.meta.changes ?? 0) === 1;
    },
  };
}
