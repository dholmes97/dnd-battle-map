"use client";

import { useEffect, useRef, useState } from "react";
import { battleMapApi as api } from "@/app/battle-map-api";
import type { CreatureTemplate } from "@/shared/creature-library";
import type { Role } from "@/shared/contracts";

type CreatureCatalogPage = {
  items: CreatureTemplate[];
  families: string[];
  nextCursor: string | null;
};

export function useCreatureCatalog({ open, role }: { open: boolean; role: Role | undefined }) {
  const [creatures, setCreatures] = useState<CreatureTemplate[]>([]);
  const [families, setFamilies] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open || !role) return;
    const requestId = ++requestRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      const params = new URLSearchParams({ limit: "24" });
      if (query.trim()) params.set("q", query.trim());
      if (family) params.set("family", family);
      void api<CreatureCatalogPage>(`/api/creatures?${params}`).then((catalog) => {
        if (requestRef.current !== requestId) return;
        setCreatures(catalog.items); setFamilies(catalog.families); setCursor(catalog.nextCursor);
      }).catch((caught) => {
        if (requestRef.current !== requestId) return;
        setCreatures([]); setCursor(null); setError(caught instanceof Error ? caught.message : "Unable to load creatures.");
      }).finally(() => { if (requestRef.current === requestId) setLoading(false); });
    }, 180);
    return () => { window.clearTimeout(timer); if (requestRef.current === requestId) requestRef.current += 1; };
  }, [family, open, query, role]);

  const loadMore = async () => {
    if (!cursor || loading) return;
    const requestId = ++requestRef.current;
    setLoading(true); setError("");
    const params = new URLSearchParams({ limit: "24", cursor });
    if (query.trim()) params.set("q", query.trim());
    if (family) params.set("family", family);
    try {
      const catalog = await api<CreatureCatalogPage>(`/api/creatures?${params}`);
      if (requestRef.current !== requestId) return;
      setCreatures((current) => { const known = new Set(current.map((creature) => creature.id)); return [...current, ...catalog.items.filter((creature) => !known.has(creature.id))]; });
      setFamilies(catalog.families); setCursor(catalog.nextCursor);
    } catch (caught) {
      if (requestRef.current === requestId) setError(caught instanceof Error ? caught.message : "Unable to load more creatures.");
    } finally { if (requestRef.current === requestId) setLoading(false); }
  };

  return { creatures, families, query, setQuery, family, setFamily, cursor, loading, error, loadMore };
}
