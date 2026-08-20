"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { drawMap, PING_DURATION_MS, tokenHasEffect, type BattleMapViewport, type PlacementPreview, type SpellPlacementPreview, type TokenPreview } from "@/app/battle-map-renderer";
import type { EncounterState, ParticipantSession } from "@/shared/contracts";
import { mapSceneContentKey } from "@/shared/battle-map-policies";
import { isSpellShapeArt, SPELL_EFFECT_KIND } from "@/shared/spell-effects";

type RenderedMapScene = { mapId: string; image: HTMLImageElement };

function release(scene: RenderedMapScene | null): void {
  if (!scene) return;
  scene.image.src = "";
}

export function useMapAssets({ active, state, participant, preview, placementPreview, spellPlacementPreview, dragOrigin, viewport, selectedTokenId, selectedMapNoteId, gridOpacity, showColoredTokenCenters, showHealthRings, sharedFogPreview, selectedSharedFogVertex, pingStartedAtRef, canvasRef }: {
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
  pingStartedAtRef: RefObject<Map<string, number>>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const [renderedMapScene, setRenderedMapScene] = useState<RenderedMapScene | null>(null);
  const [tokenArt, setTokenArt] = useState<Map<string, HTMLImageElement>>(new Map());
  const mapSceneKey = mapSceneContentKey(state?.encounter.mapPackage ?? null);
  const placementArtCandidate = placementPreview?.creature.artAsset ?? spellPlacementPreview?.spell.artAsset ?? null;
  const placementArtAsset = isSpellShapeArt(placementArtCandidate) ? null : placementArtCandidate;

  useEffect(() => {
    const mapPackage = state?.encounter.mapPackage;
    if (!mapPackage) { const timer = window.setTimeout(() => setRenderedMapScene((current) => { release(current); return null; }), 0); return () => window.clearTimeout(timer); }
    let disposed = false;
    let loadedImage: HTMLImageElement | null = null;
    void new Promise<[string, HTMLImageElement] | null>((resolve) => { const image = new Image(); image.onload = () => resolve([mapPackage.visual.assetUrl, image]); image.onerror = () => resolve(null); image.src = mapPackage.visual.assetUrl; }).then((entry) => {
      if (disposed) return;
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
    const assets = [...new Set([...(state?.tokens.flatMap((token) => token.artAsset && !isSpellShapeArt(token.artAsset) ? [token.artAsset] : []) ?? []), ...(placementArtAsset ? [placementArtAsset] : [])])];
    if (!assets.length) { const timer = window.setTimeout(() => setTokenArt(new Map()), 0); return () => window.clearTimeout(timer); }
    let disposed = false;
    void Promise.all(assets.map((path) => new Promise<[string, HTMLImageElement]>((resolve) => { const image = new Image(); image.onload = () => resolve([path, image]); image.onerror = () => resolve([path, image]); image.src = path; }))).then((entries) => { if (!disposed) setTokenArt(new Map(entries)); });
    return () => { disposed = true; };
  }, [placementArtAsset, state?.tokens]);

  const redraw = useCallback((animationNow = Date.now()) => {
    const scene = state?.encounter.mapPackage && renderedMapScene?.mapId === state.encounter.mapPackage.id ? renderedMapScene.image : null;
    if (canvasRef.current && state && participant) drawMap(canvasRef.current, state, preview, placementPreview, spellPlacementPreview, dragOrigin, participant, scene, tokenArt, viewport, pingStartedAtRef.current, animationNow, selectedTokenId, selectedMapNoteId, gridOpacity, showColoredTokenCenters, showHealthRings, sharedFogPreview, selectedSharedFogVertex);
  }, [canvasRef, dragOrigin, gridOpacity, participant, pingStartedAtRef, placementPreview, preview, renderedMapScene, selectedMapNoteId, selectedSharedFogVertex, selectedTokenId, sharedFogPreview, showColoredTokenCenters, showHealthRings, spellPlacementPreview, state, tokenArt, viewport]);

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
    const hasPing = () => state?.annotations.some((annotation) => annotation.type === "ping" && pingStartedAtRef.current.has(annotation.id) && Date.now() - pingStartedAtRef.current.get(annotation.id)! < PING_DURATION_MS);
    const hasSpotlight = () => state?.annotations.some((annotation) => (annotation.type === "spotlight" || annotation.type === "neon-spotlight") && annotation.expiresAt !== null && annotation.expiresAt > Date.now());
    const hasSpell = state?.tokens.some((token) => token.kind === SPELL_EFFECT_KIND) || Boolean(spellPlacementPreview);
    const hasVfx = state?.tokens.some((token) => tokenHasEffect(token, "Bless") || tokenHasEffect(token, "Haste"));
    if (!hasPing() && !hasSpotlight() && !hasSpell && !hasVfx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { redraw(); return; }
    let frameId = 0; let lastPaint = 0;
    const animate = (now: number) => { if (now - lastPaint >= 1000 / 24) { redraw(Date.now()); lastPaint = now; } if (hasPing() || hasSpotlight() || hasSpell || hasVfx) frameId = requestAnimationFrame(animate); };
    frameId = requestAnimationFrame(animate); return () => cancelAnimationFrame(frameId);
  }, [pingStartedAtRef, redraw, spellPlacementPreview, state?.annotations, state?.tokens]);
}
