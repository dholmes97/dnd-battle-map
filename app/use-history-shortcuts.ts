"use client";

import { useEffect, useEffectEvent, type Dispatch, type SetStateAction } from "react";
import type { useEncounterSync } from "@/app/use-encounter-sync";

type EncounterSync = ReturnType<typeof useEncounterSync>;

export function useHistoryShortcuts({ sync, busy, setNotice }: { sync: EncounterSync; busy: boolean; setNotice: Dispatch<SetStateAction<string>> }) {
  const { localUndoHistoryRef, localRedoHistoryRef, optimisticSequenceRef, runCommand, runOptimisticCommand } = sync;
  const run = async (direction: "undo" | "redo") => {
    setNotice(direction === "undo" ? "Last action undone." : "Last action redone.");
    const state = sync.state;
    const entry = (direction === "undo" ? localUndoHistoryRef.current : localRedoHistoryRef.current).at(-1);
    if (!entry || !state) { const confirmed = await runCommand(direction); if (!confirmed) setNotice(""); return; }
    if (direction === "undo") localUndoHistoryRef.current = localUndoHistoryRef.current.slice(0, -1); else localRedoHistoryRef.current = localRedoHistoryRef.current.slice(0, -1);
    const inverseEntry = { mutationId: ++optimisticSequenceRef.current, state };
    if (direction === "undo") localRedoHistoryRef.current = [...localRedoHistoryRef.current.slice(-9), inverseEntry]; else localUndoHistoryRef.current = [...localUndoHistoryRef.current.slice(-9), inverseEntry];
    const result = await runOptimisticCommand(direction, {}, () => ({ ...entry.state, undo: { ...entry.state.undo, available: direction === "undo" ? Math.max(0, state.undo.available - 1) : Math.min(10, state.undo.available + 1), redoAvailable: direction === "undo" ? Math.min(10, state.undo.redoAvailable + 1) : Math.max(0, state.undo.redoAvailable - 1) } }), undefined, undefined, false);
    if (!result) {
      setNotice("");
      if (direction === "undo") { localRedoHistoryRef.current = localRedoHistoryRef.current.filter((item) => item.mutationId !== inverseEntry.mutationId); localUndoHistoryRef.current = [...localUndoHistoryRef.current, entry]; }
      else { localUndoHistoryRef.current = localUndoHistoryRef.current.filter((item) => item.mutationId !== inverseEntry.mutationId); localRedoHistoryRef.current = [...localRedoHistoryRef.current, entry]; }
    }
  };
  const runFromShortcut = useEffectEvent((direction: "undo" | "redo") => { void run(direction); });
  useEffect(() => {
    if (!sync.participant || !sync.state) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select")) return;
      const key = event.key.toLocaleLowerCase(); const modifier = event.metaKey || event.ctrlKey;
      const wantsUndo = modifier && key === "z" && !event.shiftKey;
      const wantsRedo = (modifier && key === "z" && event.shiftKey) || (event.ctrlKey && !event.metaKey && key === "y");
      if (busy || (!wantsUndo && !wantsRedo)) return;
      if (wantsUndo && sync.state!.undo.available > 0) { event.preventDefault(); runFromShortcut("undo"); }
      else if (wantsRedo && sync.state!.undo.redoAvailable > 0) { event.preventDefault(); runFromShortcut("redo"); }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, sync.participant, sync.state]);
  return { run };
}
