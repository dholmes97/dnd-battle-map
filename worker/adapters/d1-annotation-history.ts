import { annotationGeometryIsBounded } from "../../shared/annotation-geometry.ts";
import { MAX_ANNOTATIONS_PER_ENCOUNTER } from "../../shared/resource-limits.ts";
import type { DurableAnnotation } from "../ports/annotation-fog-repository.ts";
import type { HistoryReplayInput } from "../ports/history-repository.ts";

export async function replayAnnotationHistory(
  db: D1Database,
  input: HistoryReplayInput,
): Promise<number> {
  if (input.actionType === "annotations_cleared") {
    return replayClearedAnnotations(db, input);
  }
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

async function replayClearedAnnotations(db: D1Database, input: HistoryReplayInput): Promise<number> {
  const raw = input.payload.annotations;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ANNOTATIONS_PER_ENCOUNTER) return 0;
  const annotations = raw.map((value) => parseDurableDrawing(value, input));
  if (annotations.some((annotation) => annotation === null)) return 0;
  const drawings = annotations as DurableAnnotation[];
  const ids = drawings.map((annotation) => annotation.id);
  if (new Set(ids).size !== ids.length) return 0;

  const existing = await db.prepare(
    `SELECT id, annotation_type FROM annotations
     WHERE encounter_id = ? AND id IN (SELECT value FROM json_each(?))`,
  ).bind(input.encounterId, JSON.stringify(ids)).all<{ id: string; annotation_type: string }>();
  if (input.direction === "undo") {
    if (existing.results.length !== 0) return 0;
    await db.prepare(
      `INSERT INTO annotations
       (id, encounter_id, annotation_type, x, y, x2, y2, color, label,
        created_by, expires_at, created_at)
       SELECT json_extract(value, '$.id'), ?, 'drawing',
              json_extract(value, '$.x'), json_extract(value, '$.y'),
              json_extract(value, '$.x2'), json_extract(value, '$.y2'),
              json_extract(value, '$.color'), json_extract(value, '$.label'),
              json_extract(value, '$.createdBy'), NULL, json_extract(value, '$.createdAt')
       FROM json_each(?)`,
    ).bind(input.encounterId, JSON.stringify(drawings)).run();
    return drawings.length;
  }

  if (existing.results.length !== drawings.length ||
      existing.results.some((row) => row.annotation_type !== "drawing")) return 0;
  await db.prepare(
    `DELETE FROM annotations
     WHERE encounter_id = ? AND annotation_type = 'drawing'
       AND id IN (SELECT value FROM json_each(?))`,
  ).bind(input.encounterId, JSON.stringify(ids)).run();
  return drawings.length;
}

function parseDurableDrawing(value: unknown, input: HistoryReplayInput): DurableAnnotation | null {
  if (!value || typeof value !== "object") return null;
  const annotation = value as Record<string, unknown>;
  const id = strictId(annotation.id);
  const createdBy = strictId(annotation.createdBy);
  const x = annotation.x;
  const y = annotation.y;
  const x2 = annotation.x2;
  const y2 = annotation.y2;
  if (!id || !createdBy || annotation.annotationType !== "drawing" ||
      !annotationGeometryIsBounded(
        { type: "drawing", x, y, x2, y2 },
        input.gridWidth,
        input.gridHeight,
      )) return null;
  if (typeof annotation.color !== "string" || annotation.color.length > 16) return null;
  if (annotation.label !== null && annotation.label !== undefined &&
      (typeof annotation.label !== "string" || annotation.label.length > 48)) return null;
  if (annotation.expiresAt !== null && annotation.expiresAt !== undefined) return null;
  const createdAt = Number(annotation.createdAt);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) return null;
  return {
    id,
    annotationType: "drawing",
    x: x as number,
    y: y as number,
    x2: x2 as number,
    y2: y2 as number,
    color: annotation.color,
    label: typeof annotation.label === "string" ? annotation.label : null,
    createdBy,
    expiresAt: null,
    createdAt,
  };
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function cleanId(value: unknown) {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) : "";
}

function strictId(value: unknown) {
  const cleaned = cleanId(value);
  return cleaned && cleaned === value ? cleaned : "";
}
