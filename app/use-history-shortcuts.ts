"use client";

import { useEffect, useEffectEvent, type Dispatch, type SetStateAction } from "react";
import type { EncounterSync } from "@/app/use-encounter-sync";

export function useHistoryShortcuts({ sync, busy, setNotice }: { sync: EncounterSync; busy: boolean; setNotice: Dispatch<SetStateAction<string>> }) {
  const run = async (direction: "undo" | "redo") => {
    setNotice(direction === "undo" ? "Last action undone." : "Last action redone.");
    if (!await sync.runHistory(direction)) setNotice("");
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
