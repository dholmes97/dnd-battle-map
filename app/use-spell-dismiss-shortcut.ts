"use client";

import { useEffect, useEffectEvent } from "react";
import type { SharedToken } from "@/shared/contracts";
import { SPELL_EFFECT_KIND } from "@/shared/spell-effects";

export function useSpellDismissShortcut({ enabled, selectedToken, onDismiss }: {
  enabled: boolean;
  selectedToken: SharedToken | null;
  onDismiss: (token: SharedToken) => void;
}) {
  const dismiss = useEffectEvent((token: SharedToken) => onDismiss(token));

  useEffect(() => {
    if (!enabled || selectedToken?.kind !== SPELL_EFFECT_KIND || !selectedToken.controlledByViewer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement &&
          (target.isContentEditable || target.closest("input, textarea, select"))) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      event.preventDefault();
      dismiss(selectedToken);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, selectedToken]);
}
