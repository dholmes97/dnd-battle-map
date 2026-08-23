"use client";

import NextImage from "next/image";
import IconActionButton from "@/app/icon-action-button";
import { ModalDialog } from "@/app/modal-dialog";
import { renderMapPackageToContext } from "@/app/map-scene-renderer";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fitGridGeometry } from "@/shared/battle-map-geometry.ts";
import { distanceToSegment, dragFogBlocker, ensureSharedFogPolygon, fogBlockerHandleAtPoint } from "@/shared/fog-of-war.ts";
import { FULL_SCENE_MAPS, createFullSceneMap } from "@/shared/full-scene-maps";
import { cloneMapPackage, type MapPackage } from "@/shared/map-package";
import type { CommandName, CommandPayload, CommandResponse, SavedMapPreset } from "@/shared/contracts";
import {
  mapNoteAt,
  mapThumbnailUrl,
  snapMapPoint,
} from "@/shared/map-workshop-domain.ts";
import {
  moveSpatialPoint,
  nearestSpatialItem,
  spatialCoordinateAnnouncement,
  spatialKeyboardIntent,
} from "@/shared/spatial-keyboard";

type Props = {
  activeMapPackage: MapPackage | null;
  activeMapPresetId: string | null;
  savedPresets: SavedMapPreset[];
  onCommand: <Name extends CommandName>(name: Name, extra: CommandPayload<Name>) => Promise<CommandResponse & { presetId?: string }>;
  onClose: () => void;
};

type Tool = "select" | "label" | "note" | "fog-add" | "vision-wall" | "vision-door" | "vision-circle";
type Point = { x: number; y: number };
type WallDrag = { pointerId: number; start: Point; kind: "vision-wall" | "vision-door" };
type FogVertexDrag = { pointerId: number; index: number; before: MapPackage };
type FogCircleDrag = { pointerId: number; center: Point };
type SelectedAnnotation = { kind: "label" | "note"; id: string };
type SelectedFogBlocker = { kind: "wall" | "door" | "circle"; id: string };
type FogBlockerTarget = SelectedFogBlocker & { handle: "start" | "end" | "body" | "radius" };
type FogBlockerDrag = { pointerId: number; target: FogBlockerTarget; start: Point; before: MapPackage };
type KeyboardAnchor = { tool: "vision-wall" | "vision-door" | "vision-circle"; point: Point };

const DEFAULT_SCENE = FULL_SCENE_MAPS[0];
const HISTORY_LIMIT = 50;

function withCanonicalBaseMapName(map: MapPackage): MapPackage {
  const baseName = FULL_SCENE_MAPS.find((scene) => scene.assetUrl === map.visual.assetUrl)?.name;
  return baseName && baseName !== map.name ? { ...map, name: baseName } : map;
}

function WorkshopHistoryIcon({ direction }: { direction: "undo" | "redo" }) {
  const path = direction === "undo"
    ? "M7 5 3.5 8.5 7 12M3.5 8.5H12a4.5 4.5 0 0 1 0 9h-3"
    : "M13 5l3.5 3.5L13 12M16.5 8.5H8a4.5 4.5 0 0 0 0 9h3";
  return <svg className="ui-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function WorkshopToolIcon({ tool }: { tool: "select" | "label" | "note" | "fog-add" | "fog-remove" | "vision-wall" | "vision-door" | "vision-circle" }) {
  if (tool === "select") return <svg className="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 2.8 15.8 10l-5.1 1.2-2.4 5.3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
  if (tool === "fog-add") return <svg className="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 15.5 8.5 4.5 16.5 13M13.5 5v6M10.5 8h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (tool === "fog-remove") return <svg className="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 15.5 8.5 4.5 16.5 13M10.5 8h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (tool === "vision-wall") return <svg className="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 15.5 17 4.5M3 15.5h.01M17 4.5h.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  if (tool === "vision-door") return <svg className="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 17V3h10v14M8 16V6l5-1v11M11.2 10.6h.01" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (tool === "label") return <svg className="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5.5h14M10 5.5v10M6.5 15.5h7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  if (tool === "note") return <svg className="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3.5h12v9l-4 4H4zM12 16.5v-4h4M7 7h6M7 10h4" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg className="ui-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

function WorkshopActionIcon({ action }: { action: "discard" | "apply" | "return" }) {
  const path = action === "discard"
    ? "M5 5l10 10M15 5 5 15"
    : action === "apply"
      ? "M4.5 10.2 8.2 14l7.3-8"
      : "M8 4 2.5 10 8 16M3 10h14";
  return <svg className="ui-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

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

export default function MapWorkshop({ activeMapPackage, activeMapPresetId, savedPresets, onCommand, onClose }: Props) {
  const initial = useMemo(() => withCanonicalBaseMapName(cloneMapPackage(activeMapPackage ?? createFullSceneMap(DEFAULT_SCENE))), [activeMapPackage]);
  const initialPresetName = savedPresets.find((preset) => preset.id === activeMapPresetId)?.name ?? initial.name;
  const [map, setMap] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedAnnotation, setSelectedAnnotation] = useState<SelectedAnnotation | null>(null);
  const [labelText, setLabelText] = useState("");
  const [labelVisibility, setLabelVisibility] = useState<"dm" | "everyone">("everyone");
  const [noteText, setNoteText] = useState("");
  const [presetName, setPresetName] = useState(initialPresetName);
  const savedDraftRef = useRef(`${initialPresetName}\n${JSON.stringify(initial)}`);
  const [loadedPresetId, setLoadedPresetId] = useState<string | null>(activeMapPresetId);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [baseMapChooserOpen, setBaseMapChooserOpen] = useState(false);
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [wallPreview, setWallPreview] = useState<{ start: Point; end: Point } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  const [exitPrompt, setExitPrompt] = useState<"discard" | "return" | null>(null);
  const [keyboardCursor, setKeyboardCursor] = useState<Point | null>(null);
  const [keyboardAnchor, setKeyboardAnchor] = useState<KeyboardAnchor | null>(null);
  const [keyboardGrabBefore, setKeyboardGrabBefore] = useState<MapPackage | null>(null);
  const [keyboardStatus, setKeyboardStatus] = useState("");

  const selectedLabel = selectedAnnotation?.kind === "label" ? map.labels.find((label) => label.id === selectedAnnotation.id) ?? null : null;
  const selectedNote = selectedAnnotation?.kind === "note" ? map.notes.find((note) => note.id === selectedAnnotation.id) ?? null : null;
  const selectedFogDoor = selectedFogBlocker?.kind === "door" ? map.fog.doors.find((door) => door.id === selectedFogBlocker.id) ?? null : null;
  const selectedFogWall = selectedFogBlocker?.kind === "wall" ? map.fog.walls.find((wall) => wall.id === selectedFogBlocker.id) ?? null : null;
  const selectedFogCircle = selectedFogBlocker?.kind === "circle" ? map.fog.circles.find((circle) => circle.id === selectedFogBlocker.id) ?? null : null;
  const baseMap = FULL_SCENE_MAPS.find((definition) => definition.assetUrl === map.visual.assetUrl) ?? DEFAULT_SCENE;
  const assetPaths = useMemo(() => [map.visual.assetUrl], [map.visual.assetUrl]);

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
    if (keyboardCursor) {
      const x = screenX(keyboardCursor.x); const y = screenY(keyboardCursor.y);
      const radius = Math.max(8, Math.min(cellWidth, cellHeight) * 0.28);
      context.save(); context.fillStyle = "rgba(22, 18, 12, 0.72)"; context.strokeStyle = "#fff2bd"; context.lineWidth = 2; context.setLineDash([4, 3]);
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill(); context.stroke(); context.setLineDash([]);
      context.beginPath(); context.moveTo(x - radius - 5, y); context.lineTo(x + radius + 5, y); context.moveTo(x, y - radius - 5); context.lineTo(x, y + radius + 5); context.stroke(); context.restore();
    }
    if (wallPreview) {
      context.strokeStyle = "#f5c65c"; context.lineWidth = 3; context.setLineDash([7, 5]);
      context.beginPath(); context.moveTo(screenX(wallPreview.start.x), screenY(wallPreview.start.y)); context.lineTo(screenX(wallPreview.end.x), screenY(wallPreview.end.y)); context.stroke(); context.setLineDash([]);
    }
  }, [fogCirclePreview, images, keyboardCursor, map, selectedFogBlocker, selectedFogVertex, selectedLabel, selectedNote, wallPreview]);

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
  const replaceDraft = (next: MapPackage, changed: boolean, nextPresetName = next.name, saved = true) => {
    const canonical = withCanonicalBaseMapName(cloneMapPackage(next));
    setMap(canonical); setDirty(changed); setPresetName(nextPresetName); setSelectedAnnotation(null); setSelectedFogVertex(null); setSelectedFogBlocker(null); setBaseMapChooserOpen(false); setTool("select"); undoRef.current = []; redoRef.current = []; setHistoryCounts({ undo: 0, redo: 0 });
    if (saved) savedDraftRef.current = `${nextPresetName}\n${JSON.stringify(canonical)}`;
  };
  const undo = useCallback(() => {
    const previous = undoRef.current.pop(); if (!previous) return;
    redoRef.current.push(cloneMapPackage(map)); setMap(previous); setDirty(true); setSelectedAnnotation(null); setHistoryCounts({ undo: undoRef.current.length, redo: redoRef.current.length });
  }, [map]);
  const redo = useCallback(() => {
    const next = redoRef.current.pop(); if (!next) return;
    undoRef.current.push(cloneMapPackage(map)); setMap(next); setDirty(true); setSelectedAnnotation(null); setHistoryCounts({ undo: undoRef.current.length, redo: redoRef.current.length });
  }, [map]);

  useEffect(() => {
    const onHistoryShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select")) return;
      const key = event.key.toLocaleLowerCase();
      const modifier = event.metaKey || event.ctrlKey;
      const wantsUndo = modifier && key === "z" && !event.shiftKey;
      const wantsRedo = (modifier && key === "z" && event.shiftKey) || (event.ctrlKey && !event.metaKey && key === "y");
      if (wantsUndo && historyCounts.undo > 0) { event.preventDefault(); undo(); }
      else if (wantsRedo && historyCounts.redo > 0) { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onHistoryShortcut);
    return () => window.removeEventListener("keydown", onHistoryShortcut);
  }, [historyCounts.redo, historyCounts.undo, redo, undo]);

  const runCommand = async <Name extends CommandName>(name: Name, extra: CommandPayload<Name>, success: string) => {
    setBusy(true); setMessage("");
    try { const result = await onCommand(name, extra); setMessage(success); return result; }
    catch (error) { setMessage(error instanceof Error ? error.message : "The map action was rejected."); return null; }
    finally { setBusy(false); }
  };

  const chooseScene = (definition: (typeof FULL_SCENE_MAPS)[number]) => {
    if (definition.assetUrl === map.visual.assetUrl) return;
    const hasUnsavedPresetWork = savedDraftRef.current !== `${presetName}\n${JSON.stringify(map)}`;
    if (hasUnsavedPresetWork && !window.confirm("Change the base map? Your current workshop changes have not been saved to a preset and will be lost. Save or update the preset first if you want to keep its vision walls, doors, blockers, labels, and notes.")) return;
    const next = createFullSceneMap(definition); replaceDraft(next, true, next.name, false); setLoadedPresetId(null);
    setMessage(`Loaded “${next.name}” as a private draft.`);
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event.currentTarget, map, event.clientX, event.clientY);
    if (tool === "select" && map.fog.mode === "shared") {
      const index = map.fog.sharedPolygon.reduce((best, vertex, current) => Math.hypot(point.x - vertex.x, point.y - vertex.y) < Math.hypot(point.x - map.fog.sharedPolygon[best].x, point.y - map.fog.sharedPolygon[best].y) ? current : best, 0);
      if (Math.hypot(point.x - map.fog.sharedPolygon[index].x, point.y - map.fog.sharedPolygon[index].y) <= 0.7) {
        setSelectedFogVertex(index); fogVertexDragRef.current = { pointerId: event.pointerId, index, before: cloneMapPackage(map) }; event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (tool === "fog-add" && map.fog.mode === "shared") {
      const snapped = snapMapPoint(point);
      let insertAfter = 0; let closest = Infinity;
      map.fog.sharedPolygon.forEach((start, index) => {
        const end = map.fog.sharedPolygon[(index + 1) % map.fog.sharedPolygon.length]; const distance = distanceToSegment(snapped, start, end);
        if (distance < closest) { closest = distance; insertAfter = index; }
      });
      commit((current) => ({ ...current, fog: { ...current.fog, sharedPolygon: [...current.fog.sharedPolygon.slice(0, insertAfter + 1), snapped, ...current.fog.sharedPolygon.slice(insertAfter + 1)] } }));
      setSelectedFogVertex(insertAfter + 1); setTool("select"); return;
    }
    if (tool === "select" && map.fog.mode === "dynamic") {
      const tolerance = Math.max(0.2, 10 / (event.currentTarget.getBoundingClientRect().width / map.width));
      const target = fogBlockerHandleAtPoint(map.fog, point, tolerance, selectedFogBlocker) as FogBlockerTarget | null;
      setSelectedFogBlocker(target ? { kind: target.kind, id: target.id } : null);
      if (target) {
        fogBlockerDragRef.current = { pointerId: event.pointerId, target, start: freeFogPoint(point), before: cloneMapPackage(map) };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
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
        return;
      }
      setSelectedAnnotation(null);
      return;
    }
    const location = snapMapPoint(point); const id = crypto.randomUUID();
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
    const wallDrag = wallDragRef.current;
    if (wallDrag?.pointerId === event.pointerId) setWallPreview({ start: wallDrag.start, end: freeFogPoint(point) });
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
      if (radius >= 0.25) { const id = crypto.randomUUID(); commit((current) => ({ ...current, fog: { ...current.fog, circles: [...current.fog.circles, { id, x: fogCircleDrag.center.x, y: fogCircleDrag.center.y, radius: Math.round(radius * 20) / 20 }] } })); setSelectedFogBlocker({ kind: "circle", id }); setTool("select"); }
    }
    const wallDrag = wallDragRef.current;
    if (wallDrag?.pointerId === event.pointerId) {
      const rawEnd = canvasPoint(event.currentTarget, map, event.clientX, event.clientY); const end = freeFogPoint(rawEnd); wallDragRef.current = null; setWallPreview(null);
      if (end.x !== wallDrag.start.x || end.y !== wallDrag.start.y) {
        const id = crypto.randomUUID();
        commit((current) => ({ ...current, fog: { ...current.fog, [wallDrag.kind === "vision-door" ? "doors" : "walls"]: [...current.fog[wallDrag.kind === "vision-door" ? "doors" : "walls"], { id, x1: wallDrag.start.x, y1: wallDrag.start.y, x2: end.x, y2: end.y, ...(wallDrag.kind === "vision-door" ? { open: false } : {}) }] } }));
        setSelectedFogBlocker({ kind: wallDrag.kind === "vision-door" ? "door" : "wall", id }); setTool("select");
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const deleteObject = (collection: "walls" | "portals" | "labels" | "notes", id: string) => {
    commit((current) => ({ ...current, [collection]: current[collection].filter((item) => item.id !== id) }));
    if (selectedAnnotation?.id === id) setSelectedAnnotation(null);
  };
  const deleteSelectedAnnotation = () => {
    if (!selectedAnnotation) return;
    deleteObject(selectedAnnotation.kind === "label" ? "labels" : "notes", selectedAnnotation.id);
  };
  const setFogMode = (mode: MapPackage["fog"]["mode"]) => {
    commit((current) => ({ ...current, fog: { ...current.fog, mode, sharedPolygon: mode === "shared" ? ensureSharedFogPolygon(current.fog.sharedPolygon, current.width, current.height) : current.fog.sharedPolygon } }));
    setSelectedFogVertex(null); setSelectedFogBlocker(null); setTool("select");
  };
  const resetSharedFog = () => {
    if (!window.confirm("Reset shared fog? This replaces the current fog boundary with the default eight corners. Your custom corner positions will be lost.")) return;
    commit((current) => ({ ...current, fog: { ...current.fog, sharedPolygon: ensureSharedFogPolygon([{ x: 0, y: 0 }, { x: current.width, y: 0 }, { x: current.width, y: current.height }, { x: 0, y: current.height }], current.width, current.height) } }));
    setSelectedFogVertex(0); setTool("select");
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

  const selectAtKeyboardCursor = (point: Point, canvas: HTMLCanvasElement) => {
    setSelectedAnnotation(null); setSelectedFogVertex(null); setSelectedFogBlocker(null);
    if (map.fog.mode === "shared") {
      const vertex = nearestSpatialItem(point, map.fog.sharedPolygon.map((item, index) => ({ ...item, id: String(index) })), 0.8);
      if (vertex) { const index = Number(vertex.id); setSelectedFogVertex(index); setKeyboardCursor(map.fog.sharedPolygon[index]); setKeyboardStatus(`Fog corner ${index + 1} selected. Press Space to grab it, or Delete to remove it.`); return; }
    }
    if (map.fog.mode === "dynamic") {
      const target = fogBlockerHandleAtPoint(map.fog, point, 0.55, selectedFogBlocker) as FogBlockerTarget | null;
      if (target) { setSelectedFogBlocker({ kind: target.kind, id: target.id }); setKeyboardStatus(`${target.kind} selected. Press Space to grab it; use the geometry fields for endpoints or radius.`); return; }
    }
    const note = mapNoteAt(map, point);
    const label = note ? null : labelAt(canvas, map, point);
    if (note || label) {
      setSelectedAnnotation({ kind: note ? "note" : "label", id: (note ?? label)!.id });
      setKeyboardStatus(`${note ? "DM note" : `Label ${(label?.text ?? "").slice(0, 40)}`} selected. Press Space to grab it, or Delete to remove it.`);
      return;
    }
    setKeyboardStatus(`No editable object is at ${spatialCoordinateAnnouncement(point)}.`);
  };

  const moveKeyboardSelection = (dx: number, dy: number) => {
    setMap((current) => {
      if (selectedAnnotation) {
        const collection = selectedAnnotation.kind === "label" ? "labels" : "notes";
        return { ...current, [collection]: current[collection].map((item) => item.id === selectedAnnotation.id ? {
          ...item,
          x: Math.max(0, Math.min(current.width, item.x + dx)),
          y: Math.max(0, Math.min(current.height, item.y + dy)),
        } : item) };
      }
      if (selectedFogVertex !== null) {
        return { ...current, fog: { ...current.fog, sharedPolygon: current.fog.sharedPolygon.map((item, index) => index === selectedFogVertex ? {
          x: Math.max(0, Math.min(current.width, item.x + dx)),
          y: Math.max(0, Math.min(current.height, item.y + dy)),
        } : item) } };
      }
      if (!selectedFogBlocker) return current;
      if (selectedFogBlocker.kind === "circle") {
        return { ...current, fog: { ...current.fog, circles: current.fog.circles.map((circle) => circle.id === selectedFogBlocker.id ? {
          ...circle,
          x: Math.max(circle.radius, Math.min(current.width - circle.radius, circle.x + dx)),
          y: Math.max(circle.radius, Math.min(current.height - circle.radius, circle.y + dy)),
        } : circle) } };
      }
      const collection = selectedFogBlocker.kind === "door" ? "doors" : "walls";
      return { ...current, fog: { ...current.fog, [collection]: current.fog[collection].map((line) => {
        if (line.id !== selectedFogBlocker.id) return line;
        const boundedDx = Math.max(-Math.min(line.x1, line.x2), Math.min(current.width - Math.max(line.x1, line.x2), dx));
        const boundedDy = Math.max(-Math.min(line.y1, line.y2), Math.min(current.height - Math.max(line.y1, line.y2), dy));
        return { ...line, x1: line.x1 + boundedDx, y1: line.y1 + boundedDy, x2: line.x2 + boundedDx, y2: line.y2 + boundedDy };
      }) } };
    });
  };

  const finishKeyboardGrab = (save: boolean) => {
    const before = keyboardGrabBefore;
    if (!before) return;
    if (save) { if (JSON.stringify(before) !== JSON.stringify(map)) { remember(before); setDirty(true); } }
    else setMap(before);
    setKeyboardGrabBefore(null);
    setKeyboardStatus(save ? "Keyboard move saved to the private draft." : "Keyboard move cancelled. The draft was restored.");
  };

  const onCanvasFocus = () => {
    const point = keyboardCursor ?? { x: Math.floor(map.width / 2) + 0.5, y: Math.floor(map.height / 2) + 0.5 };
    setKeyboardCursor(point);
    setKeyboardStatus(`Workshop keyboard active at ${spatialCoordinateAnnouncement(point)}. Arrow keys move the cursor; Enter activates the current tool; Space grabs or drops a selected object; Escape cancels.`);
  };

  const onCanvasKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (event.metaKey || event.ctrlKey) return;
    const intent = spatialKeyboardIntent(event);
    if (!intent) return;
    const point = keyboardCursor ?? { x: Math.floor(map.width / 2) + 0.5, y: Math.floor(map.height / 2) + 0.5 };
    if (intent.kind === "move") {
      event.preventDefault();
      if (keyboardGrabBefore) {
        moveKeyboardSelection(intent.dx * intent.step, intent.dy * intent.step);
        setKeyboardStatus(`Selected object preview moved ${intent.step} cell${intent.step === 1 ? "" : "s"}. Press Enter or Space to save; Escape cancels.`);
        return;
      }
      const next = moveSpatialPoint(point, intent, { width: map.width, height: map.height });
      setKeyboardCursor(next);
      if (keyboardAnchor?.tool === "vision-circle") setFogCirclePreview({ center: keyboardAnchor.point, radius: Math.max(0.25, Math.hypot(next.x - keyboardAnchor.point.x, next.y - keyboardAnchor.point.y)) });
      else if (keyboardAnchor) setWallPreview({ start: keyboardAnchor.point, end: next });
      setKeyboardStatus(`Workshop cursor at ${spatialCoordinateAnnouncement(next)}.`);
      return;
    }
    if (intent.kind === "grab") {
      event.preventDefault();
      if (keyboardGrabBefore) { finishKeyboardGrab(true); return; }
      if (!selectedAnnotation && selectedFogVertex === null && !selectedFogBlocker) { setKeyboardStatus("Select an editable object before grabbing it."); return; }
      setKeyboardGrabBefore(cloneMapPackage(map));
      setKeyboardStatus("Object grabbed. Arrow keys move it; Shift plus arrows moves five cells; Enter or Space saves; Escape cancels.");
      return;
    }
    if (intent.kind === "cancel") {
      if (!keyboardGrabBefore && !keyboardAnchor) return;
      event.preventDefault();
      if (keyboardGrabBefore) finishKeyboardGrab(false);
      setKeyboardAnchor(null); setWallPreview(null); setFogCirclePreview(null);
      setKeyboardStatus("Keyboard action cancelled. The private draft was not changed.");
      return;
    }
    if (intent.kind === "delete") {
      event.preventDefault();
      if (selectedAnnotation) deleteSelectedAnnotation();
      else deleteSelectedFogItem();
      setKeyboardStatus("Selected object deleted from the private draft. Undo is available.");
      return;
    }
    if (intent.kind === "pan" || intent.kind === "zoom" || intent.kind === "altitude") return;
    if (intent.kind !== "activate") return;
    event.preventDefault();
    if (keyboardGrabBefore) { finishKeyboardGrab(true); return; }
    if (keyboardAnchor) {
      const distance = Math.hypot(point.x - keyboardAnchor.point.x, point.y - keyboardAnchor.point.y);
      if (distance < 0.25) { setKeyboardStatus("Move at least one quarter cell from the anchor before finishing this shape."); return; }
      const id = crypto.randomUUID();
      if (keyboardAnchor.tool === "vision-circle") {
        commit((current) => ({ ...current, fog: { ...current.fog, circles: [...current.fog.circles, { id, x: keyboardAnchor.point.x, y: keyboardAnchor.point.y, radius: Math.round(distance * 20) / 20 }] } }));
        setSelectedFogBlocker({ kind: "circle", id });
      } else {
        const kind = keyboardAnchor.tool === "vision-door" ? "door" : "wall";
        const collection = kind === "door" ? "doors" : "walls";
        commit((current) => ({ ...current, fog: { ...current.fog, [collection]: [...current.fog[collection], { id, x1: keyboardAnchor.point.x, y1: keyboardAnchor.point.y, x2: point.x, y2: point.y, ...(kind === "door" ? { open: false } : {}) }] } }));
        setSelectedFogBlocker({ kind, id });
      }
      setKeyboardAnchor(null); setWallPreview(null); setFogCirclePreview(null); setTool("select");
      setKeyboardStatus("Vision geometry created and selected. Undo is available.");
      return;
    }
    if (tool === "select") { selectAtKeyboardCursor(point, event.currentTarget); return; }
    if (tool === "label" || tool === "note") {
      const text = tool === "label" ? labelText.trim().slice(0, 120) : noteText.trim().slice(0, 500);
      if (!text) { setKeyboardStatus(`Enter ${tool === "label" ? "label text" : "a private note"} before placing it.`); return; }
      const location = snapMapPoint(point); const id = crypto.randomUUID();
      if (tool === "label") { commit((current) => ({ ...current, labels: [...current.labels, { id, ...location, text, visibility: labelVisibility }] })); setSelectedAnnotation({ kind: "label", id }); }
      else { commit((current) => ({ ...current, notes: [...current.notes, { id, ...location, text }] })); setSelectedAnnotation({ kind: "note", id }); }
      setKeyboardStatus(`${tool === "label" ? "Label" : "DM note"} created at ${spatialCoordinateAnnouncement(location)}. The tool remains active.`);
      return;
    }
    if (tool === "fog-add" && map.fog.mode === "shared") {
      const location = snapMapPoint(point); let insertAfter = 0; let closest = Infinity;
      map.fog.sharedPolygon.forEach((start, index) => { const end = map.fog.sharedPolygon[(index + 1) % map.fog.sharedPolygon.length]; const distance = distanceToSegment(location, start, end); if (distance < closest) { closest = distance; insertAfter = index; } });
      commit((current) => ({ ...current, fog: { ...current.fog, sharedPolygon: [...current.fog.sharedPolygon.slice(0, insertAfter + 1), location, ...current.fog.sharedPolygon.slice(insertAfter + 1)] } }));
      setSelectedFogVertex(insertAfter + 1); setTool("select"); setKeyboardStatus(`Fog corner created at ${spatialCoordinateAnnouncement(location)}.`); return;
    }
    if ((tool === "vision-wall" || tool === "vision-door" || tool === "vision-circle") && map.fog.mode === "dynamic") {
      setKeyboardAnchor({ tool, point: freeFogPoint(point) });
      if (tool === "vision-circle") setFogCirclePreview({ center: point, radius: 0.25 }); else setWallPreview({ start: point, end: point });
      setKeyboardStatus(`${tool === "vision-circle" ? "Round blocker center" : tool === "vision-door" ? "Vision door start" : "Vision wall start"} set. Move the cursor and press Enter to finish; Escape cancels.`);
    }
  };

  const updateSelectedAnnotationCoordinate = (axis: "x" | "y", value: number) => {
    if (!selectedAnnotation || !Number.isFinite(value)) return;
    const collection = selectedAnnotation.kind === "label" ? "labels" : "notes";
    commit((current) => ({ ...current, [collection]: current[collection].map((item) => item.id === selectedAnnotation.id ? { ...item, [axis]: Math.max(0, Math.min(axis === "x" ? current.width : current.height, value)) } : item) }));
  };
  const updateSelectedFogVertexCoordinate = (axis: "x" | "y", value: number) => {
    if (selectedFogVertex === null || !Number.isFinite(value)) return;
    commit((current) => ({ ...current, fog: { ...current.fog, sharedPolygon: current.fog.sharedPolygon.map((item, index) => index === selectedFogVertex ? { ...item, [axis]: Math.max(0, Math.min(axis === "x" ? current.width : current.height, value)) } : item) } }));
  };
  const updateSelectedBlockerCoordinate = (field: "x1" | "y1" | "x2" | "y2" | "x" | "y" | "radius", value: number) => {
    if (!selectedFogBlocker || !Number.isFinite(value)) return;
    if (selectedFogBlocker.kind === "circle") {
      commit((current) => ({ ...current, fog: { ...current.fog, circles: current.fog.circles.map((circle) => circle.id === selectedFogBlocker.id ? { ...circle, [field]: field === "radius" ? Math.max(0.25, Math.min(Math.min(current.width, current.height) / 2, value)) : Math.max(0, Math.min(field === "x" ? current.width : current.height, value)) } : circle) } }));
      return;
    }
    const collection = selectedFogBlocker.kind === "door" ? "doors" : "walls";
    commit((current) => ({ ...current, fog: { ...current.fog, [collection]: current.fog[collection].map((line) => line.id === selectedFogBlocker.id ? { ...line, [field]: Math.max(0, Math.min(field.startsWith("x") ? current.width : current.height, value)) } : line) } }));
  };

  const savePreset = async () => {
    const name = presetName.trim() || map.name; const result = await runCommand("save-map-preset", { presetId: loadedPresetId || undefined, name, description: map.description, mapPackage: map }, loadedPresetId ? `Updated “${name}”.` : `Saved “${name}”.`);
    setPresetName(name);
    if (!loadedPresetId && result?.presetId) setLoadedPresetId(result.presetId);
    if (result) savedDraftRef.current = `${name}\n${JSON.stringify(map)}`;
  };
  const deletePreset = async (preset: SavedMapPreset) => {
    const warning = `Delete “${preset.name}”? This permanently removes its prepared vision walls, doors, round blockers, labels, and notes from the preset library. This cannot be undone.`;
    if (!window.confirm(warning)) return;
    const result = await runCommand("delete-map-preset", { presetId: preset.id }, `Deleted “${preset.name}”.`);
    if (result && loadedPresetId === preset.id) { setLoadedPresetId(null); setPresetName(map.name); }
  };
  const apply = async () => { const result = await runCommand("apply-map-package", { mapPackage: map, presetId: loadedPresetId || undefined }, `Applied “${map.name}”. Players now receive this scene.`); if (result) setDirty(false); return Boolean(result); };
  const discard = () => { const next = activeMapPackage ?? createFullSceneMap(DEFAULT_SCENE); const activePresetName = savedPresets.find((preset) => preset.id === activeMapPresetId)?.name ?? next.name; replaceDraft(next, false, activePresetName); setLoadedPresetId(activeMapPresetId); setMessage("Discarded private changes and restored the applied scene."); };
  const requestDiscard = () => { if (dirty) setExitPrompt("discard"); };
  const requestReturn = () => { if (dirty) { setMessage(""); setExitPrompt("return"); } else onClose(); };
  const discardAndReturn = () => { discard(); setExitPrompt(null); onClose(); };
  const applyAndReturn = async () => { if (await apply()) { setExitPrompt(null); onClose(); } };
  const loadPreset = (preset: SavedMapPreset) => { replaceDraft(preset.mapPackage, preset.id !== activeMapPresetId, preset.name); setLoadedPresetId(preset.id); setMessage(`Loaded “${preset.name}” into the private workshop.`); };
  return <main className="workshop-shell">
    <header className="workshop-header">
      <div className="workshop-header-tools">
        <div className="workshop-visibility-toolbar" aria-label="Visibility setup">
          <label className="workshop-visibility-mode"><span className="visually-hidden">Visibility</span><select aria-label="Visibility mode" value={map.fog.mode} onChange={(event) => setFogMode(event.target.value as MapPackage["fog"]["mode"])}><option value="off">No fog</option><option value="shared">DM controlled</option><option value="dynamic">Player vision</option></select></label>
          <div className="workshop-visibility-tools" role="toolbar" aria-label="Map editing tools">
            <button className={tool === "select" ? "workshop-icon-tool is-active" : "workshop-icon-tool"} aria-label="Select map elements" aria-pressed={tool === "select"} data-tooltip={map.fog.mode === "dynamic" ? "Select: drag a blocker to move it, or drag either endpoint to reshape it" : map.fog.mode === "shared" ? "Select and drag shared-fog corners" : "Select and move map elements"} onClick={() => setTool("select")}><WorkshopToolIcon tool="select" /></button>
            {map.fog.mode === "shared" ? <button className={tool === "fog-add" ? "workshop-icon-tool is-active" : "workshop-icon-tool"} aria-label="Add fog corner" aria-pressed={tool === "fog-add"} data-tooltip="Add a shared-fog corner" onClick={() => setTool("fog-add")}><WorkshopToolIcon tool="fog-add" /></button> : null}
            {map.fog.mode === "shared" ? <button className="workshop-icon-tool" aria-label="Remove selected fog corner" data-tooltip="Remove selected fog corner" disabled={selectedFogVertex === null || map.fog.sharedPolygon.length <= 3} onClick={deleteSelectedFogItem}><WorkshopToolIcon tool="fog-remove" /></button> : null}
            {map.fog.mode === "dynamic" ? <>
              <button className={tool === "vision-wall" ? "workshop-icon-tool is-active" : "workshop-icon-tool"} aria-label="Vision wall" aria-pressed={tool === "vision-wall"} data-tooltip="Draw a vision wall. Windows need no vision blocker—leave a gap." onClick={() => setTool("vision-wall")}><WorkshopToolIcon tool="vision-wall" /></button>
              <button className={tool === "vision-door" ? "workshop-icon-tool is-active" : "workshop-icon-tool"} aria-label="Vision door" aria-pressed={tool === "vision-door"} data-tooltip="Draw a vision door" onClick={() => setTool("vision-door")}><WorkshopToolIcon tool="vision-door" /></button>
              <button className={tool === "vision-circle" ? "workshop-icon-tool is-active" : "workshop-icon-tool"} aria-label="Round blocker" aria-pressed={tool === "vision-circle"} data-tooltip="Draw a round blocker" onClick={() => setTool("vision-circle")}><WorkshopToolIcon tool="vision-circle" /></button>
            </> : null}
          </div>
          {map.fog.mode === "shared" ? <div className="workshop-visibility-actions"><button onClick={resetSharedFog}>Reset fog</button></div> : null}
          {map.fog.mode === "dynamic" && selectedFogBlocker ? <div className="workshop-visibility-actions is-selection"><span>Selected {selectedFogBlocker.kind}</span>{selectedFogDoor ? <button onClick={toggleSelectedVisionDoor}>{selectedFogDoor.open ? "Close door" : "Open door"}</button> : null}<button className="is-danger" onClick={deleteSelectedFogItem}>Delete</button></div> : null}
        </div>
        <div className="workshop-annotation-tools" role="toolbar" aria-label="Map labels and notes">
          <button className={tool === "label" ? "workshop-icon-tool is-active" : "workshop-icon-tool"} aria-label="Add map label" aria-pressed={tool === "label"} data-tooltip="Add a label" onClick={() => setTool("label")}><WorkshopToolIcon tool="label" /></button>
          <button className={tool === "note" ? "workshop-icon-tool is-active" : "workshop-icon-tool"} aria-label="Add DM note" aria-pressed={tool === "note"} data-tooltip="Add a private DM note" onClick={() => setTool("note")}><WorkshopToolIcon tool="note" /></button>
        </div>
        <div className="workshop-history-tools" role="group" aria-label="Draft history"><button className="workshop-icon-tool" aria-label="Undo draft change" data-tooltip="Undo — Ctrl/Cmd + Z" disabled={!historyCounts.undo} onClick={undo}><WorkshopHistoryIcon direction="undo" /></button><button className="workshop-icon-tool" aria-label="Redo draft change" data-tooltip="Redo — Ctrl + Y or Cmd + Shift + Z" disabled={!historyCounts.redo} onClick={redo}><WorkshopHistoryIcon direction="redo" /></button></div>
      </div>
      <div className="workshop-header-title"><strong>{presetName.trim() || map.name}</strong><span>Map workshop</span></div>
      <div className="workshop-header-actions"><span className={dirty ? "draft-status is-dirty" : "draft-status"}>{dirty ? "Private changes" : "Matches players"}</span><div className="workshop-action-tools" role="group" aria-label="Workshop actions"><button className="workshop-icon-tool" aria-label="Discard private changes" data-tooltip="Discard private changes" disabled={!dirty || busy} onClick={requestDiscard}><WorkshopActionIcon action="discard" /></button><button className="workshop-icon-tool is-primary" aria-label="Apply to players" data-tooltip="Apply this map to players" disabled={busy} onClick={() => void apply()}><WorkshopActionIcon action="apply" /></button><button className="workshop-icon-tool" aria-label="Return to battle map" data-tooltip="Return to battle map" disabled={busy} onClick={requestReturn}><WorkshopActionIcon action="return" /></button></div></div>
    </header>
    <div className="workshop-layout">
      <aside className="workshop-controls" aria-label="Map Workshop controls">
        <section className="map-library-panel"><div className="workshop-section-heading"><small>Map presets</small><strong>Save and load</strong></div><label>Preset name<input value={presetName} maxLength={72} onChange={(event) => setPresetName(event.target.value)} /></label><label>Description<textarea value={map.description} maxLength={500} rows={2} onChange={(event) => commit((current) => ({ ...current, description: event.target.value }))} /></label><div className="button-row"><button className="primary-button" disabled={busy} onClick={() => void savePreset()}>{loadedPresetId ? "Update preset" : "Save preset"}</button></div><div className="saved-map-list">{savedPresets.map((preset) => <article className={preset.id === loadedPresetId ? "is-selected" : ""} key={preset.id}><button className="saved-map-load" onClick={() => loadPreset(preset)}><strong>{preset.name}</strong><small>{withCanonicalBaseMapName(preset.mapPackage).name} · {preset.mapPackage.width} × {preset.mapPackage.height}{preset.id === activeMapPresetId ? " · applied" : ""}</small></button><IconActionButton className="saved-map-delete" variant="delete" label={`Delete ${preset.name}`} onClick={() => void deletePreset(preset)} /></article>)}</div></section>
        <section className="base-map-panel"><div className="workshop-section-heading"><strong>Base map</strong></div><div className="current-base-map"><NextImage src={mapThumbnailUrl(baseMap.assetUrl)} alt="" width={96} height={64} unoptimized /><span><strong>{baseMap.name}</strong><small>{baseMap.biome} · {baseMap.width ?? 24} × {baseMap.height ?? 16}</small></span></div><button className="secondary-button" onClick={() => setBaseMapChooserOpen((open) => !open)}>{baseMapChooserOpen ? "Cancel change" : "Change base map"}</button>{baseMapChooserOpen ? <div className="full-scene-list" aria-label="Choose a different base map">{FULL_SCENE_MAPS.map((definition) => <button key={definition.id} className={map.visual.assetUrl === definition.assetUrl ? "is-active" : ""} onClick={() => chooseScene(definition)}><NextImage src={mapThumbnailUrl(definition.assetUrl)} alt="" width={96} height={64} loading="lazy" unoptimized /><span><strong>{definition.name}</strong><small>{definition.biome} · {definition.width ?? 24} × {definition.height ?? 16}</small></span></button>)}</div> : null}</section>
        {tool === "label" || tool === "note" ? <section><div className="workshop-section-heading"><small>Active tool</small><strong>{tool === "label" ? "Add label" : "Add DM note"}</strong></div>
          {tool === "label" ? <div className="structure-options"><label>Text<input value={labelText} onChange={(event) => setLabelText(event.target.value)} /></label><label>Visible to<select value={labelVisibility} onChange={(event) => setLabelVisibility(event.target.value as "dm" | "everyone")}><option value="everyone">Everyone</option><option value="dm">DM only</option></select></label><p className="workshop-help">Enter text, then click the scene or focus the map and press Enter.</p></div> : null}
          {tool === "note" ? <div className="structure-options"><label>Private note<textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} rows={3} /></label><p className="workshop-help">Enter a note, then click its location or focus the map and press Enter.</p></div> : null}
        </section> : null}
        <details className="map-object-list"><summary>Map details <span>{map.walls.length + map.portals.length + map.labels.length + map.notes.length}</span></summary>
          {map.walls.map((wall, index) => <div key={wall.id}><span>Wall {index + 1}</span><IconActionButton variant="delete" label={`Delete wall ${index + 1}`} onClick={() => deleteObject("walls", wall.id)} /></div>)}
          {map.portals.map((portal, index) => <div key={portal.id}><span>{portal.kind} {index + 1}<small>{portal.orientation}</small></span><IconActionButton variant="delete" label={`Delete ${portal.kind} ${index + 1}`} onClick={() => deleteObject("portals", portal.id)} /></div>)}
          {map.labels.map((label, index) => <div key={label.id}><button className="map-object-select" aria-pressed={selectedAnnotation?.kind === "label" && selectedAnnotation.id === label.id} onClick={() => { setSelectedAnnotation({ kind: "label", id: label.id }); setSelectedFogVertex(null); setSelectedFogBlocker(null); }}><span>{label.text}<small>{label.visibility} · x {label.x}, y {label.y}</small></span></button><IconActionButton variant="delete" label={`Delete label ${index + 1}`} onClick={() => deleteObject("labels", label.id)} /></div>)}
          {map.notes.map((note, index) => <div key={note.id}><button className="map-object-select" aria-pressed={selectedAnnotation?.kind === "note" && selectedAnnotation.id === note.id} onClick={() => { setSelectedAnnotation({ kind: "note", id: note.id }); setSelectedFogVertex(null); setSelectedFogBlocker(null); }}><span>DM note {index + 1}<small>{note.text} · x {note.x}, y {note.y}</small></span></button><IconActionButton variant="delete" label={`Delete note ${index + 1}`} onClick={() => deleteObject("notes", note.id)} /></div>)}
        </details>
        <details className="map-object-list vision-object-list"><summary>Vision geometry <span>{map.fog.mode === "shared" ? map.fog.sharedPolygon.length : map.fog.walls.length + map.fog.doors.length + map.fog.circles.length}</span></summary>
          {map.fog.mode === "shared" ? map.fog.sharedPolygon.map((point, index) => <div key={`fog-corner-${index}`}><button className="map-object-select" aria-pressed={selectedFogVertex === index} onClick={() => { setSelectedFogVertex(index); setSelectedAnnotation(null); setSelectedFogBlocker(null); }}><span>Fog corner {index + 1}<small>x {point.x}, y {point.y}</small></span></button></div>) : null}
          {map.fog.mode === "dynamic" ? <>{map.fog.walls.map((wall, index) => <div key={wall.id}><button className="map-object-select" aria-pressed={selectedFogBlocker?.kind === "wall" && selectedFogBlocker.id === wall.id} onClick={() => { setSelectedFogBlocker({ kind: "wall", id: wall.id }); setSelectedAnnotation(null); setSelectedFogVertex(null); }}><span>Vision wall {index + 1}<small>{wall.x1}, {wall.y1} to {wall.x2}, {wall.y2}</small></span></button></div>)}{map.fog.doors.map((door, index) => <div key={door.id}><button className="map-object-select" aria-pressed={selectedFogBlocker?.kind === "door" && selectedFogBlocker.id === door.id} onClick={() => { setSelectedFogBlocker({ kind: "door", id: door.id }); setSelectedAnnotation(null); setSelectedFogVertex(null); }}><span>Vision door {index + 1}<small>{door.open ? "open" : "closed"} · {door.x1}, {door.y1} to {door.x2}, {door.y2}</small></span></button></div>)}{map.fog.circles.map((circle, index) => <div key={circle.id}><button className="map-object-select" aria-pressed={selectedFogBlocker?.kind === "circle" && selectedFogBlocker.id === circle.id} onClick={() => { setSelectedFogBlocker({ kind: "circle", id: circle.id }); setSelectedAnnotation(null); setSelectedFogVertex(null); }}><span>Round blocker {index + 1}<small>x {circle.x}, y {circle.y}, radius {circle.radius}</small></span></button></div>)}</> : null}
        </details>
        {selectedLabel || selectedNote ? <section className="selected-scene-panel"><div className="workshop-section-heading"><small>{selectedLabel ? "Selected label" : "Selected DM note"}</small><strong>{selectedLabel?.text ?? `Note ${map.notes.findIndex((note) => note.id === selectedNote?.id) + 1}`}</strong></div>{selectedNote ? <p className="workshop-help selected-note-copy">{selectedNote.text}</p> : <p className="workshop-help">{selectedLabel?.visibility === "dm" ? "Visible only to the DM." : "Visible to everyone after the scene is applied."}</p>}<div className="geometry-fields"><label>X coordinate<input aria-label="Selected annotation X coordinate" type="number" min={0} max={map.width} step={0.25} value={selectedLabel?.x ?? selectedNote?.x ?? 0} onChange={(event) => updateSelectedAnnotationCoordinate("x", event.currentTarget.valueAsNumber)} /></label><label>Y coordinate<input aria-label="Selected annotation Y coordinate" type="number" min={0} max={map.height} step={0.25} value={selectedLabel?.y ?? selectedNote?.y ?? 0} onChange={(event) => updateSelectedAnnotationCoordinate("y", event.currentTarget.valueAsNumber)} /></label></div><button className="danger-button" onClick={deleteSelectedAnnotation}>Delete</button></section> : null}
        {selectedFogVertex !== null && map.fog.sharedPolygon[selectedFogVertex] ? <section className="selected-scene-panel"><div className="workshop-section-heading"><small>Selected fog corner</small><strong>Corner {selectedFogVertex + 1}</strong></div><div className="geometry-fields"><label>X coordinate<input aria-label="Selected fog corner X coordinate" type="number" min={0} max={map.width} step={0.25} value={map.fog.sharedPolygon[selectedFogVertex].x} onChange={(event) => updateSelectedFogVertexCoordinate("x", event.currentTarget.valueAsNumber)} /></label><label>Y coordinate<input aria-label="Selected fog corner Y coordinate" type="number" min={0} max={map.height} step={0.25} value={map.fog.sharedPolygon[selectedFogVertex].y} onChange={(event) => updateSelectedFogVertexCoordinate("y", event.currentTarget.valueAsNumber)} /></label></div><button className="danger-button" disabled={map.fog.sharedPolygon.length <= 3} onClick={deleteSelectedFogItem}>Delete corner</button></section> : null}
        {selectedFogWall || selectedFogDoor ? <section className="selected-scene-panel"><div className="workshop-section-heading"><small>Selected vision {selectedFogDoor ? "door" : "wall"}</small><strong>Endpoint geometry</strong></div><div className="geometry-fields is-four"><label>Start X<input aria-label="Selected blocker start X coordinate" type="number" min={0} max={map.width} step={0.25} value={selectedFogWall?.x1 ?? selectedFogDoor?.x1 ?? 0} onChange={(event) => updateSelectedBlockerCoordinate("x1", event.currentTarget.valueAsNumber)} /></label><label>Start Y<input aria-label="Selected blocker start Y coordinate" type="number" min={0} max={map.height} step={0.25} value={selectedFogWall?.y1 ?? selectedFogDoor?.y1 ?? 0} onChange={(event) => updateSelectedBlockerCoordinate("y1", event.currentTarget.valueAsNumber)} /></label><label>End X<input aria-label="Selected blocker end X coordinate" type="number" min={0} max={map.width} step={0.25} value={selectedFogWall?.x2 ?? selectedFogDoor?.x2 ?? 0} onChange={(event) => updateSelectedBlockerCoordinate("x2", event.currentTarget.valueAsNumber)} /></label><label>End Y<input aria-label="Selected blocker end Y coordinate" type="number" min={0} max={map.height} step={0.25} value={selectedFogWall?.y2 ?? selectedFogDoor?.y2 ?? 0} onChange={(event) => updateSelectedBlockerCoordinate("y2", event.currentTarget.valueAsNumber)} /></label></div>{selectedFogDoor ? <button className="secondary-button" onClick={toggleSelectedVisionDoor}>{selectedFogDoor.open ? "Close door" : "Open door"}</button> : null}<button className="danger-button" onClick={deleteSelectedFogItem}>Delete</button></section> : null}
        {selectedFogCircle ? <section className="selected-scene-panel"><div className="workshop-section-heading"><small>Selected round blocker</small><strong>Center and radius</strong></div><div className="geometry-fields is-three"><label>Center X<input aria-label="Selected round blocker X coordinate" type="number" min={0} max={map.width} step={0.25} value={selectedFogCircle.x} onChange={(event) => updateSelectedBlockerCoordinate("x", event.currentTarget.valueAsNumber)} /></label><label>Center Y<input aria-label="Selected round blocker Y coordinate" type="number" min={0} max={map.height} step={0.25} value={selectedFogCircle.y} onChange={(event) => updateSelectedBlockerCoordinate("y", event.currentTarget.valueAsNumber)} /></label><label>Radius<input aria-label="Selected round blocker radius" type="number" min={0.25} max={Math.min(map.width, map.height) / 2} step={0.25} value={selectedFogCircle.radius} onChange={(event) => updateSelectedBlockerCoordinate("radius", event.currentTarget.valueAsNumber)} /></label></div><button className="danger-button" onClick={deleteSelectedFogItem}>Delete</button></section> : null}
      </aside>
      <section className="workshop-canvas-panel" aria-label="Editable map"><div className="workshop-canvas-heading"><div><small>Map preset draft</small><strong>{map.name} · {map.width} × {map.height}</strong></div><span>{map.visual.pixelWidth} × {map.visual.pixelHeight} base · {dirty ? "Private until applied" : "Matches players"}</span></div><div className="workshop-canvas-frame" style={{ aspectRatio: `${map.width} / ${map.height}` }}><p id="workshop-keyboard-help" className="visually-hidden">Arrow keys move the map cursor one cell; Shift plus arrows moves five cells. Enter activates the selected workshop tool. Space grabs or drops a selected object. Delete removes a selected object. Escape cancels a staged shape or move. Exact geometry is also editable in the controls sidebar.</p><canvas ref={canvasRef} onFocus={onCanvasFocus} onKeyDown={onCanvasKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} aria-describedby="workshop-keyboard-help" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space Delete Escape" aria-label={`${map.name} editable map draft`} role="application" tabIndex={0} /></div><div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{keyboardStatus}</div><div className="workshop-legend"><span><i className="legend-grid" />Labels and notes align to the grid</span><span>Focus the map for keyboard editing; exact geometry is available in the sidebar</span></div>{message ? <div className="workshop-message" role="status">{message}</div> : null}</section>
    </div>
    {exitPrompt === "discard" ? <ModalDialog labelledBy="discard-workshop-title" describedBy="discard-workshop-description" closeOnBackdrop onDismiss={() => setExitPrompt(null)}><div className="eyebrow">Private map draft</div><h2 id="discard-workshop-title">Discard private changes?</h2><p id="discard-workshop-description">This restores the map currently applied to players and permanently removes the draft’s unsaved vision geometry, fog corners, labels, and notes.</p><div className="button-row"><button className="secondary-button" data-dialog-initial-focus onClick={() => setExitPrompt(null)}>Keep editing</button><button className="danger-button" onClick={() => { discard(); setExitPrompt(null); }}>Discard changes</button></div></ModalDialog> : null}
    {exitPrompt === "return" ? <ModalDialog labelledBy="return-workshop-title" describedBy="return-workshop-description" closeOnBackdrop onDismiss={() => setExitPrompt(null)}><div className="eyebrow">Private map draft</div><h2 id="return-workshop-title">Return without applying?</h2><p id="return-workshop-description">Your private workshop changes are not visible to players. Keep editing, discard the draft and return, or apply it to everyone before returning.</p>{message ? <div className="workshop-message is-error" role="alert">{message}</div> : null}<div className="button-row workshop-return-options"><button className="secondary-button" data-dialog-initial-focus onClick={() => setExitPrompt(null)}>Keep editing</button><button className="danger-button" onClick={discardAndReturn}>Discard and return</button><button className="primary-button" disabled={busy} onClick={() => void applyAndReturn()}>{busy ? "Applying…" : "Apply and return"}</button></div></ModalDialog> : null}
  </main>;
}
