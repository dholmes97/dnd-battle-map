"use client";

import NextImage from "next/image";
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
import { FULL_SCENE_MAPS, SCENE_KITS, createFullSceneMap, type SceneKitDefinition } from "@/shared/full-scene-maps";
import { cloneMapPackage, parseMapPackage, type MapPackage, type MapRotation } from "@/shared/map-package";

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

type Tool = "select" | "wall" | "door" | "window" | "label" | "note";
type Point = { x: number; y: number };
type DragState = { pointerId: number; objectId: string; offset: Point; before: MapPackage };
type WallDrag = { pointerId: number; start: Point };

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
  return {
    x: Math.max(0, Math.min(map.width, ((clientX - rect.left) / rect.width) * map.width)),
    y: Math.max(0, Math.min(map.height, ((clientY - rect.top) / rect.height) * map.height)),
  };
}

function snap(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

function nextRotation(rotation: MapRotation): MapRotation {
  return ((rotation + 90) % 360) as MapRotation;
}

function sceneObjectBounds(object: MapPackage["sceneObjects"][number]) {
  const rotated = object.rotation === 90 || object.rotation === 270;
  return { width: rotated ? object.height : object.width, height: rotated ? object.width : object.height };
}

function objectAt(map: MapPackage, point: Point) {
  return [...map.sceneObjects].reverse().find((object) => {
    const bounds = sceneObjectBounds(object);
    return point.x >= object.x && point.x <= object.x + bounds.width && point.y >= object.y && point.y <= object.y + bounds.height;
  }) ?? null;
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

export function renderMapPackageToCanvas(canvas: HTMLCanvasElement, map: MapPackage, images: ReadonlyMap<string, HTMLImageElement>, includePrivate = false) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const cellWidth = canvas.width / map.width; const cellHeight = canvas.height / map.height;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const base = images.get(map.visual.assetUrl);
  if (base) context.drawImage(base, 0, 0, canvas.width, canvas.height);
  else { context.fillStyle = "#30372c"; context.fillRect(0, 0, canvas.width, canvas.height); }
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
}

export default function MapWorkshop({ activeMapPackage, activeMapPresetId, savedPresets, onCommand, onClose }: Props) {
  const initial = useMemo(() => cloneMapPackage(activeMapPackage ?? createFullSceneMap(DEFAULT_SCENE)), [activeMapPackage]);
  const [map, setMap] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
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
  const undoRef = useRef<MapPackage[]>([]);
  const redoRef = useRef<MapPackage[]>([]);
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });

  const selectedObject = map.sceneObjects.find((object) => object.id === selectedObjectId) ?? null;
  const kit = SCENE_KITS[map.visual.sceneKitId] ?? [];
  const assetPaths = useMemo(() => [...new Set([map.visual.assetUrl, ...map.sceneObjects.map((object) => object.assetUrl)])], [map.sceneObjects, map.visual.assetUrl]);

  useEffect(() => {
    let disposed = false;
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
    renderMapPackageToCanvas(canvas, map, images, true);
    const context = canvas.getContext("2d"); if (!context) return;
    const cellWidth = canvas.width / map.width; const cellHeight = canvas.height / map.height;
    context.strokeStyle = "rgba(241, 229, 198, 0.2)"; context.lineWidth = Math.max(1, dpr);
    for (let x = 0; x <= map.width; x += 1) { context.beginPath(); context.moveTo(x * cellWidth, 0); context.lineTo(x * cellWidth, canvas.height); context.stroke(); }
    for (let y = 0; y <= map.height; y += 1) { context.beginPath(); context.moveTo(0, y * cellHeight); context.lineTo(canvas.width, y * cellHeight); context.stroke(); }
    if (selectedObject) {
      const bounds = sceneObjectBounds(selectedObject);
      context.strokeStyle = "#f5c65c"; context.lineWidth = Math.max(2, dpr * 1.5); context.setLineDash([8 * dpr, 5 * dpr]);
      context.strokeRect(selectedObject.x * cellWidth, selectedObject.y * cellHeight, bounds.width * cellWidth, bounds.height * cellHeight); context.setLineDash([]);
    }
    if (wallPreview) {
      context.strokeStyle = "#f5c65c"; context.lineWidth = Math.max(3, dpr * 2); context.setLineDash([7 * dpr, 5 * dpr]);
      context.beginPath(); context.moveTo(wallPreview.start.x * cellWidth, wallPreview.start.y * cellHeight); context.lineTo(wallPreview.end.x * cellWidth, wallPreview.end.y * cellHeight); context.stroke(); context.setLineDash([]);
    }
  }, [images, map, selectedObject, wallPreview]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => { const resize = () => draw(); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, [draw]);

  const remember = (before: MapPackage) => {
    undoRef.current = [...undoRef.current.slice(-(HISTORY_LIMIT - 1)), cloneMapPackage(before)]; redoRef.current = []; setHistoryCounts({ undo: undoRef.current.length, redo: 0 });
  };
  const commit = (update: (current: MapPackage) => MapPackage) => setMap((current) => { const next = update(current); remember(current); setDirty(true); return next; });
  const replaceDraft = (next: MapPackage, changed: boolean) => {
    setMap(cloneMapPackage(next)); setDirty(changed); setPresetName(next.name); setSelectedObjectId(null); setTool("select"); undoRef.current = []; redoRef.current = []; setHistoryCounts({ undo: 0, redo: 0 });
  };
  const undo = () => {
    const previous = undoRef.current.pop(); if (!previous) return;
    redoRef.current.push(cloneMapPackage(map)); setMap(previous); setDirty(true); setSelectedObjectId(null); setHistoryCounts({ undo: undoRef.current.length, redo: redoRef.current.length });
  };
  const redo = () => {
    const next = redoRef.current.pop(); if (!next) return;
    undoRef.current.push(cloneMapPackage(map)); setMap(next); setDirty(true); setSelectedObjectId(null); setHistoryCounts({ undo: undoRef.current.length, redo: redoRef.current.length });
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
    if (tool === "select") {
      const object = objectAt(map, point); setSelectedObjectId(object?.id ?? null);
      if (object) { objectDragRef.current = { pointerId: event.pointerId, objectId: object.id, offset: { x: point.x - object.x, y: point.y - object.y }, before: cloneMapPackage(map) }; event.currentTarget.setPointerCapture(event.pointerId); }
      return;
    }
    if (tool === "wall") { const start = snap(point); wallDragRef.current = { pointerId: event.pointerId, start }; setWallPreview({ start, end: start }); event.currentTarget.setPointerCapture(event.pointerId); return; }
    const location = snap(point); const id = crypto.randomUUID();
    if (tool === "door" || tool === "window") commit((current) => ({ ...current, portals: [...current.portals, { id, x: location.x, y: location.y, orientation: portalOrientation, kind: tool, open: false }] }));
    if (tool === "label" && labelText.trim()) commit((current) => ({ ...current, labels: [...current.labels, { id, x: location.x, y: location.y, text: labelText.trim().slice(0, 120), visibility: labelVisibility }] }));
    if (tool === "note" && noteText.trim()) commit((current) => ({ ...current, notes: [...current.notes, { id, x: location.x, y: location.y, text: noteText.trim().slice(0, 500) }] }));
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event.currentTarget, map, event.clientX, event.clientY);
    const objectDrag = objectDragRef.current;
    if (objectDrag?.pointerId === event.pointerId) setMap((current) => ({ ...current, sceneObjects: current.sceneObjects.map((object) => object.id === objectDrag.objectId ? { ...object, x: Math.max(0, Math.min(current.width - sceneObjectBounds(object).width, Math.round(point.x - objectDrag.offset.x))), y: Math.max(0, Math.min(current.height - sceneObjectBounds(object).height, Math.round(point.y - objectDrag.offset.y))) } : object) }));
    const wallDrag = wallDragRef.current;
    if (wallDrag?.pointerId === event.pointerId) setWallPreview({ start: wallDrag.start, end: snap(point) });
  };

  const finishPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    const objectDrag = objectDragRef.current;
    if (objectDrag?.pointerId === event.pointerId) { remember(objectDrag.before); setDirty(true); objectDragRef.current = null; }
    const wallDrag = wallDragRef.current;
    if (wallDrag?.pointerId === event.pointerId) {
      const end = snap(canvasPoint(event.currentTarget, map, event.clientX, event.clientY)); wallDragRef.current = null; setWallPreview(null);
      if (end.x !== wallDrag.start.x || end.y !== wallDrag.start.y) commit((current) => ({ ...current, walls: [...current.walls, { id: crypto.randomUUID(), x1: wallDrag.start.x, y1: wallDrag.start.y, x2: end.x, y2: end.y, style: current.biome === "cave" ? "cave" : current.biome === "ruins" ? "ruined" : "stone" }] }));
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onKitDragStart = (event: DragEvent<HTMLButtonElement>, definition: SceneKitDefinition) => { kitDragRef.current = definition; event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("text/plain", definition.id); };
  const onMapDrop = (event: DragEvent<HTMLCanvasElement>) => {
    event.preventDefault(); const definition = kitDragRef.current; kitDragRef.current = null; if (!definition) return;
    const point = snap(canvasPoint(event.currentTarget, map, event.clientX, event.clientY));
    commit((current) => {
      const object = { id: crypto.randomUUID(), definitionId: definition.id, assetUrl: definition.assetUrl, x: Math.max(0, Math.min(current.width - definition.width, point.x - Math.floor(definition.width / 2))), y: Math.max(0, Math.min(current.height - definition.height, point.y - Math.floor(definition.height / 2))), width: definition.width, height: definition.height, rotation: 0 as MapRotation };
      setSelectedObjectId(object.id); return { ...current, sceneObjects: [...current.sceneObjects, object] };
    });
  };

  const deleteObject = (collection: "walls" | "portals" | "labels" | "notes", id: string) => commit((current) => ({ ...current, [collection]: current[collection].filter((item) => item.id !== id) }));
  const deleteSelected = () => { if (!selectedObjectId) return; commit((current) => ({ ...current, sceneObjects: current.sceneObjects.filter((object) => object.id !== selectedObjectId) })); setSelectedObjectId(null); };
  const rotateSelected = () => { if (!selectedObjectId) return; commit((current) => ({ ...current, sceneObjects: current.sceneObjects.map((object) => object.id === selectedObjectId ? { ...object, rotation: nextRotation(object.rotation) } : object) })); };

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
        <section><div className="workshop-section-heading"><small>Complete scenes</small><strong>Choose a cohesive base</strong></div><p className="workshop-help">Each starter is one high-resolution image with its own matching additions.</p><div className="full-scene-list">{FULL_SCENE_MAPS.map((scene) => <button key={scene.id} className={map.visual.assetUrl === scene.assetUrl ? "is-active" : ""} onClick={() => chooseScene(scene)}><NextImage src={scene.assetUrl} alt="" width={96} height={64} unoptimized /><span><strong>{scene.name}</strong><small>{scene.biome} · 24 × 16</small></span></button>)}</div></section>
        <section><div className="workshop-section-heading"><small>Edit</small><strong>Scene annotations</strong></div><div className="draft-history-row"><button disabled={!historyCounts.undo} onClick={undo}>Undo{historyCounts.undo ? ` (${historyCounts.undo})` : ""}</button><button disabled={!historyCounts.redo} onClick={redo}>Redo{historyCounts.redo ? ` (${historyCounts.redo})` : ""}</button></div><div className="workshop-tool-row is-expanded">{(["select", "wall", "door", "window", "label", "note"] as Tool[]).map((value) => <button key={value} className={tool === value ? "is-active" : ""} onClick={() => setTool(value)}>{value === "note" ? "DM note" : value.charAt(0).toUpperCase() + value.slice(1)}</button>)}</div>
          {tool === "select" ? <p className="workshop-help">Drag matching additions to move them. Select one to rotate or remove it.</p> : null}
          {tool === "wall" ? <p className="workshop-help">Drag between grid intersections to add a wall.</p> : null}
          {tool === "door" || tool === "window" ? <div className="structure-options"><span>Orientation</span><div className="terrain-edge-toggle"><button className={portalOrientation === "horizontal" ? "is-active" : ""} onClick={() => setPortalOrientation("horizontal")}>Horizontal</button><button className={portalOrientation === "vertical" ? "is-active" : ""} onClick={() => setPortalOrientation("vertical")}>Vertical</button></div><p className="workshop-help">Click the desired position.</p></div> : null}
          {tool === "label" ? <div className="structure-options"><label>Text<input value={labelText} onChange={(event) => setLabelText(event.target.value)} /></label><label>Visible to<select value={labelVisibility} onChange={(event) => setLabelVisibility(event.target.value as "dm" | "everyone")}><option value="everyone">Everyone</option><option value="dm">DM only</option></select></label><p className="workshop-help">Enter text, then click the scene.</p></div> : null}
          {tool === "note" ? <div className="structure-options"><label>Private note<textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} rows={3} /></label><p className="workshop-help">Enter a note, then click its location.</p></div> : null}
        </section>
        <section className="scene-kit-panel"><div className="workshop-section-heading"><small>Matched additions</small><strong>Artwork for this scene</strong></div><p className="workshop-help">Drag onto the scene. These pieces share its palette, scale, viewpoint, and lighting.</p><div className="scene-kit-list">{kit.map((item) => <button key={item.id} draggable onDragStart={(event) => onKitDragStart(event, item)} onDragEnd={() => { kitDragRef.current = null; }}><NextImage src={item.assetUrl} alt="" width={64} height={64} unoptimized draggable={false} /><span><strong>{item.name}</strong><small>{item.width} × {item.height} cells</small></span></button>)}</div></section>
        <details className="map-object-list"><summary>Scene details <span>{map.sceneObjects.length + map.walls.length + map.portals.length + map.labels.length + map.notes.length}</span></summary>
          {map.sceneObjects.map((object) => <div key={object.id}><span>{kit.find((item) => item.id === object.definitionId)?.name ?? "Scene addition"}<small>{object.rotation}°</small></span><button aria-label="Delete scene addition" onClick={() => { commit((current) => ({ ...current, sceneObjects: current.sceneObjects.filter((item) => item.id !== object.id) })); setSelectedObjectId(null); }}>×</button></div>)}
          {map.walls.map((wall, index) => <div key={wall.id}><span>Wall {index + 1}</span><button aria-label={`Delete wall ${index + 1}`} onClick={() => deleteObject("walls", wall.id)}>×</button></div>)}
          {map.portals.map((portal, index) => <div key={portal.id}><span>{portal.kind} {index + 1}<small>{portal.orientation}</small></span><button aria-label={`Delete ${portal.kind} ${index + 1}`} onClick={() => deleteObject("portals", portal.id)}>×</button></div>)}
          {map.labels.map((label, index) => <div key={label.id}><span>{label.text}<small>{label.visibility}</small></span><button aria-label={`Delete label ${index + 1}`} onClick={() => deleteObject("labels", label.id)}>×</button></div>)}
          {map.notes.map((note, index) => <div key={note.id}><span>DM note {index + 1}<small>{note.text}</small></span><button aria-label={`Delete note ${index + 1}`} onClick={() => deleteObject("notes", note.id)}>×</button></div>)}
        </details>
        {selectedObject ? <section className="selected-scene-panel"><div className="workshop-section-heading"><small>Selected addition</small><strong>{kit.find((item) => item.id === selectedObject.definitionId)?.name ?? selectedObject.definitionId}</strong></div><p className="workshop-help">Drag to reposition; rotation remains grid-aligned.</p><div className="button-row"><button className="secondary-button" onClick={rotateSelected}>Rotate 90°</button><button className="danger-button" onClick={deleteSelected}>Delete</button></div></section> : null}
        <section className="map-library-panel"><div className="workshop-section-heading"><small>Scene library</small><strong>Save and exchange</strong></div><label>Title<input value={map.name} maxLength={100} onChange={(event) => commit((current) => ({ ...current, name: event.target.value }))} /></label><label>Description<textarea value={map.description} maxLength={500} rows={2} onChange={(event) => commit((current) => ({ ...current, description: event.target.value }))} /></label><label>Preset name<input value={presetName} onChange={(event) => setPresetName(event.target.value)} /></label><div className="button-row"><button className="primary-button" disabled={busy} onClick={() => void savePreset()}>{loadedPresetId ? "Update preset" : "Save preset"}</button><button className="secondary-button" onClick={exportPackage}>Export</button><button className="secondary-button" onClick={() => importRef.current?.click()}>Import</button></div><input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importPackage(event)} /><div className="saved-map-list">{savedPresets.map((preset) => <article className={preset.id === loadedPresetId ? "is-selected" : ""} key={preset.id}><button className="saved-map-load" onClick={() => loadPreset(preset)}><strong>{preset.name}</strong><small>{preset.mapPackage.biome} · {preset.mapPackage.width} × {preset.mapPackage.height}{preset.id === activeMapPresetId ? " · applied" : ""}</small></button><button className="saved-map-delete" aria-label={`Delete ${preset.name}`} onClick={() => void runCommand("delete-map-preset", { presetId: preset.id }, `Deleted “${preset.name}”.`)}>×</button></article>)}</div></section>
      </aside>
      <section className="workshop-canvas-panel" aria-label="Editable full-scene map"><div className="workshop-canvas-heading"><div><small>Cohesive full-scene draft</small><strong>{map.name} · {map.width} × {map.height}</strong></div><span>3072 × 2048 base · {dirty ? "Private until applied" : "Matches players"}</span></div><div className="workshop-canvas-frame"><canvas ref={canvasRef} style={{ aspectRatio: `${map.width} / ${map.height}` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={onMapDrop} aria-label={`${map.name} draft with ${map.sceneObjects.length} matching additions`} /></div><div className="workshop-legend"><span><i className="legend-cell" />Gold outline marks the selected addition</span><span><i className="legend-grid" />Additions and annotations align to the grid</span><span>The base remains one cohesive image</span></div>{message ? <div className="workshop-message" role="status">{message}</div> : null}</section>
    </div>
  </main>;
}
