"use client";

import { useEffect, useRef, useState } from "react";
import { parseBeyond20Preview, type Beyond20Preview } from "@/shared/beyond20";

export function useBeyond20Bridge(onPreview?: (event: Beyond20Preview) => void) {
  const onPreviewRef = useRef(onPreview);
  useEffect(() => { onPreviewRef.current = onPreview; }, [onPreview]);
  const [enabled, setEnabled] = useState(false);
  const [detected, setDetected] = useState(false);
  const [events, setEvents] = useState<Beyond20Preview[]>([]);
  const [rejected, setRejected] = useState(0);
  useEffect(() => {
    const loaded = () => setDetected(true);
    const receive = (event: Event) => {
      // DOM events are user input, not proof of extension identity or ownership.
      // Receipt also detects the bridge when its one-time Loaded event was missed.
      setDetected(true);
      if (!enabled && !onPreviewRef.current) return;
      try {
        const preview = parseBeyond20Preview(event.type, (event as CustomEvent<unknown>).detail);
        if (!preview) { setRejected((count) => Math.min(999, count + 1)); return; }
        onPreviewRef.current?.(preview);
        if (enabled) setEvents((current) => [preview, ...current].slice(0, 20));
      } catch { setRejected((count) => Math.min(999, count + 1)); }
    };
    document.addEventListener("Beyond20_Loaded", loaded);
    document.addEventListener("Beyond20_UpdateHP", receive);
    document.addEventListener("Beyond20_RenderedRoll", receive);
    return () => {
      document.removeEventListener("Beyond20_Loaded", loaded);
      document.removeEventListener("Beyond20_UpdateHP", receive);
      document.removeEventListener("Beyond20_RenderedRoll", receive);
    };
  }, [enabled]);
  return { enabled, setEnabled, detected, events, rejected, clear: () => { setEvents([]); setRejected(0); } };
}
