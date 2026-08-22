import { annotationGeometryIsBounded } from "../../shared/annotation-geometry.ts";
import type { HistoryReplayInput } from "../ports/history-repository.ts";

export async function replayAnnotationHistory(
  db: D1Database,
  input: HistoryReplayInput,
): Promise<number> {
  if (input.actionType !== "annotation_added" && input.actionType !== "annotation_removed") return 0;
  const undo = input.direction === "undo";
  const shouldInsert = (input.actionType === "annotation_added") === !undo;
  const annotationId = cleanId(input.payload.annotationId);
  const exists = Boolean(await db.prepare(
    "SELECT 1 AS found FROM annotations WHERE id = ? AND encounter_id = ?",
  ).bind(annotationId, input.encounterId).first());
  if (shouldInsert === exists) return 0;
  if (!shouldInsert) {
    await db.prepare("DELETE FROM annotations WHERE id = ? AND encounter_id = ?")
      .bind(annotationId, input.encounterId).run();
    return 1;
  }
  const annotation = (input.payload.annotation ?? input.payload) as Record<string, unknown>;
  const type = cleanText(annotation.annotationType, 24);
  const x = Number(annotation.x);
  const y = Number(annotation.y);
  const x2 = annotation.x2 === null || annotation.x2 === undefined ? null : Number(annotation.x2);
  const y2 = annotation.y2 === null || annotation.y2 === undefined ? null : Number(annotation.y2);
  if (!annotationGeometryIsBounded(
    { type, x, y, x2, y2 },
    input.gridWidth,
    input.gridHeight,
  )) return 0;
  await db.prepare(
    `INSERT INTO annotations
     (id, encounter_id, annotation_type, x, y, x2, y2, color, label,
      created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    cleanId(annotation.id ?? annotation.annotationId), input.encounterId, type,
    x, y, x2, y2, cleanText(annotation.color, 16) || "#f5c65c",
    cleanText(annotation.label, 48) || null,
    cleanId(annotation.createdBy) || input.participantId,
    annotation.expiresAt ?? null, Number(annotation.createdAt) || input.now,
  ).run();
  return 1;
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function cleanId(value: unknown) {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) : "";
}
