import { MAX_ANNOTATIONS_PER_ENCOUNTER } from "./resource-limits.ts";

export type HistoryRow = { id: string; action_type: string; payload_json: string };

export function isReversibleHistoryRow(row: HistoryRow, reversibleActionTypes: ReadonlySet<string>): boolean {
  if (row.action_type === "action_undone" || row.action_type === "action_redone") return true;
  if (!reversibleActionTypes.has(row.action_type)) return false;
  if (row.action_type !== "annotation_added" && row.action_type !== "annotation_removed" &&
      row.action_type !== "annotations_cleared") return true;
  try {
    const payload = JSON.parse(row.payload_json);
    if (row.action_type === "annotations_cleared") {
      return Array.isArray(payload?.annotations) && payload.annotations.length > 0 &&
        payload.annotations.length <= MAX_ANNOTATIONS_PER_ENCOUNTER &&
        payload.annotations.every((annotation: { annotationType?: unknown }) =>
          annotation?.annotationType === "drawing"
        );
    }
    const annotation = payload?.annotation ?? payload;
    // Pings and both spotlight styles expire on their own. Only durable drawings belong in
    // undo history, including when reading action rows created by older builds.
    return annotation?.annotationType === "drawing";
  } catch {
    return false;
  }
}

export function deriveHistoryActionIds(chronologicalRows: HistoryRow[], reversibleActionTypes: ReadonlySet<string>): { undoIds: string[]; redoIds: string[] } {
  const knownIds = new Set<string>();
  const undoIds: string[] = [];
  const redoIds: string[] = [];
  for (const row of chronologicalRows) {
    if (reversibleActionTypes.has(row.action_type)) {
      knownIds.add(row.id);
      undoIds.push(row.id);
      redoIds.length = 0;
      continue;
    }
    if (row.action_type !== "action_undone" && row.action_type !== "action_redone") continue;
    try {
      const payload = JSON.parse(row.payload_json);
      if (!payload.actionId || !knownIds.has(payload.actionId)) continue;
      if (row.action_type === "action_undone") {
        const index = undoIds.lastIndexOf(payload.actionId);
        if (index >= 0) undoIds.splice(index, 1);
        redoIds.push(payload.actionId);
      } else {
        const index = redoIds.lastIndexOf(payload.actionId);
        if (index >= 0) redoIds.splice(index, 1);
        undoIds.push(payload.actionId);
      }
    } catch {
      // Malformed audit rows remain recorded but cannot affect active history.
    }
  }
  return { undoIds: [...undoIds].reverse(), redoIds: [...redoIds].reverse() };
}
