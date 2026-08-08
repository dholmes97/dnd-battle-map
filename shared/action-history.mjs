export function deriveHistoryActionIds(chronologicalRows, reversibleActionTypes) {
  const knownIds = new Set();
  const undoIds = [];
  const redoIds = [];
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
