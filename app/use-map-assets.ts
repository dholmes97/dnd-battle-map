"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { drawMap, type BattleMapViewport, type PlacementPreview, type SpellPlacementPreview, type TokenPreview } from "@/app/battle-map-renderer";
import type { EncounterState, ParticipantSession } from "@/shared/contracts";
import { mapSceneContentKey } from "@/shared/battle-map-policies";
import { battleMapAnimationIsActive } from "@/shared/battle-map-animation";
import { isSpellShapeArt } from "@/shared/spell-effects";

type RenderedMapScene = { mapId: string; image: HTMLImageElement };

function release(scene: RenderedMapScene | null): void {
  if (!scene) return;
  scene.image.src = "";
}

export function useMapAssets({ active, state, participant, preview, placementPreview, spellPlacementPreview, dragOrigin, viewport, selectedTokenId, selectedMapNoteId, gridOpacity, showColoredTokenCenters, showHealthRings, sharedFogPreview, selectedSharedFogVertex, keyboardCursor, pingStartedAtRef, canvasRef }: {
  active: boolean;
  state: EncounterState | null;
  participant: ParticipantSession | null;
  preview: TokenPreview | null;
  placementPreview: PlacementPreview | null;
  spellPlacementPreview: SpellPlacementPreview | null;
  dragOrigin: { x: number; y: number } | null;
  viewport: BattleMapViewport;
  selectedTokenId: string | null;
  selectedMapNoteId: string | null;
  gridOpacity: number;
  showColoredTokenCenters: boolean;
  showHealthRings: boolean;
  sharedFogPreview: { x: number; y: number }[] | null;
  selectedSharedFogVertex: number | null;
  keyboardCursor: { x: number; y: number } | null;
  pingStartedAtRef: RefObject<Map<string, number>>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const [renderedMapScene, setRenderedMapScene] = useState<RenderedMapScene | null>(null);
  const [tokenArt, setTokenArt] = useState<Map<string, HTMLImageElement>>(new Map());
  const tokenArtRef = useRef(tokenArt);
  const loadingTokenArtRef = useRef(new Map<string, Promise<HTMLImageElement | null>>());
  const wantedTokenArtAssetsRef = useRef(new Set<string>());
  const mapSceneKey = mapSceneContentKey(state?.encounter.mapPackage ?? null);
  const placementArtCandidate = placementPreview?.creature.artAsset ?? spellPlacementPreview?.spell.artAsset ?? null;
  const placementArtAsset = isSpellShapeArt(placementArtCandidate) ? null : placementArtCandidate;
  const tokenArtAssets = useMemo(() => [...new Set([
    ...(state?.tokens.flatMap((token) => token.artAsset && !isSpellShapeArt(token.artAsset) ? [token.artAsset] : []) ?? []),
    ...(placementArtAsset ? [placementArtAsset] : []),
  ])].sort(), [placementArtAsset, state?.tokens]);
  const tokenArtAssetKey = tokenArtAssets.join("\u0000");

  useEffect(() => { tokenArtRef.current = tokenArt; }, [tokenArt]);

  useEffect(() => {
    const mapPackage = state?.encounter.mapPackage;
    if (!mapPackage) { const timer = window.setTimeout(() => setRenderedMapScene((current) => { release(current); return null; }), 0); return () => window.clearTimeout(timer); }
    let disposed = false;
    let loadedImage: HTMLImageElement | null = null;
    void new Promise<[string, HTMLImageElement] | null>((resolve) => { const image = new Image(); image.onload = () => resolve([mapPackage.visual.assetUrl, image]); image.onerror = () => resolve(null); image.src = mapPackage.visual.assetUrl; }).then((entry) => {
      if (disposed) { if (entry) entry[1].src = ""; return; }
      if (!entry) { setRenderedMapScene((current) => { release(current); return null; }); return; }
      loadedImage = entry[1];
      setRenderedMapScene((current) => { release(current); return { mapId: mapPackage.id, image: entry[1] }; });
    });
    return () => { disposed = true; if (loadedImage) loadedImage.src = ""; };
    // mapSceneKey is the stable content fingerprint. Encounter response object
    // identity must not reload the unchanged full-resolution scene asset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapSceneKey]);

  useEffect(() => {
    const wantedAssets = new Set(tokenArtAssets);
    wantedTokenArtAssetsRef.current = wantedAssets;
    let disposed = false;
    const removalTimer = window.setTimeout(() => {
      setTokenArt((current) => {
        const next = new Map(current);
        let changed = false;
        for (const [path, image] of current) {
          if (wantedAssets.has(path)) continue;
          image.src = "";
          next.delete(path);
          changed = true;
        }
        return changed ? next : current;
      });
    }, 0);
    const pendingEntries = tokenArtAssets.filter((path) => !tokenArt.has(path)).map((path) => {
      let pending = loadingTokenArtRef.current.get(path);
      if (!pending) {
        pending = new Promise<HTMLImageElement | null>((resolve) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => resolve(null);
          image.src = path;
        });
        loadingTokenArtRef.current.set(path, pending);
        void pending.then((image) => {
          loadingTokenArtRef.current.delete(path);
          if (image && !wantedTokenArtAssetsRef.current.has(path)) image.src = "";
        });
      }
      return pending.then((image) => [path, image] as const);
    });
    if (pendingEntries.length) void Promise.all(pendingEntries).then((entries) => {
      if (disposed) return;
      setTokenArt((current) => {
        const next = new Map(current);
        let changed = false;
        for (const [path, image] of entries) {
          if (!image || !wantedAssets.has(path) || next.has(path)) continue;
          next.set(path, image);
          changed = true;
        }
        return changed ? next : current;
      });
    });
    return () => { disposed = true; window.clearTimeout(removalTimer); };
    // tokenArtAssetKey is a stable content fingerprint. Replacing the token
    // array with equivalent authoritative state must not recreate its images.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenArtAssetKey]);

  useEffect(() => () => {
    wantedTokenArtAssetsRef.current.clear();
    for (const image of tokenArtRef.current.values()) image.src = "";
    loadingTokenArtRef.current.clear();
  }, []);

  const redraw = useCallback((animationNow = Date.now()) => {
    const scene = state?.encounter.mapPackage && renderedMapScene?.mapId === state.encounter.mapPackage.id ? renderedMapScene.image : null;
    if (canvasRef.current && state && participant) drawMap(canvasRef.current, state, preview, placementPreview, spellPlacementPreview, dragOrigin, participant, scene, tokenArt, viewport, pingStartedAtRef.current, animationNow, selectedTokenId, selectedMapNoteId, gridOpacity, showColoredTokenCenters, showHealthRings, sharedFogPreview, selectedSharedFogVertex, keyboardCursor);
  }, [canvasRef, dragOrigin, gridOpacity, keyboardCursor, participant, pingStartedAtRef, placementPreview, preview, renderedMapScene, selectedMapNoteId, selectedSharedFogVertex, selectedTokenId, sharedFogPreview, showColoredTokenCenters, showHealthRings, spellPlacementPreview, state, tokenArt, viewport]);

  useEffect(() => {
    if (!active) return;
    redraw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => redraw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [active, canvasRef, redraw]);
  useEffect(() => {
    const animationIsActive = (now: number) => Boolean(state && battleMapAnimationIsActive({
      annotations: state.annotations,
      tokens: state.tokens,
      pingStartedAt: pingStartedAtRef.current,
      spellPlacementArt: spellPlacementPreview?.spell.artAsset ?? null,
      now,
    }));
    if (!animationIsActive(Date.now())) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { redraw(); return; }
    let frameId = 0; let lastPaint = 0;
    const animate = (now: number) => { if (now - lastPaint >= 1000 / 24) { redraw(Date.now()); lastPaint = now; } if (animationIsActive(Date.now())) frameId = requestAnimationFrame(animate); };
    frameId = requestAnimationFrame(animate); return () => cancelAnimationFrame(frameId);
  }, [pingStartedAtRef, redraw, spellPlacementPreview, state]);

  return { renderedMapScene, tokenArt };
}
