"use client";

import NextImage from "next/image";
import IconActionButton from "@/app/icon-action-button";
import {
  type ChangeEvent,
  type DragEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fitGridGeometry } from "@/shared/battle-map-geometry.mjs";
import { distanceToSegment, dragFogBlocker, ensureSharedFogPolygon, fogBlockerHandleAtPoint } from "@/shared/fog-of-war.mjs";
import { FULL_SCENE_MAPS, SCENE_KITS, createFullSceneMap, type SceneKitDefinition } from "@/shared/full-scene-maps";
import { cloneMapPackage, parseMapPackage, type MapPackage, type MapRotation } from "@/shared/map-package";
import {
  mapNoteAt,
  mapThumbnailUrl,
  nextMapRotation,
  sceneObjectAt,
  sceneObjectBounds,
  snapMapPoint,
} from "@/shared/map-workshop-domain.mjs";

type SavedMapPreset = {
  id: string;
  name: string;
  description: string;
  sourcePrompt: string | null;
  mapPackage: MapPackage;
  createdAt: number;
  updatedAt: number;
};

type Props = {
  activeMapPackage: MapPackage | null;
  activeMapPresetId: string | null;
  savedPresets: SavedMapPreset[];
  onCommand: (name: string, extra: Record<string, unknown>) => Promise<{ state: unknown; presetId?: string }>;
  onClose: () => void;
};

type Tool = "select" | "wall" | "door" | "window" | "label" | "note" | "fog-select" | "fog-add" | "vision-wall" | "vision-door" | "vision-circle";
type Point = { x: number; y: number };
type DragState = { pointerId: number; objectId: string; offset: Point; before: MapPackage };
type WallDrag = { pointerId: number; start: Point; kind: "wall" | "vision-wall" | "vision-door" };
type FogVertexDrag = { pointerId: number; index: number; before: MapPackage };
type FogCircleDrag = { pointerId: number; center: Point };
type SelectedAnnotation = { kind: "label" | "note"; id: string };
type SelectedFogBlocker = { kind: "wall" | "door" | "circle"; id: string };
type FogBlockerTarget = SelectedFogBlocker & { handle: "start" | "end" | "body" | "radius" };
type FogBlockerDrag = { pointerId: number; target: FogBlockerTarget; start: Point; before: MapPackage };

const DEFAULT_SCENE = FULL_SCENE_MAPS[0];
const HISTORY_LIMIT = 50;

function loadImage(path: string): Promise<[string, HTMLImageElement] | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve([path, image]);
    image.onerror = () => resolve(null);
    image.src = path;
  });
}

function canvasPoint(canvas: HTMLCanvasElement, map: MapPackage, clientX: number, clientY: number): Point {
  const rect = canvas.getBoundingClientRect();
  const geometry = fitGridGeometry(map.width, map.height, rect.width, rect.height);
  return {
    x: Math.max(0, Math.min(map.width, (clientX - rect.left - geometry.offsetX) / geometry.cellSize)),
    y: Math.max(0, Math.min(map.height, (clientY - rect.top - geometry.offsetY) / geometry.cellSize)),
  };
}

function freeFogPoint(point: Point): Point {
  return { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 };
}

function labelAt(canvas: HTMLCanvasElement, map: MapPackage, point: Point) {
  const context = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const geometry = fitGridGeometry(map.width, map.height, rect.width, rect.height);
  const cellWidth = geometry.cellSize;
  const cellHeight = geometry.cellSize;
  if (!context || cellWidth <= 0 || cellHeight <= 0) return null;
  context.save();
  context.font = `700 ${Math.max(11, cellWidth * 0.24)}px ui-sans-serif, system-ui`;
  const match = [...map.labels].reverse().find((label) => {
    const halfWidth = (context.measureText(label.text).width + 18) / cellWidth / 2;
    const halfHeight = 14 / cellHeight;
    return Math.abs(point.x - label.x) <= halfWidth && Math.abs(point.y - label.y) <= halfHeight;
  }) ?? null;
  context.restore();
  return match;
}

function drawStructures(context: CanvasRenderingContext2D, map: MapPackage, cellWidth: number, cellHeight: number, includePrivate: boolean) {
  context.save();
  for (const wall of map.walls) {
    context.strokeStyle = "rgba(35, 28, 22, 0.92)";
    context.lineWidth = Math.max(4, cellWidth * 0.12);
    context.beginPath(); context.moveTo(wall.x1 * cellWidth, wall.y1 * cellHeight); context.lineTo(wall.x2 * cellWidth, wall.y2 * cellHeight); context.stroke();
    context.strokeStyle = "rgba(218, 202, 169, 0.68)";
    context.lineWidth = Math.max(1, cellWidth * 0.025);
    context.stroke();
  }
  for (const portal of map.portals) {
    const x = portal.x * cellWidth; const y = portal.y * cellHeight;
    const length = portal.orientation === "horizontal" ? cellWidth * 0.82 : cellHeight * 0.82;
    context.strokeStyle = portal.kind === "door" ? "#d6a75e" : "#79b6c5";
    context.lineWidth = Math.max(3, cellWidth * 0.08);
    context.beginPath();
    if (portal.orientation === "horizontal") { context.moveTo(x - length / 2, y); context.lineTo(x + length / 2, y); }
    else { context.moveTo(x, y - length / 2); context.lineTo(x, y + length / 2); }
    context.stroke();
  }
  context.textAlign = "center"; context.textBaseline = "middle";
  for (const label of map.labels) {
    if (label.visibility === "dm" && !includePrivate) continue;
    context.font = `700 ${Math.max(11, cellWidth * 0.24)}px ui-sans-serif, system-ui`;
    context.fillStyle = "rgba(15, 14, 12, 0.78)";
    const measured = context.measureText(label.text).width + 14;
    context.fillRect(label.x * cellWidth - measured / 2, label.y * cellHeight - 11, measured, 22);
    context.fillStyle = label.visibility === "dm" ? "#c1a6d8" : "#f3e4bb";
    context.fillText(label.text, label.x * cellWidth, label.y * cellHeight);
  }
  if (includePrivate) map.notes.forEach((note, index) => {
    context.fillStyle = "#75508f";
    context.beginPath(); context.arc(note.x * cellWidth, note.y * cellHeight, Math.max(8, cellWidth * 0.22), 0, Math.PI * 2); context.fill();
    context.fillStyle = "white"; context.font = `700 ${Math.max(10, cellWidth * 0.2)}px ui-sans-serif, system-ui`; context.fillText(String(index + 1), note.x * cellWidth, note.y * cellHeight + 0.5);
  });
  context.restore();
}

function renderMapPackageToContext(context: CanvasRenderingContext2D, map: MapPackage, images: ReadonlyMap<string, HTMLImageElement>, cellWidth: number, cellHeight: number, offsetX = 0, offsetY = 0, includePrivate = false) {
  context.save();
  context.translate(offsetX, offsetY);
  const mapWidth = map.width * cellWidth; const mapHeight = map.height * cellHeight;
  const base = images.get(map.visual.assetUrl);
  if (base) context.drawImage(base, 0, 0, mapWidth, mapHeight);
  else { context.fillStyle = "#30372c"; context.fillRect(0, 0, mapWidth, mapHeight); }
  for (const object of map.sceneObjects) {
    const image = images.get(object.assetUrl);
    if (!image) continue;
    context.save();
    const x = object.x * cellWidth; const y = object.y * cellHeight;
    const width = object.width * cellWidth; const height = object.height * cellHeight;
    context.translate(x + width / 2, y + height / 2); context.rotate(object.rotation * Math.PI / 180);
    context.drawImage(image, -width / 2, -height / 2, width, height);
    context.restore();
  }
  drawStructures(context, map, cellWidth, cellHeight, includePrivate);
  context.restore();
}

export function renderMapPackageToCanvas(canvas: HTMLCanvasElement, map: MapPackage, images: ReadonlyMap<string, HTMLImageElement>, includePrivate = false) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const cellWidth = canvas.width / map.width; const cellHeight = canvas.height / map.height;
  context.clearRect(0, 0, canvas.width, canvas.height);
  renderMapPackageToContext(context, map, images, cellWidth, cellHeight, 0, 0, includePrivate);
}

export default function MapWorkshop({ activeMapPackage, activeMapPresetId, savedPresets, onCommand, onClose }: Props) {
  const initial = useMemo(() => cloneMapPackage(activeMapPackage ?? createFullSceneMap(DEFAULT_SCENE)), [activeMapPackage]);
  const [map, setMap] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<SelectedAnnotation | null>(null);
  const [portalOrientation, setPortalOrientation] = useState<"horizontal" | "vertical">("horizontal");
  const [labelText, setLabelText] = useState("");
  const [labelVisibility, setLabelVisibility] = useState<"dm" | "everyone">("everyone");
  const [noteText, setNoteText] = useState("");
  const [presetName, setPresetName] = useState(initial.name);
  const [loadedPresetId, setLoadedPresetId] = useState<string | null>(activeMapPresetId);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [wallPreview, setWallPreview] = useState<{ start: Point; end: Point } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const kitDragRef = useRef<SceneKitDefinition | null>(null);
  const objectDragRef = useRef<DragState | null>(null);
  const wallDragRef = useRef<WallDrag | null>(null);
  const fogVertexDragRef = useRef<FogVertexDrag | null>(null);
  const fogCircleDragRef = useRef<FogCircleDrag | null>(null);
  const fogBlockerDragRef = useRef<FogBlockerDrag | null>(null);
  const undoRef = useRef<MapPackage[]>([]);
  const redoRef = useRef<MapPackage[]>([]);
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const [selectedFogVertex, setSelectedFogVertex] = useState<number | null>(null);
  const [selectedFogBlocker, setSelectedFogBlocker] = useState<SelectedFogBlocker | null>(null);
  const [fogCirclePreview, setFogCirclePreview] = useState<{ center: Point; radius: number } | null>(null);

  const selectedObject = map.sceneObjects.find((object) => object.id === selectedObjectId) ?? null;
  const selectedLabel = selectedAnnotation?.kind === "label" ? map.labels.find((label) => label.id === selectedAnnotation.id) ?? null : null;
  const selectedNote = selectedAnnotation?.kind === "note" ? map.notes.find((note) => note.id === selectedAnnotation.id) ?? null : null;
  const selectedFogDoor = selectedFogBlocker?.kind === "door" ? map.fog.doors.find((door) => door.id === selectedFogBlocker.id) ?? null : null;
  const kit = SCENE_KITS[map.visual.sceneKitId] ?? [];
  const assetPaths = useMemo(() => [...new Set([map.visual.assetUrl, ...map.sceneObjects.map((object) => object.assetUrl)])], [map.sceneObjects, map.visual.assetUrl]);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => { if (!disposed) setImages(new Map()); });
    void Promise.all(assetPaths.map(loadImage)).then((entries) => {
      if (!disposed) setImages(new Map(entries.filter((entry): entry is [string, HTMLImageElement] => entry !== null)));
    });
    return () => { disposed = true; };
  }, [assetPaths]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const context = canvas.getContext("2d"); if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = "#242622"; context.fillRect(0, 0, rect.width, rect.height);
    const geometry = fitGridGeometry(map.width, map.height, rect.width, rect.height);
    const cellWidth = geometry.cellSize; const cellHeight = geometry.cellSize;
    const screenX = (x: number) => geometry.offsetX + x * cellWidth;
    const screenY = (y: number) => geometry.offsetY + y * cellHeight;
    renderMapPackageToContext(context, map, images, cellWidth, cellHeight, geometry.offsetX, geometry.offsetY, true);
    context.strokeStyle = "rgba(241, 229, 198, 0.2)"; context.lineWidth = 1;
    for (let x = 0; x <= map.width; x += 1) { context.beginPath(); context.moveTo(screenX(x), geometry.offsetY); context.lineTo(screenX(x), geometry.offsetY + map.height * cellHeight); context.stroke(); }
    for (let y = 0; y <= map.height; y += 1) { context.beginPath(); context.moveTo(geometry.offsetX, screenY(y)); context.lineTo(geometry.offsetX + map.width * cellWidth, screenY(y)); context.stroke(); }
    if (map.fog.mode === "shared") {
      context.save();
      context.beginPath();
      map.fog.sharedPolygon.forEach((point, index) => index ? context.lineTo(screenX(point.x), screenY(point.y)) : context.moveTo(screenX(point.x), screenY(point.y)));
      context.closePath(); context.fillStyle = "rgba(9, 10, 14, 0.62)"; context.fill();
      context.strokeStyle = "#b79cff"; context.lineWidth = 2; context.setLineDash([7, 5]); context.stroke(); context.setLineDash([]);
      map.fog.sharedPolygon.forEach((point, index) => {
        context.beginPath(); context.arc(screenX(point.x), screenY(point.y), index === selectedFogVertex ? 7 : 5, 0, Math.PI * 2);
        context.fillStyle = index === selectedFogVertex ? "#f5c65c" : "#d5c8ff"; context.fill(); context.strokeStyle = "#292136"; context.stroke();
      });
      context.restore();
    }
    if (map.fog.mode === "dynamic") {
      context.save(); context.lineWidth = 3;
      for (const wall of map.fog.walls) {
        context.strokeStyle = selectedFogBlocker?.kind === "wall" && selectedFogBlocker.id === wall.id ? "#f5c65c" : "#b79cff";
        context.beginPath(); context.moveTo(screenX(wall.x1), screenY(wall.y1)); context.lineTo(screenX(wall.x2), screenY(wall.y2)); context.stroke();
        if (selectedFogBlocker?.kind === "wall" && selectedFogBlocker.id === wall.id) for (const point of [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }]) { context.fillStyle = "#fff2bd"; context.beginPath(); context.arc(screenX(point.x), screenY(point.y), 6, 0, Math.PI * 2); context.fill(); }
      }
      for (const door of map.fog.doors) {
        context.strokeStyle = selectedFogBlocker?.kind === "door" && selectedFogBlocker.id === door.id ? "#f5c65c" : door.open ? "#70c897" : "#ef9f68";
        context.setLineDash(door.open ? [5, 5] : []); context.beginPath(); context.moveTo(screenX(door.x1), screenY(door.y1)); context.lineTo(screenX(door.x2), screenY(door.y2)); context.stroke(); context.setLineDash([]);
        if (selectedFogBlocker?.kind === "door" && selectedFogBlocker.id === door.id) for (const point of [{ x: door.x1, y: door.y1 }, { x: door.x2, y: door.y2 }]) { context.fillStyle = "#fff2bd"; context.beginPath(); context.arc(screenX(point.x), screenY(point.y), 6, 0, Math.PI * 2); context.fill(); }
      }
      for (const circle of map.fog.circles) {
        context.strokeStyle = selectedFogBlocker?.kind === "circle" && selectedFogBlocker.id === circle.id ? "#f5c65c" : "#b79cff";
        context.beginPath(); context.ellipse(screenX(circle.x), screenY(circle.y), circle.radius * cellWidth, circle.radius * cellHeight, 0, 0, Math.PI * 2); context.stroke();
        if (selectedFogBlocker?.kind === "circle" && selectedFogBlocker.id === circle.id) {
          context.fillStyle = "#fff2bd";
          for (const point of [{ x: circle.x, y: circle.y }, { x: circle.x + circle.radius, y: circle.y }]) { context.beginPath(); context.arc(screenX(point.x), screenY(point.y), 6, 0, Math.PI * 2); context.fill(); }
        }
      }
      if (fogCirclePreview) { context.strokeStyle = "#f5c65c"; context.setLineDash([7, 5]); context.beginPath(); context.arc(screenX(fogCirclePreview.center.x), screenY(fogCirclePreview.center.y), fogCirclePreview.radius * cellWidth, 0, Math.PI * 2); context.stroke(); }
      context.restore();
    }
    if (selectedObject) {
      const bounds = sceneObjectBounds(selectedObject);
      context.strokeStyle = "#f5c65c"; context.lineWidth = 2; context.setLineDash([8, 5]);
      context.strokeRect(screenX(selectedObject.x), screenY(selectedObject.y), bounds.width * cellWidth, bounds.height * cellHeight); context.setLineDash([]);
    }
    if (selectedLabel) {
      context.save();
      context.font = `700 ${Math.max(11, cellWidth * 0.24)}px ui-sans-serif, system-ui`;
      const width = context.measureText(selectedLabel.text).width + 22;
      context.strokeStyle = "#f5c65c"; context.lineWidth = 2; context.setLineDash([8, 5]);
      context.strokeRect(screenX(selectedLabel.x) - width / 2, screenY(selectedLabel.y) - 15, width, 30);
      context.restore();
    }
    if (selectedNote) {
      context.save();
      context.strokeStyle = "#f5c65c"; context.lineWidth = 2; context.setLineDash([8, 5]);
      context.beginPath(); context.arc(screenX(selectedNote.x), screenY(selectedNote.y), Math.max(12, cellWidth * 0.3), 0, Math.PI * 2); context.stroke();
      context.restore();
    }
    if (wallPreview) {
      context.strokeStyle = "#f5c65c"; context.lineWidth = 3; context.setLineDash([7, 5]);
      context.beginPath(); context.moveTo(screenX(wallPreview.start.x), screenY(wallPreview.start.y)); context.lineTo(screenX(wallPreview.end.x), screenY(wallPreview.end.y)); context.stroke(); context.setLineDash([]);
    }
  }, [fogCirclePreview, images, map, selectedFogBlocker, selectedFogVertex, selectedLabel, selectedNote, selectedObject, wallPreview]);

  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  const remember = (before: MapPackage) => {
    undoRef.current = [...undoRef.current.slice(-(HISTORY_LIMIT - 1)), cloneMapPackage(before)]; redoRef.current = []; setHistoryCounts({ undo: undoRef.current.length, redo: 0 });
  };
  const commit = (update: (current: MapPackage) => MapPackage) => setMap((current) => { const next = update(current); remember(current); setDirty(true); return next; });
  const replaceDraft = (next: MapPackage, changed: boolean) => {
    setMap(cloneMapPackage(next)); setDirty(changed); setPresetName(next.name); setSelectedObjectId(null); setSelectedAnnotation(null); setSelectedFogVertex(null); setSelectedFogBlocker(null); setTool("select"); undoRef.current = []; redoRef.current = []; setHistoryCounts({ undo: 0, redo: 0 });
  };
  const undo = () => {
    const previous = undoRef.current.pop(); if (!previous) return;
    redoRef.current.push(cloneMapPackage(map)); setMap(previous); setDirty(true); setSelectedObjectId(null); setSelectedAnnotation(null); setHistoryCounts({ undo: undoRef.current.length, redo: redoRef.current.length });
  };
  const redo = () => {
    const next = redoRef.current.pop(); if (!next) return;
    undoRef.current.push(cloneMapPackage(map)); setMap(next); setDirty(true); setSelectedObjectId(null); setSelectedAnnotation(null); setHistoryCounts({ undo: undoRef.current.length, redo: redoRef.current.length });
  };

  const runCommand = async (name: string, extra: Record<string, unknown>, success: string) => {
    setBusy(true); setMessage("");
    try { const result = await onCommand(name, extra); setMessage(success); return result; }
    catch (error) { setMessage(error instanceof Error ? error.message : "The map action was rejected."); return null; }
    finally { setBusy(false); }
  };

  const chooseScene = (definition: (typeof FULL_SCENE_MAPS)[number]) => {
    const next = createFullSceneMap(definition); replaceDraft(next, true); setLoadedPresetId(null);
    setMessage(`Loaded “${next.name}” as a private draft.`);
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event.currentTarget, map, event.clientX, event.clientY);
    if (tool === "fog-select" && map.fog.mode === "shared") {
      const index = map.fog.sharedPolygon.reduce((best, vertex, current) => Math.hypot(point.x - vertex.x, point.y - vertex.y) < Math.hypot(point.x - map.fog.sharedPolygon[best].x, point.y - map.fog.sharedPolygon[best].y) ? current : best, 0);
      if (Math.hypot(point.x - map.fog.sharedPolygon[index].x, point.y - map.fog.sharedPolygon[index].y) <= 0.7) {
        setSelectedFogVertex(index); fogVertexDragRef.current = { pointerId: event.pointerId, index, before: cloneMapPackage(map) }; event.currentTarget.setPointerCapture(event.pointerId);
      }
      return;
    }
    if (tool === "fog-add" && map.fog.mode === "shared") {
      const snapped = snapMapPoint(point);
      let insertAfter = 0; let closest = Infinity;
      map.fog.sharedPolygon.forEach((start, index) => {
        const end = map.fog.sharedPolygon[(index + 1) % map.fog.sharedPolygon.length]; const distance = distanceToSegment(snapped, start, end);
        if (distance < closest) { closest = distance; insertAfter = index; }
      });
      commit((current) => ({ ...current, fog: { ...current.fog, sharedPolygon: [...current.fog.sharedPolygon.slice(0, insertAfter + 1), snapped, ...current.fog.sharedPolygon.slice(insertAfter + 1)] } }));
      setSelectedFogVertex(insertAfter + 1); setTool("fog-select"); return;
    }
    if (tool === "fog-select" && map.fog.mode === "dynamic") {
      const tolerance = Math.max(0.2, 10 / (event.currentTarget.getBoundingClientRect().width / map.width));
      const target = fogBlockerHandleAtPoint(map.fog, point, tolerance, selectedFogBlocker) as FogBlockerTarget | null;
      setSelectedFogBlocker(target ? { kind: target.kind, id: target.id } : null);
      if (target) {
        fogBlockerDragRef.current = { pointerId: event.pointerId, target, start: freeFogPoint(point), before: cloneMapPackage(map) };
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      return;
    }
    if ((tool === "vision-wall" || tool === "vision-door") && map.fog.mode === "dynamic") {
      const start = freeFogPoint(point); wallDragRef.current = { pointerId: event.pointerId, start, kind: tool }; setWallPreview({ start, end: start }); event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    if (tool === "vision-circle" && map.fog.mode === "dynamic") {
      const center = freeFogPoint(point); fogCircleDragRef.current = { pointerId: event.pointerId, center }; setFogCirclePreview({ center, radius: 0.25 }); event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    if (tool === "select") {
      const note = mapNoteAt(map, point);
      const label = note ? null : labelAt(event.currentTarget, map, point);
      if (note || label) {
        setSelectedAnnotation({ kind: note ? "note" : "label", id: (note ?? label)!.id });
        setSelectedObjectId(null);
        return;
      }
      const object = sceneObjectAt(map, point); setSelectedObjectId(object?.id ?? null); setSelectedAnnotation(null);
      if (object) { objectDragRef.current = { pointerId: event.pointerId, objectId: object.id, offset: { x: point.x - object.x, y: point.y - object.y }, before: cloneMapPackage(map) }; event.currentTarget.setPointerCapture(event.pointerId); }
      return;
    }
    if (tool === "wall") { const start = snapMapPoint(point); wallDragRef.current = { pointerId: event.pointerId, start, kind: "wall" }; setWallPreview({ start, end: start }); event.currentTarget.setPointerCapture(event.pointerId); return; }
    const location = snapMapPoint(point); const id = crypto.randomUUID();
    if (tool === "door" || tool === "window") commit((current) => ({ ...current, portals: [...current.portals, { id, x: location.x, y: location.y, orientation: portalOrientation, kind: tool, open: false }] }));
    if (tool === "label" && labelText.trim()) commit((current) => ({ ...current, labels: [...current.labels, { id, x: location.x, y: location.y, text: labelText.trim().slice(0, 120), visibility: labelVisibility }] }));
    if (tool === "note" && noteText.trim()) commit((current) => ({ ...current, notes: [...current.notes, { id, x: location.x, y: location.y, text: noteText.trim().slice(0, 500) }] }));
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event.currentTarget, map, event.clientX, event.clientY);
    const fogBlockerDrag = fogBlockerDragRef.current;
    if (fogBlockerDrag?.pointerId === event.pointerId) setMap((current) => ({ ...current, fog: dragFogBlocker(fogBlockerDrag.before.fog, fogBlockerDrag.target, fogBlockerDrag.start, freeFogPoint(point), current.width, current.height) }));
    const fogVertexDrag = fogVertexDragRef.current;
    if (fogVertexDrag?.pointerId === event.pointerId) {
      const next = snapMapPoint(point); setMap((current) => ({ ...current, fog: { ...current.fog, sharedPolygon: current.fog.sharedPolygon.map((vertex, index) => index === fogVertexDrag.index ? next : vertex) } }));
    }
    const fogCircleDrag = fogCircleDragRef.current;
    if (fogCircleDrag?.pointerId === event.pointerId) setFogCirclePreview({ center: fogCircleDrag.center, radius: Math.max(0.25, Math.hypot(point.x - fogCircleDrag.center.x, point.y - fogCircleDrag.center.y)) });
    const objectDrag = objectDragRef.current;
    if (objectDrag?.pointerId === event.pointerId) setMap((current) => ({ ...current, sceneObjects: current.sceneObjects.map((object) => object.id === objectDrag.objectId ? { ...object, x: Math.max(0, Math.min(current.width - sceneObjectBounds(object).width, Math.round(point.x - objectDrag.offset.x))), y: Math.max(0, Math.min(current.height - sceneObjectBounds(object).height, Math.round(point.y - objectDrag.offset.y))) } : object) }));
    const wallDrag = wallDragRef.current;
    if (wallDrag?.pointerId === event.pointerId) setWallPreview({ start: wallDrag.start, end: wallDrag.kind === "wall" ? snapMapPoint(point) : freeFogPoint(point) });
  };

  const finishPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    const fogBlockerDrag = fogBlockerDragRef.current;
    if (fogBlockerDrag?.pointerId === event.pointerId) {
      fogBlockerDragRef.current = null;
      if (JSON.stringify(fogBlockerDrag.before.fog) !== JSON.stringify(map.fog)) { remember(fogBlockerDrag.before); setDirty(true); }
    }
    const fogVertexDrag = fogVertexDragRef.current;
    if (fogVertexDrag?.pointerId === event.pointerId) { remember(fogVertexDrag.before); setDirty(true); fogVertexDragRef.current = null; }
    const fogCircleDrag = fogCircleDragRef.current;
    if (fogCircleDrag?.pointerId === event.pointerId) {
      const radius = fogCirclePreview?.radius ?? 0; fogCircleDragRef.current = null; setFogCirclePreview(null);
      if (radius >= 0.25) { const id = crypto.randomUUID(); commit((current) => ({ ...current, fog: { ...current.fog, circles: [...current.fog.circles, { id, x: fogCircleDrag.center.x, y: fogCircleDrag.center.y, radius: Math.round(radius * 20) / 20 }] } })); setSelectedFogBlocker({ kind: "circle", id }); setTool("fog-select"); }
    }
    const objectDrag = objectDragRef.current;
    if (objectDrag?.pointerId === event.pointerId) { remember(objectDrag.before); setDirty(true); objectDragRef.current = null; }
    const wallDrag = wallDragRef.current;
    if (wallDrag?.pointerId === event.pointerId) {
      const rawEnd = canvasPoint(event.currentTarget, map, event.clientX, event.clientY); const end = wallDrag.kind === "wall" ? snapMapPoint(rawEnd) : freeFogPoint(rawEnd); wallDragRef.current = null; setWallPreview(null);
      if (end.x !== wallDrag.start.x || end.y !== wallDrag.start.y) {
        const id = crypto.randomUUID();
        if (wallDrag.kind === "wall") commit((current) => ({ ...current, walls: [...current.walls, { id, x1: wallDrag.start.x, y1: wallDrag.start.y, x2: end.x, y2: end.y, style: current.biome === "cave" ? "cave" : current.biome === "ruins" ? "ruined" : "stone" }] }));
        else commit((current) => ({ ...current, fog: { ...current.fog, [wallDrag.kind === "vision-door" ? "doors" : "walls"]: [...current.fog[wallDrag.kind === "vision-door" ? "doors" : "walls"], { id, x1: wallDrag.start.x, y1: wallDrag.start.y, x2: end.x, y2: end.y, ...(wallDrag.kind === "vision-door" ? { open: false } : {}) }] } }));
        if (wallDrag.kind !== "wall") { setSelectedFogBlocker({ kind: wallDrag.kind === "vision-door" ? "door" : "wall", id }); setTool("fog-select"); }
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKitDragStart = (event: DragEvent<HTMLButtonElement>, definition: SceneKitDefinition) => { kitDragRef.current = definition; event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("text/plain", definition.id); };
  const onMapDrop = (event: DragEvent<HTMLCanvasElement>) => {
    event.preventDefault(); const definition = kitDragRef.current; kitDragRef.current = null; if (!definition) return;
    const point = snapMapPoint(canvasPoint(event.currentTarget, map, event.clientX, event.clientY));
    commit((current) => {
      const object = { id: crypto.randomUUID(), definitionId: definition.id, assetUrl: definition.assetUrl, x: Math.max(0, Math.min(current.width - definition.width, point.x - Math.floor(definition.width / 2))), y: Math.max(0, Math.min(current.height - definition.height, point.y - Math.floor(definition.height / 2))), width: definition.width, height: definition.height, rotation: 0 as MapRotation };
      setSelectedObjectId(object.id); setSelectedAnnotation(null); return { ...current, sceneObjects: [...current.sceneObjects, object] };
    });
  };

  const deleteObject = (collection: "walls" | "portals" | "labels" | "notes", id: string) => {
    commit((current) => ({ ...current, [collection]: current[collection].filter((item) => item.id !== id) }));
    if (selectedAnnotation?.id === id) setSelectedAnnotation(null);
  };
  const deleteSelected = () => { if (!selectedObjectId) return; commit((current) => ({ ...current, sceneObjects: current.sceneObjects.filter((object) => object.id !== selectedObjectId) })); setSelectedObjectId(null); };
  const deleteSelectedAnnotation = () => {
    if (!selectedAnnotation) return;
    deleteObject(selectedAnnotation.kind === "label" ? "labels" : "notes", selectedAnnotation.id);
  };
  const rotateSelected = () => { if (!selectedObjectId) return; commit((current) => ({ ...current, sceneObjects: current.sceneObjects.map((object) => object.id === selectedObjectId ? { ...object, rotation: nextMapRotation(object.rotation) as MapRotation } : object) })); };
  const setFogMode = (mode: MapPackage["fog"]["mode"]) => {
    commit((current) => ({ ...current, fog: { ...current.fog, mode, sharedPolygon: mode === "shared" ? ensureSharedFogPolygon(current.fog.sharedPolygon, current.width, current.height) : current.fog.sharedPolygon } }));
    setSelectedFogVertex(null); setSelectedFogBlocker(null); setTool(mode === "off" ? "select" : "fog-select");
  };
  const resetSharedFog = () => {
    commit((current) => ({ ...current, fog: { ...current.fog, sharedPolygon: ensureSharedFogPolygon([{ x: 0, y: 0 }, { x: current.width, y: 0 }, { x: current.width, y: current.height }, { x: 0, y: current.height }], current.width, current.height) } }));
    setSelectedFogVertex(0); setTool("fog-select");
  };
  const deleteSelectedFogItem = () => {
    if (map.fog.mode === "shared" && selectedFogVertex !== null && map.fog.sharedPolygon.length > 3) {
      commit((current) => ({ ...current, fog: { ...current.fog, sharedPolygon: current.fog.sharedPolygon.filter((_, index) => index !== selectedFogVertex) } })); setSelectedFogVertex(null); return;
    }
    if (!selectedFogBlocker) return;
    const collection = selectedFogBlocker.kind === "circle" ? "circles" : selectedFogBlocker.kind === "door" ? "doors" : "walls";
    commit((current) => ({ ...current, fog: { ...current.fog, [collection]: current.fog[collection].filter((item) => item.id !== selectedFogBlocker.id) } })); setSelectedFogBlocker(null);
  };
  const toggleSelectedVisionDoor = () => {
    if (selectedFogBlocker?.kind !== "door") return;
    commit((current) => ({ ...current, fog: { ...current.fog, doors: current.fog.doors.map((door) => door.id === selectedFogBlocker.id ? { ...door, open: !door.open } : door) } }));
  };

  const savePreset = async () => {
    const name = presetName.trim() || map.name; const result = await runCommand("save-map-preset", { presetId: loadedPresetId || undefined, name, description: map.description, mapPackage: { ...map, name } }, loadedPresetId ? `Updated “${name}”.` : `Saved “${name}”.`);
    if (!loadedPresetId && result?.presetId) setLoadedPresetId(result.presetId);
  };
  const apply = async () => { const result = await runCommand("apply-map-package", { mapPackage: map, presetId: loadedPresetId || undefined }, `Applied “${map.name}”. Players now receive this scene.`); if (result) setDirty(false); };
  const discard = () => { const next = activeMapPackage ?? createFullSceneMap(DEFAULT_SCENE); replaceDraft(next, false); setLoadedPresetId(activeMapPresetId); setMessage("Discarded private changes and restored the applied scene."); };
  const loadPreset = (preset: SavedMapPreset) => { replaceDraft(preset.mapPackage, preset.id !== activeMapPresetId); setLoadedPresetId(preset.id); setMessage(`Loaded “${preset.name}” into the private workshop.`); };
  const exportPackage = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(map, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${map.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "battle-map"}.dndmap.json`; anchor.click(); URL.revokeObjectURL(url); setMessage("Scene package exported."); };
  const importPackage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    try { const imported = parseMapPackage(JSON.parse(await file.text())); if (!imported) throw new Error("That is not a valid full-scene map package."); imported.source = { kind: "imported" }; replaceDraft(imported, true); setLoadedPresetId(null); setMessage("Imported a private full-scene draft."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); }
  };

  return <main className="workshop-shell">
    <header className="workshop-header"><div><div className="eyebrow">Map workshop · DM only</div><h1>{map.name}</h1><p>Build privately, then apply the complete scene when players should see it.</p></div><div className="workshop-header-actions"><span className={dirty ? "draft-status is-dirty" : "draft-status"}>{dirty ? "Private changes" : "Matches players"}</span><button className="secondary-button" onClick={discard}>Discard</button><button className="primary-button" disabled={busy} onClick={() => void apply()}>Apply to players</button><button className="secondary-button" onClick={onClose}>Return</button></div></header>
    <div className="workshop-layout">
      <aside className="workshop-controls" aria-label="Scene workshop controls">
        <section><div className="workshop-section-heading"><small>Complete scenes</small><strong>Choose a cohesive base</strong></div><p className="workshop-help">Each starter is one high-resolution image with its own matching additions.</p><div className="full-scene-list">{FULL_SCENE_MAPS.map((scene) => <button key={scene.id} className={map.visual.assetUrl === scene.assetUrl ? "is-active" : ""} onClick={() => chooseScene(scene)}><NextImage src={mapThumbnailUrl(scene.assetUrl)} alt="" width={96} height={64} loading="lazy" unoptimized /><span><strong>{scene.name}</strong><small>{scene.biome} · {scene.width ?? 24} × {scene.height ?? 16}</small></span></button>)}</div></section>
        <section><div className="workshop-section-heading"><small>Edit</small><strong>Scene annotations</strong></div><div className="draft-history-row"><button disabled={!historyCounts.undo} onClick={undo}>Undo{historyCounts.undo ? ` (${historyCounts.undo})` : ""}</button><button disabled={!historyCounts.redo} onClick={redo}>Redo{historyCounts.redo ? ` (${historyCounts.redo})` : ""}</button></div><div className="workshop-tool-row is-expanded">{(["select", "wall", "door", "window", "label", "note"] as Tool[]).map((value) => <button key={value} className={tool === value ? "is-active" : ""} onClick={() => setTool(value)}>{value === "note" ? "DM note" : value.charAt(0).toUpperCase() + value.slice(1)}</button>)}</div>
          {tool === "select" ? <p className="workshop-help">Select additions, labels, or notes on the map. Drag additions to move them; use Delete below to remove the selection.</p> : null}
          {tool === "wall" ? <p className="workshop-help">Drag between grid intersections to add a wall.</p> : null}
          {tool === "door" || tool === "window" ? <div className="structure-options"><span>Orientation</span><div className="terrain-edge-toggle"><button className={portalOrientation === "horizontal" ? "is-active" : ""} onClick={() => setPortalOrientation("horizontal")}>Horizontal</button><button className={portalOrientation === "vertical" ? "is-active" : ""} onClick={() => setPortalOrientation("vertical")}>Vertical</button></div><p className="workshop-help">Click the desired position.</p></div> : null}
          {tool === "label" ? <div className="structure-options"><label>Text<input value={labelText} onChange={(event) => setLabelText(event.target.value)} /></label><label>Visible to<select value={labelVisibility} onChange={(event) => setLabelVisibility(event.target.value as "dm" | "everyone")}><option value="everyone">Everyone</option><option value="dm">DM only</option></select></label><p className="workshop-help">Enter text, then click the scene.</p></div> : null}
          {tool === "note" ? <div className="structure-options"><label>Private note<textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} rows={3} /></label><p className="workshop-help">Enter a note, then click its location.</p></div> : null}
        </section>
        <section className="fog-workshop-panel"><div className="workshop-section-heading"><small>Fog of war</small><strong>Visibility setup</strong></div>
          <label>Mode<select aria-label="Fog of war mode" value={map.fog.mode} onChange={(event) => setFogMode(event.target.value as MapPackage["fog"]["mode"])}><option value="off">No fog</option><option value="shared">DM-controlled shared fog</option><option value="dynamic">Dynamic character vision</option></select></label>
          {map.fog.mode === "off" ? <p className="workshop-help">The complete map and all normally visible tokens are shown to everyone.</p> : null}
          {map.fog.mode === "shared" ? <><p className="workshop-help">The shaded polygon is hidden from the whole party. Drag its corners inward to reveal the map; add corners for more detailed boundaries.</p><div className="workshop-tool-row"><button className={tool === "fog-select" ? "is-active" : ""} onClick={() => setTool("fog-select")}>Move corners</button><button className={tool === "fog-add" ? "is-active" : ""} onClick={() => setTool("fog-add")}>Add corner</button></div><div className="button-row"><button className="secondary-button" onClick={resetSharedFog}>Cover whole map</button><button className="danger-button" disabled={selectedFogVertex === null || map.fog.sharedPolygon.length <= 3} onClick={deleteSelectedFogItem}>Remove corner</button></div></> : null}
          {map.fog.mode === "dynamic" ? <><p className="workshop-help">Draw free-angle sight blockers over walls, doors, rocks, pillars, trees, and statues. With Select, drag a line to move it, drag either endpoint to reshape it, drag inside a circle to move it, or drag its rim to resize.</p><div className="workshop-tool-row is-expanded"><button className={tool === "fog-select" ? "is-active" : ""} onClick={() => setTool("fog-select")}>Select</button><button className={tool === "vision-wall" ? "is-active" : ""} onClick={() => setTool("vision-wall")}>Vision wall</button><button className={tool === "vision-door" ? "is-active" : ""} onClick={() => setTool("vision-door")}>Vision door</button><button className={tool === "vision-circle" ? "is-active" : ""} onClick={() => setTool("vision-circle")}>Round blocker</button></div>{selectedFogBlocker ? <div className="selected-fog-blocker"><strong>Selected {selectedFogBlocker.kind}</strong><small>{selectedFogBlocker.kind === "circle" ? "Drag inside to move · drag rim to resize" : "Drag line to move · drag either endpoint to reshape"}</small>{selectedFogDoor ? <button className="secondary-button" onClick={toggleSelectedVisionDoor}>{selectedFogDoor.open ? "Close door" : "Open door"}</button> : null}<button className="danger-button" onClick={deleteSelectedFogItem}>Delete blocker</button></div> : null}</> : null}
        </section>
        <section className="scene-kit-panel"><div className="workshop-section-heading"><small>Matched additions</small><strong>Artwork for this scene</strong></div><p className="workshop-help">Drag onto the scene. These pieces share its palette, scale, viewpoint, and lighting.</p><div className="scene-kit-list">{kit.map((item) => <button key={item.id} draggable onDragStart={(event) => onKitDragStart(event, item)} onDragEnd={() => { kitDragRef.current = null; }}><NextImage src={item.assetUrl} alt="" width={64} height={64} unoptimized draggable={false} /><span><strong>{item.name}</strong><small>{item.width} × {item.height} cells</small></span></button>)}</div></section>
        <details className="map-object-list"><summary>Scene details <span>{map.sceneObjects.length + map.walls.length + map.portals.length + map.labels.length + map.notes.length}</span></summary>
          {map.sceneObjects.map((object) => <div key={object.id}><span>{kit.find((item) => item.id === object.definitionId)?.name ?? "Scene addition"}<small>{object.rotation}°</small></span><IconActionButton variant="delete" label="Delete scene addition" onClick={() => { commit((current) => ({ ...current, sceneObjects: current.sceneObjects.filter((item) => item.id !== object.id) })); setSelectedObjectId(null); }} /></div>)}
          {map.walls.map((wall, index) => <div key={wall.id}><span>Wall {index + 1}</span><IconActionButton variant="delete" label={`Delete wall ${index + 1}`} onClick={() => deleteObject("walls", wall.id)} /></div>)}
          {map.portals.map((portal, index) => <div key={portal.id}><span>{portal.kind} {index + 1}<small>{portal.orientation}</small></span><IconActionButton variant="delete" label={`Delete ${portal.kind} ${index + 1}`} onClick={() => deleteObject("portals", portal.id)} /></div>)}
          {map.labels.map((label, index) => <div key={label.id}><span>{label.text}<small>{label.visibility}</small></span><IconActionButton variant="delete" label={`Delete label ${index + 1}`} onClick={() => deleteObject("labels", label.id)} /></div>)}
          {map.notes.map((note, index) => <div key={note.id}><span>DM note {index + 1}<small>{note.text}</small></span><IconActionButton variant="delete" label={`Delete note ${index + 1}`} onClick={() => deleteObject("notes", note.id)} /></div>)}
        </details>
        {selectedObject ? <section className="selected-scene-panel"><div className="workshop-section-heading"><small>Selected addition</small><strong>{kit.find((item) => item.id === selectedObject.definitionId)?.name ?? selectedObject.definitionId}</strong></div><p className="workshop-help">Drag to reposition; rotation remains grid-aligned.</p><div className="button-row"><button className="secondary-button" onClick={rotateSelected}>Rotate 90°</button><button className="danger-button" onClick={deleteSelected}>Delete</button></div></section> : null}
        {selectedLabel || selectedNote ? <section className="selected-scene-panel"><div className="workshop-section-heading"><small>{selectedLabel ? "Selected label" : "Selected DM note"}</small><strong>{selectedLabel?.text ?? `Note ${map.notes.findIndex((note) => note.id === selectedNote?.id) + 1}`}</strong></div>{selectedNote ? <p className="workshop-help selected-note-copy">{selectedNote.text}</p> : <p className="workshop-help">{selectedLabel?.visibility === "dm" ? "Visible only to the DM." : "Visible to everyone after the scene is applied."}</p>}<button className="danger-button" onClick={deleteSelectedAnnotation}>Delete</button></section> : null}
        <section className="map-library-panel"><div className="workshop-section-heading"><small>Scene library</small><strong>Save and exchange</strong></div><label>Title<input value={map.name} maxLength={100} onChange={(event) => commit((current) => ({ ...current, name: event.target.value }))} /></label><label>Description<textarea value={map.description} maxLength={500} rows={2} onChange={(event) => commit((current) => ({ ...current, description: event.target.value }))} /></label><label>Preset name<input value={presetName} onChange={(event) => setPresetName(event.target.value)} /></label><div className="button-row"><button className="primary-button" disabled={busy} onClick={() => void savePreset()}>{loadedPresetId ? "Update preset" : "Save preset"}</button><button className="secondary-button" onClick={exportPackage}>Export</button><button className="secondary-button" onClick={() => importRef.current?.click()}>Import</button></div><input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importPackage(event)} /><div className="saved-map-list">{savedPresets.map((preset) => <article className={preset.id === loadedPresetId ? "is-selected" : ""} key={preset.id}><button className="saved-map-load" onClick={() => loadPreset(preset)}><strong>{preset.name}</strong><small>{preset.mapPackage.biome} · {preset.mapPackage.width} × {preset.mapPackage.height}{preset.id === activeMapPresetId ? " · applied" : ""}</small></button><IconActionButton className="saved-map-delete" variant="delete" label={`Delete ${preset.name}`} onClick={() => void runCommand("delete-map-preset", { presetId: preset.id }, `Deleted “${preset.name}”.`)} /></article>)}</div></section>
      </aside>
      <section className="workshop-canvas-panel" aria-label="Editable full-scene map"><div className="workshop-canvas-heading"><div><small>Cohesive full-scene draft</small><strong>{map.name} · {map.width} × {map.height}</strong></div><span>3072 × 2048 base · {dirty ? "Private until applied" : "Matches players"}</span></div><div className="workshop-canvas-frame" style={{ aspectRatio: `${map.width} / ${map.height}` }}><canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={onMapDrop} aria-label={`${map.name} draft with ${map.sceneObjects.length} matching additions`} /></div><div className="workshop-legend"><span><i className="legend-cell" />Gold outline marks the selected addition</span><span><i className="legend-grid" />Additions and annotations align to the grid</span><span>The base remains one cohesive image</span></div>{message ? <div className="workshop-message" role="status">{message}</div> : null}</section>
    </div>
  </main>;
}
