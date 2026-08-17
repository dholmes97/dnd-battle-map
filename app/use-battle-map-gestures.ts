"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { AnnotationMode } from "@/app/battle-map-command-bar";
import type {
  BattleMapViewport as Viewport,
  PlacementPreview,
  SpellPlacementPreview,
  TokenPreview,
} from "@/app/battle-map-renderer";
import {
  clampMapPoint,
  clampViewport,
  drawingAtPoint,
  viewportGeometry,
  zoomViewportAt,
} from "@/shared/battle-map-geometry";
import type { CreatureTemplate } from "@/shared/creature-library";
import { tokenRadiusCells } from "@/shared/creature-library";
import type {
  EncounterState,
  MapPoint,
  ParticipantSession,
  SharedAnnotation,
  SharedToken,
} from "@/shared/contracts";
import { insertSharedFogPoint } from "@/shared/fog-of-war";
import {
  SPELL_EFFECT_KIND,
  spellEffectByArt,
  spellEffectById,
  type SpellEffectDefinition,
} from "@/shared/spell-effects";

type DragGesture = {
  pointerId: number;
  tokenId: string;
  origin: MapPoint;
  latest: MapPoint;
  grabOffset: MapPoint;
};

type PanGesture = {
  pointerId: number;
  clientX: number;
  clientY: number;
  viewport: Viewport;
};

type FogVertexGesture = {
  pointerId: number;
  vertexIndex: number;
  polygon: MapPoint[];
};

type SafariGestureEvent = Event & {
  scale: number;
  clientX: number;
  clientY: number;
};

type SafariZoomGesture = {
  viewport: Viewport;
  zoom: number;
  width: number;
  height: number;
  focusX: number;
  focusY: number;
};

type UseBattleMapGesturesInput = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  state: EncounterState | null;
  participant: ParticipantSession | null;
  movementEnabled: boolean;
  annotationMode: AnnotationMode;
  creatures: CreatureTemplate[];
  armedCreatureId: string | null;
  armedSpellId: string | null;
  playerCharacter: SharedToken | null;
  canMoveToken: (token: SharedToken) => boolean;
  isTokenPendingCreation: (tokenId: string) => boolean;
  setNotice: Dispatch<SetStateAction<string>>;
  onSelectToken: (tokenId: string) => void;
  onSelectMapNote: (noteId: string) => void;
  onArmCreature: (creatureId: string) => void;
  onArmSpell: (spellId: string) => void;
  onPlaceCreature: (creature: CreatureTemplate, point: MapPoint) => void | Promise<void>;
  onPlaceSpellEffect: (spell: SpellEffectDefinition, point: MapPoint) => void | Promise<void>;
  onMoveToken: (tokenId: string, point: MapPoint) => void | Promise<void>;
  onAddAnnotation: (type: AnnotationMode, start: MapPoint, end?: MapPoint) => void | Promise<void>;
  onRemoveAnnotation: (annotation: SharedAnnotation) => void;
  onUpdateSharedFog: (polygon: MapPoint[]) => void;
};

let nativeDragGhost: HTMLCanvasElement | null = null;

function pointerToMap(
  canvas: HTMLCanvasElement,
  state: EncounterState,
  viewport: Viewport,
  clientX: number,
  clientY: number,
  radius?: number,
) {
  const rect = canvas.getBoundingClientRect();
  const geometry = viewportGeometry(viewport, state, rect.width, rect.height);
  return clampMapPoint(state.grid, {
    x: geometry.panX + (clientX - rect.left - geometry.offsetX) / geometry.cellSize,
    y: geometry.panY + (clientY - rect.top - geometry.offsetY) / geometry.cellSize,
  }, radius);
}

function suppressNativeDragGhost(dataTransfer: DataTransfer) {
  if (!nativeDragGhost) {
    const ghost = document.createElement("canvas");
    ghost.width = 1;
    ghost.height = 1;
    ghost.getContext("2d")?.fillRect(0, 0, 1, 1);
    Object.assign(ghost.style, {
      position: "fixed",
      top: "-2px",
      left: "-2px",
      width: "1px",
      height: "1px",
      opacity: "0.01",
      pointerEvents: "none",
    });
    document.body.appendChild(ghost);
    nativeDragGhost = ghost;
  }
  dataTransfer.setDragImage(nativeDragGhost, 0, 0);
}

export function useBattleMapGestures({
  canvasRef,
  state,
  participant,
  movementEnabled,
  annotationMode,
  creatures,
  armedCreatureId,
  armedSpellId,
  playerCharacter,
  canMoveToken,
  isTokenPendingCreation,
  setNotice,
  onSelectToken,
  onSelectMapNote,
  onArmCreature,
  onArmSpell,
  onPlaceCreature,
  onPlaceSpellEffect,
  onMoveToken,
  onAddAnnotation,
  onRemoveAnnotation,
  onUpdateSharedFog,
}: UseBattleMapGesturesInput) {
  const [preview, setPreview] = useState<TokenPreview | null>(null);
  const [dragOrigin, setDragOrigin] = useState<MapPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const [placementPreview, setPlacementPreview] = useState<PlacementPreview | null>(null);
  const [spellPlacementPreview, setSpellPlacementPreview] = useState<SpellPlacementPreview | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, centerX: 12, centerY: 8, mapKey: "", fit: false });
  const [effectiveZoom, setEffectiveZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const [editingSharedFog, setEditingSharedFog] = useState(false);
  const [sharedFogPreview, setSharedFogPreview] = useState<MapPoint[] | null>(null);
  const [selectedSharedFogVertex, setSelectedSharedFogVertex] = useState<number | null>(null);
  const dragGestureRef = useRef<DragGesture | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);
  const annotationStartRef = useRef<{ pointerId: number; point: MapPoint } | null>(null);
  const fogVertexGestureRef = useRef<FogVertexGesture | null>(null);
  const safariZoomGestureRef = useRef<SafariZoomGesture | null>(null);
  const viewportRef = useRef(viewport);
  const stateRef = useRef(state);

  const updateEffectiveZoom = useCallback(() => {
    const canvas = canvasRef.current;
    const currentState = stateRef.current;
    if (!canvas || !currentState) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const next = viewportGeometry(viewportRef.current, currentState, rect.width, rect.height).zoom;
    setEffectiveZoom((current) => Math.abs(current - next) < 0.0001 ? current : next);
  }, [canvasRef]);

  useEffect(() => {
    viewportRef.current = viewport;
    stateRef.current = state;
    updateEffectiveZoom();
  }, [state, updateEffectiveZoom, viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateEffectiveZoom);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef, updateEffectiveZoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state) return;

    const startGesture = (rawEvent: Event) => {
      const event = rawEvent as SafariGestureEvent;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const geometry = viewportGeometry(viewportRef.current, state, rect.width, rect.height);
      safariZoomGestureRef.current = {
        viewport: viewportRef.current,
        zoom: geometry.fit ? 1 : geometry.zoom,
        width: rect.width,
        height: rect.height,
        focusX: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        focusY: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
    };

    const updateGesture = (rawEvent: Event) => {
      const event = rawEvent as SafariGestureEvent;
      const gesture = safariZoomGestureRef.current;
      if (!gesture || !Number.isFinite(event.scale) || event.scale <= 0) return;
      event.preventDefault();
      setViewport(zoomViewportAt(
        gesture.viewport,
        state,
        gesture.width,
        gesture.height,
        gesture.zoom * event.scale,
        gesture.focusX,
        gesture.focusY,
      ));
    };

    const endGesture = (event: Event) => {
      if (!safariZoomGestureRef.current) return;
      event.preventDefault();
      safariZoomGestureRef.current = null;
    };

    canvas.addEventListener("gesturestart", startGesture, { passive: false });
    canvas.addEventListener("gesturechange", updateGesture, { passive: false });
    canvas.addEventListener("gestureend", endGesture, { passive: false });
    return () => {
      canvas.removeEventListener("gesturestart", startGesture);
      canvas.removeEventListener("gesturechange", updateGesture);
      canvas.removeEventListener("gestureend", endGesture);
      safariZoomGestureRef.current = null;
    };
  }, [canvasRef, state]);

  const paletteCreature = (id: string | null) => creatures.find((creature) => creature.id === id) ?? null;

  const onPaletteDragStart = (event: ReactDragEvent<HTMLButtonElement>, creature: CreatureTemplate) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-creature-id", creature.id);
    onArmCreature(creature.id);
  };

  const onSpellDragStart = (event: ReactDragEvent<HTMLButtonElement>, spell: SpellEffectDefinition) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-spell-effect-id", spell.id);
    suppressNativeDragGhost(event.dataTransfer);
    onArmSpell(spell.id);
  };

  const onMapDragOver = (event: ReactDragEvent<HTMLCanvasElement>) => {
    if (!state || !participant || !movementEnabled || (participant.role === "player" && !playerCharacter)) return;
    const spell = spellEffectById(event.dataTransfer.getData("application/x-spell-effect-id") || armedSpellId);
    if (spell) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(spell.size));
      setSpellPlacementPreview({ spell, ...point });
      return;
    }
    const creature = paletteCreature(event.dataTransfer.getData("application/x-creature-id") || armedCreatureId);
    if (!creature) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(creature.size));
    setPlacementPreview({ creature, ...point });
  };

  const onMapDrop = (event: ReactDragEvent<HTMLCanvasElement>) => {
    if (!state || !participant || !movementEnabled || (participant.role === "player" && !playerCharacter)) return;
    const spell = spellEffectById(event.dataTransfer.getData("application/x-spell-effect-id") || armedSpellId);
    if (spell) {
      event.preventDefault();
      const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(spell.size));
      setSpellPlacementPreview(null);
      void onPlaceSpellEffect(spell, point);
      return;
    }
    const creature = paletteCreature(event.dataTransfer.getData("application/x-creature-id") || armedCreatureId);
    if (!creature) return;
    event.preventDefault();
    const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(creature.size));
    setPlacementPreview(null);
    void onPlaceCreature(creature, point);
  };

  const eraseAnnotationAtPoint = (canvas: HTMLCanvasElement, point: MapPoint) => {
    if (!state) return;
    const rect = canvas.getBoundingClientRect();
    const cellPixels = viewportGeometry(viewport, state, rect.width, rect.height).cellSize;
    const annotation = drawingAtPoint(state.annotations, point, 10 / Math.max(1, cellPixels));
    if (!annotation) {
      setNotice("Click closer to a drawn line.");
      return;
    }
    onRemoveAnnotation(annotation);
  };

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!state || !participant || event.button !== 0) return;
    const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY);
    const rect = event.currentTarget.getBoundingClientRect();
    const geometry = viewportGeometry(viewport, state, rect.width, rect.height);
    if (editingSharedFog && participant.role === "dm" && state.encounter.mapPackage?.fog.mode === "shared") {
      const polygon = sharedFogPreview ?? state.encounter.mapPackage.fog.sharedPolygon;
      const fogPoint = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, 0);
      const vertexIndex = polygon.findIndex((vertex) => Math.hypot((fogPoint.x - vertex.x) * geometry.cellSize, (fogPoint.y - vertex.y) * geometry.cellSize) <= 13);
      event.preventDefault();
      if (vertexIndex < 0) { setNotice("Drag one of the shared-fog corner handles."); return; }
      setSelectedSharedFogVertex(vertexIndex);
      event.currentTarget.setPointerCapture(event.pointerId);
      fogVertexGestureRef.current = { pointerId: event.pointerId, vertexIndex, polygon: polygon.map((vertex) => ({ ...vertex })) };
      setSharedFogPreview(polygon.map((vertex) => ({ ...vertex })));
      return;
    }
    const hitMapNote = participant.role === "dm"
      ? [...(state.encounter.mapPackage?.notes ?? [])].reverse().find((note) => {
          const deltaX = (point.x - note.x) * geometry.cellSize;
          const deltaY = (point.y - note.y) * geometry.cellSize;
          return Math.hypot(deltaX, deltaY) <= Math.max(12, geometry.cellSize * 0.32);
        }) ?? null
      : null;
    const hitTokens = [...state.tokens].reverse().filter((token) => {
      if (isTokenPendingCreation(token.id)) return false;
      const deltaX = (point.x - token.x) * geometry.cellSize;
      const deltaY = (point.y - token.y) * geometry.cellSize;
      const radius = geometry.cellSize * tokenRadiusCells(token.size);
      const distance = Math.hypot(deltaX, deltaY);
      const spell = token.kind === SPELL_EFFECT_KIND ? spellEffectByArt(token.artAsset) : null;
      if (spell?.id === "magic-circle") {
        const outerRadius = radius * 1.25;
        return distance >= outerRadius * 0.72 && distance <= outerRadius * 1.08;
      }
      if (spell?.shape === "square") {
        const halfSize = radius * 1.16;
        return Math.abs(point.x - token.x) * geometry.cellSize <= halfSize && Math.abs(point.y - token.y) * geometry.cellSize <= halfSize;
      }
      if (spell?.shape === "circle") return distance <= radius * 1.16;
      return distance <= radius;
    });
    const hitToken = hitTokens.find((token) => token.kind !== SPELL_EFFECT_KIND) ?? hitTokens[0];
    if (annotationMode === "move" && hitMapNote) {
      event.preventDefault();
      onSelectMapNote(hitMapNote.id);
      return;
    }
    if (!movementEnabled) {
      if (hitToken?.kind === SPELL_EFFECT_KIND) onSelectToken(hitToken.id);
      return;
    }
    const armedCreature = participant.role === "dm" || playerCharacter ? paletteCreature(armedCreatureId) : null;
    if (armedCreature) {
      event.preventDefault();
      const placementPoint = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(armedCreature.size));
      void onPlaceCreature(armedCreature, placementPoint);
      return;
    }
    const armedSpell = participant.role === "dm" || playerCharacter ? spellEffectById(armedSpellId) : null;
    if (armedSpell) {
      event.preventDefault();
      const placementPoint = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(armedSpell.size));
      void onPlaceSpellEffect(armedSpell, placementPoint);
      return;
    }
    if (annotationMode !== "move") {
      event.preventDefault();
      if (annotationMode === "erase") {
        eraseAnnotationAtPoint(event.currentTarget, point);
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      if (annotationMode === "drawing") annotationStartRef.current = { pointerId: event.pointerId, point };
      else void onAddAnnotation(annotationMode, point);
      return;
    }
    if (hitToken && !dragGestureRef.current) {
      event.preventDefault();
      onSelectToken(hitToken.id);
      if (!canMoveToken(hitToken)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const gesture: DragGesture = {
        pointerId: event.pointerId,
        tokenId: hitToken.id,
        origin: { x: hitToken.x, y: hitToken.y },
        latest: { x: hitToken.x, y: hitToken.y },
        grabOffset: { x: point.x - hitToken.x, y: point.y - hitToken.y },
      };
      dragGestureRef.current = gesture;
      setDragging(true);
      setPreview({ tokenId: hitToken.id, x: hitToken.x, y: hitToken.y });
      setDragOrigin(hitToken.kind === SPELL_EFFECT_KIND
        ? null
        : state.encounter.status === "active" ? hitToken.movementOrigin ?? gesture.origin : gesture.origin);
      return;
    }
    if (!panGestureRef.current) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panGestureRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        viewport: {
          zoom: geometry.fit ? 1 : geometry.zoom,
          centerX: geometry.centerX,
          centerY: geometry.centerY,
          mapKey: geometry.mapKey,
          fit: geometry.fit,
        },
      };
      setPanning(true);
    }
  };

  const dragPoint = (canvas: HTMLCanvasElement, gesture: DragGesture, clientX: number, clientY: number) => {
    if (!state) return gesture.latest;
    const token = state.tokens.find((item) => item.id === gesture.tokenId);
    const radius = tokenRadiusCells(token?.size ?? "medium");
    const pointer = pointerToMap(canvas, state, viewport, clientX, clientY, radius);
    return clampMapPoint(state.grid, { x: pointer.x - gesture.grabOffset.x, y: pointer.y - gesture.grabOffset.y }, radius);
  };

  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const fogGesture = fogVertexGestureRef.current;
    if (fogGesture?.pointerId === event.pointerId && state) {
      event.preventDefault();
      const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, 0);
      fogGesture.polygon[fogGesture.vertexIndex] = clampMapPoint(state.grid, point, 0);
      setSharedFogPreview(fogGesture.polygon.map((vertex) => ({ ...vertex })));
      return;
    }
    const pan = panGestureRef.current;
    if (pan?.pointerId === event.pointerId && state) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const geometry = viewportGeometry(pan.viewport, state, rect.width, rect.height);
      setViewport(clampViewport({
        ...pan.viewport,
        centerX: pan.viewport.centerX - (event.clientX - pan.clientX) / geometry.cellSize,
        centerY: pan.viewport.centerY - (event.clientY - pan.clientY) / geometry.cellSize,
      }, state, rect.width, rect.height));
      return;
    }
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    gesture.latest = dragPoint(event.currentTarget, gesture, event.clientX, event.clientY);
    setPreview({ tokenId: gesture.tokenId, ...gesture.latest });
  };

  const onCanvasPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const fogGesture = fogVertexGestureRef.current;
    if (fogGesture?.pointerId === event.pointerId) {
      event.preventDefault();
      fogVertexGestureRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      const polygon = fogGesture.polygon.map((vertex) => ({ ...vertex }));
      setSharedFogPreview(polygon);
      onUpdateSharedFog(polygon);
      return;
    }
    const pan = panGestureRef.current;
    if (pan?.pointerId === event.pointerId) {
      event.preventDefault();
      panGestureRef.current = null;
      setPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const drawing = annotationStartRef.current;
    if (drawing?.pointerId === event.pointerId && state) {
      const end = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY);
      annotationStartRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      void onAddAnnotation("drawing", drawing.point, end);
      return;
    }
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    gesture.latest = dragPoint(event.currentTarget, gesture, event.clientX, event.clientY);
    dragGestureRef.current = null;
    setPreview({ tokenId: gesture.tokenId, ...gesture.latest });
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (Math.hypot(gesture.latest.x - gesture.origin.x, gesture.latest.y - gesture.origin.y) < 0.001) {
      setPreview(null);
      setDragOrigin(null);
      return;
    }
    void onMoveToken(gesture.tokenId, gesture.latest);
    setPreview(null);
    setDragOrigin(null);
  };

  const onCanvasPointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    annotationStartRef.current = null;
    if (fogVertexGestureRef.current?.pointerId === event.pointerId) {
      fogVertexGestureRef.current = null;
      setSharedFogPreview(state?.encounter.mapPackage?.fog.sharedPolygon ?? null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (panGestureRef.current?.pointerId === event.pointerId) {
      panGestureRef.current = null;
      setPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    dragGestureRef.current = null;
    setPreview(null);
    setDragOrigin(null);
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onCanvasWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    if (!state) return;
    event.preventDefault();
    if (safariZoomGestureRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const focusX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const focusY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setViewport((current) => zoomViewportAt(
      current,
      state,
      rect.width,
      rect.height,
      current.zoom * Math.exp(-event.deltaY * 0.0015),
      focusX,
      focusY,
    ));
  };

  const changeZoom = (amount: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !state) return;
    const rect = canvas.getBoundingClientRect();
    setViewport((current) => {
      const geometry = viewportGeometry(current, state, rect.width, rect.height);
      return zoomViewportAt(current, state, rect.width, rect.height, geometry.zoom < 1 && amount > 0 ? 1 : geometry.zoom + amount);
    });
  };

  const fitViewport = () => {
    if (!state) return;
    setViewport({
      zoom: 1,
      centerX: state.grid.width / 2,
      centerY: state.grid.height / 2,
      mapKey: `${state.encounter.mapPackage?.id ?? "empty"}:${state.grid.width}x${state.grid.height}`,
      fit: true,
    });
  };

  const resetViewport = () => {
    if (!state) return;
    setViewport({
      zoom: 1,
      centerX: state.grid.width / 2,
      centerY: state.grid.height / 2,
      mapKey: `${state.encounter.mapPackage?.id ?? "empty"}:${state.grid.width}x${state.grid.height}`,
      fit: false,
    });
  };

  const toggleSharedFogEditing = () => {
    const next = !editingSharedFog;
    setEditingSharedFog(next);
    setSharedFogPreview(next ? state?.encounter.mapPackage?.fog.sharedPolygon ?? null : null);
    setSelectedSharedFogVertex(null);
    if (next) fitViewport();
  };

  const finishSharedFogEditing = () => {
    setEditingSharedFog(false);
    setSharedFogPreview(null);
    setSelectedSharedFogVertex(null);
  };

  const addSharedFogPoint = () => {
    const polygon = sharedFogPreview ?? state?.encounter.mapPackage?.fog.sharedPolygon;
    if (!polygon) return;
    const next = insertSharedFogPoint(polygon);
    setSharedFogPreview(next);
    setSelectedSharedFogVertex(null);
    onUpdateSharedFog(next);
  };

  const removeSharedFogPoint = () => {
    const polygon = sharedFogPreview ?? state?.encounter.mapPackage?.fog.sharedPolygon;
    if (!polygon || selectedSharedFogVertex === null || polygon.length <= 3) return;
    const next = polygon.filter((_, index) => index !== selectedSharedFogVertex);
    setSharedFogPreview(next);
    setSelectedSharedFogVertex(null);
    onUpdateSharedFog(next);
  };

  return {
    canvasRef,
    preview,
    dragOrigin,
    dragging,
    placementPreview,
    spellPlacementPreview,
    viewport,
    effectiveZoom,
    panning,
    editingSharedFog,
    sharedFogPreview,
    selectedSharedFogVertex,
    onPaletteDragStart,
    onSpellDragStart,
    onMapDragOver,
    onMapDrop,
    onMapDragLeave: () => { setPlacementPreview(null); setSpellPlacementPreview(null); },
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,
    onCanvasWheel,
    changeZoom,
    fitViewport,
    resetViewport,
    toggleSharedFogEditing,
    finishSharedFogEditing,
    addSharedFogPoint,
    removeSharedFogPoint,
    clearCreaturePlacementPreview: () => setPlacementPreview(null),
    clearSpellPlacementPreview: () => setSpellPlacementPreview(null),
  };
}
