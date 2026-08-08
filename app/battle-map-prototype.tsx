"use client";

import {
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import NextImage from "next/image";
import MapWorkshop, { renderMapPackageToCanvas } from "@/app/map-workshop";
import {
  CREATURE_SIZES,
  type CreatureSize,
  type CreatureTemplate,
  tokenRadiusCells,
} from "@/shared/creature-library";
import { type MapPackage } from "@/shared/map-package";

type ConnectionState = "connecting" | "live" | "reconnecting" | "lost";
type Role = "player" | "dm";
type JoinIdentity = { label: string; participantName: string; role: Role };
type MapPoint = { x: number; y: number };
type SharedEffect = {
  id: string;
  name: string;
  type: string;
  durationRounds: number | null;
  expiresRound: number | null;
  reminderTiming: string;
  due: boolean;
};
type SharedToken = MapPoint & {
  id: string;
  name: string;
  artAsset: string | null;
  kind: string;
  size: CreatureSize;
  speed: number;
  hp: number | null;
  maxHp: number | null;
  healthState: string | null;
  hidden: boolean;
  summonerTokenId: string | null;
  initiative: number | null;
  initiativeOrder: number | null;
  turnComplete: boolean;
  movementUsed: number;
  effects: SharedEffect[];
  owner: null | { participantId: string; name: string };
};
type SharedAnnotation = {
  id: string;
  type: "ping" | "drawing" | "spotlight";
  x: number;
  y: number;
  x2: number | null;
  y2: number | null;
  color: string;
  label: string | null;
  createdBy: string;
  expiresAt: number | null;
};
type EncounterState = {
  encounter: {
    code: string;
    name: string;
    version: number;
    status: "setup" | "active" | "paused";
    mapPackage: MapPackage | null;
    activeMapPresetId: string | null;
    currentRound: number;
    activeInitiativeOrder: number | null;
    updatedAt: number;
  };
  grid: { width: number; height: number; feetPerCell: number };
  viewer: null | { id: string; role: Role };
  undo: { available: number; lastAction: string | null };
  tokens: SharedToken[];
  annotations: SharedAnnotation[];
  savedMapPresets: Array<{
    id: string;
    name: string;
    description: string;
    sourcePrompt: string | null;
    mapPackage: MapPackage;
    createdAt: number;
    updatedAt: number;
  }>;
  availableArt: string[];
};
type Participant = { id: string; name: string; role: Role; sessionSecret: string };
type TokenPreview = MapPoint & { tokenId: string };
type PlacementPreview = MapPoint & { creature: CreatureTemplate };
type PendingMove = MapPoint & { sequence: number };
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
type AnnotationMode = "move" | "ping" | "drawing" | "erase" | "spotlight";
type Viewport = { zoom: number; centerX: number; centerY: number; mapKey: string; fit: boolean };
type ViewportGeometry = Viewport & {
  cellSize: number;
  visibleWidth: number;
  visibleHeight: number;
  panX: number;
  panY: number;
  offsetX: number;
  offsetY: number;
};
type RenderedMapScene = { mapId: string; canvas: HTMLCanvasElement };
type CreatureCatalogPage = {
  items: CreatureTemplate[];
  families: string[];
  nextCursor: string | null;
};

const DEFAULT_CODE = "EMBER-KEEP";
const JOIN_IDENTITIES: JoinIdentity[] = [
  { label: "Join as Dan (Dar'eleth)", participantName: "Dan", role: "player" },
  { label: "Join as Barry (Jelton)", participantName: "Barry", role: "player" },
  { label: "Join as Kevin (DM)", participantName: "Kevin", role: "dm" },
];
const TOKEN_COLORS = ["#c97546", "#639a72", "#8c72b8", "#628aaa", "#a16b75"];
const HEARTBEAT_INTERVAL_MS = 20_000;
const PING_PULSE_COUNT = 3;
const PING_PULSE_MS = 420;
const PING_DURATION_MS = PING_PULSE_COUNT * PING_PULSE_MS;

function roundCoordinate(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function formatPosition(point: MapPoint) {
  return `${point.x.toFixed(2)}, ${point.y.toFixed(2)}`;
}

function distanceToSegment(point: MapPoint, start: MapPoint, end: MapPoint) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared));
  return Math.hypot(point.x - (start.x + projection * deltaX), point.y - (start.y + projection * deltaY));
}

function drawingAtPoint(annotations: SharedAnnotation[], point: MapPoint, tolerance: number) {
  return annotations
    .filter((annotation) => annotation.type === "drawing" && annotation.x2 !== null && annotation.y2 !== null)
    .map((annotation) => ({ annotation, distance: distanceToSegment(point, annotation, { x: annotation.x2!, y: annotation.y2! }) }))
    .filter(({ distance }) => distance <= tolerance)
    .sort((a, b) => a.distance - b.distance)[0]?.annotation ?? null;
}

function tokenInitial(token: SharedToken) {
  return token.name.split(/\s+/).at(-1)?.charAt(0).toUpperCase() || "T";
}

function artLabel(path: string) {
  return path.split("/").at(-1)?.replace(/-01\.png$/, "").replaceAll("-", " ") ?? "Artwork";
}

function clampMapPoint(state: EncounterState, point: MapPoint, radius = tokenRadiusCells("medium")): MapPoint {
  return {
    x: roundCoordinate(Math.min(state.grid.width - radius, Math.max(radius, point.x))),
    y: roundCoordinate(Math.min(state.grid.height - radius, Math.max(radius, point.y))),
  };
}

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
  return clampMapPoint(state, {
    x: geometry.panX + (clientX - rect.left - geometry.offsetX) / geometry.cellSize,
    y: geometry.panY + (clientY - rect.top - geometry.offsetY) / geometry.cellSize,
  }, radius);
}

function calculateDirectDistance(from: MapPoint, to: MapPoint, feetPerCell: number) {
  const squares = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return Math.round(squares * feetPerCell * 10) / 10;
}

function viewportGeometry(viewport: Viewport, state: EncounterState, width: number, height: number): ViewportGeometry {
  const mapKey = `${state.encounter.mapPackage?.id ?? "empty"}:${state.grid.width}x${state.grid.height}`;
  const matchesMap = viewport.mapKey === mapKey;
  const baseCellSize = Math.max(width / state.grid.width, height / state.grid.height);
  const fitZoom = Math.min(width / state.grid.width, height / state.grid.height) / baseCellSize;
  const fit = matchesMap && viewport.fit;
  const requestedZoom = matchesMap ? viewport.zoom : 1;
  const zoom = fit ? fitZoom : Math.max(1, Math.min(3, requestedZoom));
  const cellSize = Math.max(1, baseCellSize * zoom);
  const visibleWidth = Math.min(state.grid.width, width / cellSize);
  const visibleHeight = Math.min(state.grid.height, height / cellSize);
  const requestedCenterX = matchesMap ? viewport.centerX : state.grid.width / 2;
  const requestedCenterY = matchesMap ? viewport.centerY : state.grid.height / 2;
  const centerX = Math.max(visibleWidth / 2, Math.min(state.grid.width - visibleWidth / 2, requestedCenterX));
  const centerY = Math.max(visibleHeight / 2, Math.min(state.grid.height - visibleHeight / 2, requestedCenterY));
  return {
    zoom,
    centerX,
    centerY,
    mapKey,
    fit,
    cellSize,
    visibleWidth,
    visibleHeight,
    panX: centerX - visibleWidth / 2,
    panY: centerY - visibleHeight / 2,
    offsetX: Math.max(0, (width - state.grid.width * cellSize) / 2),
    offsetY: Math.max(0, (height - state.grid.height * cellSize) / 2),
  };
}

function clampViewport(viewport: Viewport, state: EncounterState, width: number, height: number): Viewport {
  const geometry = viewportGeometry(viewport, state, width, height);
  return { zoom: geometry.fit ? 1 : geometry.zoom, centerX: geometry.centerX, centerY: geometry.centerY, mapKey: geometry.mapKey, fit: geometry.fit };
}

function zoomViewportAt(viewport: Viewport, state: EncounterState, width: number, height: number, zoom: number, focusX = 0.5, focusY = 0.5): Viewport {
  const current = viewportGeometry(viewport, state, width, height);
  const baseCellSize = Math.max(width / state.grid.width, height / state.grid.height);
  const fitZoom = Math.min(width / state.grid.width, height / state.grid.height) / baseCellSize;
  const nextFit = zoom < 1;
  const nextZoom = nextFit ? 1 : Math.min(3, zoom);
  const effectiveNextZoom = nextFit ? fitZoom : nextZoom;
  const mapX = current.panX + Math.min(current.visibleWidth, Math.max(0, focusX * width - current.offsetX) / current.cellSize);
  const mapY = current.panY + Math.min(current.visibleHeight, Math.max(0, focusY * height - current.offsetY) / current.cellSize);
  const visibleWidth = Math.min(state.grid.width, width / (baseCellSize * effectiveNextZoom));
  const visibleHeight = Math.min(state.grid.height, height / (baseCellSize * effectiveNextZoom));
  return clampViewport({
    zoom: nextZoom,
    centerX: mapX + (0.5 - focusX) * visibleWidth,
    centerY: mapY + (0.5 - focusY) * visibleHeight,
    mapKey: current.mapKey,
    fit: nextFit,
  }, state, width, height);
}

function playPingSound(context: AudioContext) {
  if (context.state === "closed") return;
  const sound = () => {
    const startedAt = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, startedAt);
    oscillator.frequency.exponentialRampToValueAtTime(1_320, startedAt + 0.09);
    gain.gain.setValueAtTime(0.0001, startedAt);
    gain.gain.exponentialRampToValueAtTime(0.16, startedAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.18);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(startedAt); oscillator.stop(startedAt + 0.19);
  };
  if (context.state === "suspended") void context.resume().then(sound).catch(() => undefined);
  else sound();
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}

function sessionPayload(participant: Participant, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    participantId: participant.id,
    sessionSecret: participant.sessionSecret,
    ...extra,
  });
}

function viewerHeaders(participant: Participant) {
  return {
    "x-participant-id": participant.id,
    "x-session-secret": participant.sessionSecret,
  };
}

function drawMap(
  canvas: HTMLCanvasElement,
  state: EncounterState,
  preview: TokenPreview | null,
  placementPreview: PlacementPreview | null,
  dragOrigin: MapPoint | null,
  participant: Participant,
  mapScene: HTMLCanvasElement | null,
  tokenArt: Map<string, HTMLImageElement>,
  viewport: Viewport,
  pingStartedAt: ReadonlyMap<string, number>,
  animationNow: number,
) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  const geometry = viewportGeometry(viewport, state, rect.width, rect.height);
  const cellWidth = geometry.cellSize;
  const cellHeight = geometry.cellSize;
  const screenX = (mapX: number) => geometry.offsetX + (mapX - geometry.panX) * geometry.cellSize;
  const screenY = (mapY: number) => geometry.offsetY + (mapY - geometry.panY) * geometry.cellSize;
  context.fillStyle = "#242622";
  context.fillRect(0, 0, rect.width, rect.height);
  const mapPackage = state.encounter.mapPackage;
  if (mapScene && mapPackage) {
    const sourceWidth = geometry.visibleWidth / state.grid.width * mapScene.width;
    const sourceHeight = geometry.visibleHeight / state.grid.height * mapScene.height;
    const sourceX = geometry.panX / state.grid.width * mapScene.width;
    const sourceY = geometry.panY / state.grid.height * mapScene.height;
    context.drawImage(
      mapScene,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      geometry.offsetX,
      geometry.offsetY,
      geometry.visibleWidth * geometry.cellSize,
      geometry.visibleHeight * geometry.cellSize,
    );
  } else {
    context.fillStyle = "#4b4b42";
    context.fillRect(
      geometry.offsetX,
      geometry.offsetY,
      geometry.visibleWidth * geometry.cellSize,
      geometry.visibleHeight * geometry.cellSize,
    );
  }

  context.strokeStyle = "rgba(232, 220, 190, 0.17)";
  context.lineWidth = 1;
  for (let x = 0; x <= state.grid.width; x += 1) {
    context.beginPath(); context.moveTo(screenX(x), geometry.offsetY); context.lineTo(screenX(x), geometry.offsetY + geometry.visibleHeight * geometry.cellSize); context.stroke();
  }
  for (let y = 0; y <= state.grid.height; y += 1) {
    context.beginPath(); context.moveTo(geometry.offsetX, screenY(y)); context.lineTo(geometry.offsetX + geometry.visibleWidth * geometry.cellSize, screenY(y)); context.stroke();
  }

  for (const annotation of state.annotations) {
    const x = screenX(annotation.x);
    const y = screenY(annotation.y);
    context.save();
    context.strokeStyle = annotation.color;
    context.fillStyle = `${annotation.color}33`;
    context.lineWidth = annotation.type === "spotlight" ? 5 : 3;
    if (annotation.type === "ping") {
      const startedAt = pingStartedAt.get(annotation.id);
      const elapsed = startedAt === undefined ? PING_DURATION_MS : animationNow - startedAt;
      if (elapsed < 0 || elapsed >= PING_DURATION_MS) { context.restore(); continue; }
      const pulseProgress = (elapsed % PING_PULSE_MS) / PING_PULSE_MS;
      const radius = Math.min(cellWidth, cellHeight) * (0.12 + pulseProgress * 0.2);
      context.globalAlpha = Math.max(0, 1 - pulseProgress);
      context.lineWidth = 2.5;
      context.shadowColor = annotation.color;
      context.shadowBlur = 7;
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.stroke();
      context.globalAlpha = Math.max(0, 0.82 - elapsed / PING_DURATION_MS);
      context.fillStyle = annotation.color;
      context.beginPath(); context.arc(x, y, Math.min(cellWidth, cellHeight) * 0.055, 0, Math.PI * 2); context.fill();
    } else if (annotation.type === "drawing" && annotation.x2 !== null && annotation.y2 !== null) {
      context.setLineDash([9, 5]);
      context.beginPath(); context.moveTo(x, y); context.lineTo(screenX(annotation.x2), screenY(annotation.y2)); context.stroke();
    } else {
      const radius = Math.min(cellWidth, cellHeight) * 1.15;
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill(); context.stroke();
    }
    context.restore();
  }

  if (preview && dragOrigin) {
    const movingToken = state.tokens.find((token) => token.id === preview.tokenId);
    const distance = calculateDirectDistance(dragOrigin, preview, state.grid.feetPerCell);
    const remaining = movingToken ? Math.max(0, movingToken.speed - movingToken.movementUsed) : 0;
    const overMovement = Boolean(movingToken && distance > remaining + 0.05);
    const rulerColor = overMovement ? "#ef6656" : "#f5c65c";
    const startX = screenX(dragOrigin.x);
    const startY = screenY(dragOrigin.y);
    const endX = screenX(preview.x);
    const endY = screenY(preview.y);
    const middleX = (startX + endX) / 2;
    const middleY = (startY + endY) / 2;
    const label = `${distance} ft`;

    context.save();
    context.strokeStyle = rulerColor;
    context.lineWidth = 3;
    context.setLineDash([3, 7]);
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = rulerColor;
    context.beginPath(); context.arc(startX, startY, 5, 0, Math.PI * 2); context.fill();
    context.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const labelWidth = context.measureText(label).width + 14;
    context.fillStyle = "rgba(24, 22, 19, 0.92)";
    context.fillRect(middleX - labelWidth / 2, middleY - 12, labelWidth, 24);
    context.strokeStyle = rulerColor;
    context.lineWidth = 1.5;
    context.strokeRect(middleX - labelWidth / 2, middleY - 12, labelWidth, 24);
    context.fillStyle = rulerColor;
    context.fillText(label, middleX, middleY + 0.5);
    context.restore();
  }

  state.tokens.forEach((token, index) => {
    const position = preview?.tokenId === token.id ? preview : token;
    const owned = token.owner?.participantId === participant.id;
    const active = token.initiativeOrder !== null && token.initiativeOrder === state.encounter.activeInitiativeOrder;
    const x = screenX(position.x);
    const y = screenY(position.y);
    const radius = Math.min(cellWidth, cellHeight) * tokenRadiusCells(token.size);
    context.save();
    if (token.hidden) context.globalAlpha *= 0.48;
    context.shadowColor = "rgba(0,0,0,.45)";
    context.shadowBlur = 10;
    context.fillStyle = active ? "#f5c65c" : TOKEN_COLORS[index % TOKEN_COLORS.length];
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
    context.shadowBlur = 0;
    const art = token.artAsset ? tokenArt.get(token.artAsset) : null;
    if (art) {
      context.save();
      context.beginPath(); context.arc(x, y, radius * 0.9, 0, Math.PI * 2); context.clip();
      if (token.artAsset?.includes("/characters/")) {
        context.drawImage(
          art,
          art.naturalWidth * 0.2,
          0,
          art.naturalWidth * 0.6,
          art.naturalHeight * 0.6,
          x - radius,
          y - radius,
          radius * 2,
          radius * 2,
        );
      } else {
        context.drawImage(art, x - radius, y - radius, radius * 2, radius * 2);
      }
      context.restore();
    } else {
      context.fillStyle = "#261d18";
      context.font = `800 ${Math.max(12, radius * 0.88)}px ui-sans-serif, system-ui`;
      context.textAlign = "center"; context.textBaseline = "middle";
      context.fillText(tokenInitial(token), x, y + 1);
    }
    context.strokeStyle = owned ? "#fff1ba" : active ? "#ffe29a" : "#f0d0a0";
    context.lineWidth = owned || active ? Math.max(3, radius * 0.16) : Math.max(2, radius * 0.1);
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.stroke();
    if (token.effects.length > 0) {
      context.fillStyle = token.effects.some((effect) => effect.due) ? "#d95f59" : "#8ec9a0";
      context.beginPath(); context.arc(x + radius * 0.72, y - radius * 0.72, radius * 0.24, 0, Math.PI * 2); context.fill();
    }
    context.restore();
  });

  if (placementPreview) {
    const x = screenX(placementPreview.x);
    const y = screenY(placementPreview.y);
    const radius = Math.min(cellWidth, cellHeight) * tokenRadiusCells(placementPreview.creature.size);
    const art = tokenArt.get(placementPreview.creature.artAsset);
    context.save();
    context.globalAlpha = 0.72;
    context.fillStyle = "rgba(245, 198, 92, 0.28)";
    context.strokeStyle = "#f5c65c";
    context.lineWidth = Math.max(2, radius * 0.08);
    context.setLineDash([7, 5]);
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill(); context.stroke();
    context.setLineDash([]);
    if (art) context.drawImage(art, x - radius, y - radius, radius * 2, radius * 2);
    context.restore();
  }
}

export default function BattleMapPrototype() {
  const [encounterCode, setEncounterCode] = useState(DEFAULT_CODE);
  const [joiningIdentity, setJoiningIdentity] = useState<string | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [state, setState] = useState<EncounterState | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [preview, setPreview] = useState<TokenPreview | null>(null);
  const [dragOrigin, setDragOrigin] = useState<MapPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>("move");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [renderedMapScene, setRenderedMapScene] = useState<RenderedMapScene | null>(null);
  const [tokenArt, setTokenArt] = useState<Map<string, HTMLImageElement>>(new Map());
  const [initiativeDrafts, setInitiativeDrafts] = useState<Record<string, string>>({});
  const [initiativeStatuses, setInitiativeStatuses] = useState<Record<string, "editing" | "saving" | "saved">>({});
  const [tokenDrafts, setTokenDrafts] = useState<Record<string, { name?: string; size?: CreatureSize; speed?: string; maxHp?: string; artAsset?: string }>>({});
  const [hpDelta, setHpDelta] = useState("-1");
  const [effectName, setEffectName] = useState("");
  const [effectType, setEffectType] = useState("condition");
  const [effectDuration, setEffectDuration] = useState("1");
  const [effectReminder, setEffectReminder] = useState("end");
  const [effectEditorTokenId, setEffectEditorTokenId] = useState<string | null>(null);
  const [tokenEditorTokenId, setTokenEditorTokenId] = useState<string | null>(null);
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [creatures, setCreatures] = useState<CreatureTemplate[]>([]);
  const [creatureFamilies, setCreatureFamilies] = useState<string[]>([]);
  const [creatureQuery, setCreatureQuery] = useState("");
  const [creatureFamily, setCreatureFamily] = useState("");
  const [creatureCursor, setCreatureCursor] = useState<string | null>(null);
  const [creatureCatalogLoading, setCreatureCatalogLoading] = useState(false);
  const [creatureCatalogError, setCreatureCatalogError] = useState("");
  const [armedCreatureId, setArmedCreatureId] = useState<string | null>(null);
  const [placementPreview, setPlacementPreview] = useState<PlacementPreview | null>(null);
  const [placementSummonerId, setPlacementSummonerId] = useState("");
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, centerX: 12, centerY: 8, mapKey: "", fit: false });
  const [panning, setPanning] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousClaimedTokenRef = useRef<SharedToken | null>(null);
  const dragGestureRef = useRef<DragGesture | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);
  const annotationStartRef = useRef<{ pointerId: number; point: MapPoint } | null>(null);
  const pingStartedAtRef = useRef<Map<string, number>>(new Map());
  const pingAudioContextRef = useRef<AudioContext | null>(null);
  const pendingMovesRef = useRef<Map<string, PendingMove>>(new Map());
  const pendingCreatesRef = useRef<Map<string, SharedToken>>(new Map());
  const pendingDeletesRef = useRef<Set<string>>(new Set());
  const moveSequenceRef = useRef(0);
  const tokenMutationSequenceRef = useRef(0);
  const creatureCatalogRequestRef = useRef(0);

  const acceptAuthoritativeState = useCallback((next: EncounterState) => {
    setState((current) => {
      if (current && next.encounter.version < current.encounter.version) return current;
      const pendingMoves = pendingMovesRef.current;
      const pendingCreates = pendingCreatesRef.current;
      const pendingDeletes = pendingDeletesRef.current;
      if (pendingMoves.size === 0 && pendingCreates.size === 0 && pendingDeletes.size === 0) return next;
      const tokens = next.tokens
        .filter((token) => !pendingDeletes.has(token.id))
        .map((token) => {
          const pending = pendingMoves.get(token.id);
          return pending ? { ...token, x: pending.x, y: pending.y } : token;
        });
      return {
        ...next,
        tokens: [...tokens, ...[...pendingCreates.values()].filter((token) => !tokens.some((currentToken) => currentToken.id === token.id))],
      };
    });
  }, []);

  const normalizedCode = encounterCode.trim().toUpperCase() || DEFAULT_CODE;
  const joinedCode = state?.encounter.code;
  const participantId = participant?.id;
  const controlledTokens = state?.tokens.filter((token) => token.owner?.participantId === participantId) ?? [];
  const primaryToken = controlledTokens.find((token) => !token.summonerTokenId) ?? null;
  const effectiveSelectedTokenId = selectedTokenId ?? controlledTokens[0]?.id ?? null;
  const selectedToken = state?.tokens.find((token) => token.id === effectiveSelectedTokenId) ?? null;
  const movementEnabled = connection === "live" && !busy && state?.encounter.status !== "paused";
  const distance = state && dragOrigin && preview
    ? calculateDirectDistance(dragOrigin, preview, state.grid.feetPerCell)
    : 0;
  const remainingMovement = selectedToken ? Math.max(0, selectedToken.speed - selectedToken.movementUsed) : 0;
  const overMovement = distance > remainingMovement + 0.05;
  const placementArtAsset = placementPreview?.creature.artAsset ?? null;

  const enablePingAudio = () => {
    if (typeof AudioContext === "undefined") return;
    if (!pingAudioContextRef.current || pingAudioContextRef.current.state === "closed") {
      pingAudioContextRef.current = new AudioContext();
    }
    if (pingAudioContextRef.current.state === "suspended") void pingAudioContextRef.current.resume().catch(() => undefined);
  };

  const join = async (identity: JoinIdentity) => {
    const name = identity.participantName;
    enablePingAudio();
    setJoiningIdentity(identity.label); setBusy(true); setError("");
    try {
      const result = await api<{ participantId: string; sessionSecret: string; role: Role; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(normalizedCode)}/join`,
        { method: "POST", body: JSON.stringify({ participantName: name, role: identity.role }) },
      );
      const joined = { id: result.participantId, name, role: result.role, sessionSecret: result.sessionSecret };
      setParticipant(joined); setState(result.state); setEncounterCode(result.state.encounter.code); setConnection("connecting");
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Unable to join.");
    } finally { setJoiningIdentity(null); setBusy(false); }
  };

  useEffect(() => {
    if (!participant || !joinedCode) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let lastVersion = state?.encounter.version ?? 0;
    const headers = viewerHeaders(participant);
    const markLive = () => {
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      if (navigator.onLine) setConnection("live");
    };
    const scheduleLost = () => {
      setConnection((current) => current === "lost" ? "lost" : "reconnecting");
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = setTimeout(() => { if (!disposed) setConnection("lost"); }, 8_000);
    };
    const refresh = async () => {
      const fresh = await api<EncounterState>(`/api/encounters/${encodeURIComponent(joinedCode)}/state`, { headers });
      if (!disposed) { lastVersion = fresh.encounter.version; acceptAuthoritativeState(fresh); markLive(); }
    };
    const listen = async () => {
      try { await refresh(); } catch { scheduleLost(); }
      while (!disposed) {
        controller = new AbortController();
        try {
          const response = await fetch(
            `/api/encounters/${encodeURIComponent(joinedCode)}/events?since=${lastVersion}`,
            { signal: controller.signal, cache: "no-store", headers },
          );
          if (disposed) return;
          if (response.status === 204) { markLive(); await new Promise((resolve) => setTimeout(resolve, 250)); continue; }
          if (!response.ok) throw new Error("Live updates are unavailable.");
          const next = (await response.json()) as EncounterState;
          lastVersion = next.encounter.version; acceptAuthoritativeState(next); markLive();
          await new Promise((resolve) => setTimeout(resolve, 250));
        } catch (listenError) {
          if (disposed || (listenError instanceof DOMException && listenError.name === "AbortError")) return;
          scheduleLost(); await new Promise((resolve) => setTimeout(resolve, 750));
        }
      }
    };
    void listen();
    return () => { disposed = true; controller?.abort(); if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant?.id, joinedCode]);

  useEffect(() => {
    if (!participant || !joinedCode) return;
    const heartbeat = () => api<{ present: boolean }>(
      `/api/encounters/${encodeURIComponent(joinedCode)}/heartbeat`,
      { method: "POST", body: sessionPayload(participant) },
    ).catch(() => setConnection((current) => current === "lost" ? "lost" : "reconnecting"));
    const onVisible = () => { if (document.visibilityState === "visible") void heartbeat(); };
    void heartbeat();
    const timer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible); window.addEventListener("focus", heartbeat);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", heartbeat); };
  }, [joinedCode, participant]);

  useEffect(() => {
    const previous = previousClaimedTokenRef.current;
    if (previous && !primaryToken) {
      setPreview(null); setDragOrigin(null);
      setNotice(`${previous.name} was released after inactivity or reconnected elsewhere.`);
    }
    previousClaimedTokenRef.current = primaryToken;
  }, [primaryToken]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4_200);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const receivedAt = Date.now();
    for (const annotation of state?.annotations ?? []) {
      if (annotation.type !== "ping" || pingStartedAtRef.current.has(annotation.id)) continue;
      pingStartedAtRef.current.set(annotation.id, receivedAt);
      if (pingAudioContextRef.current) playPingSound(pingAudioContextRef.current);
    }
  }, [state?.annotations]);

  useEffect(() => () => {
    if (pingAudioContextRef.current) void pingAudioContextRef.current.close();
  }, []);

  useEffect(() => {
    if (!paletteOpen || participant?.role !== "dm") return;
    const requestId = ++creatureCatalogRequestRef.current;
    const timer = window.setTimeout(() => {
      setCreatureCatalogLoading(true);
      setCreatureCatalogError("");
      const params = new URLSearchParams({ limit: "24" });
      if (creatureQuery.trim()) params.set("q", creatureQuery.trim());
      if (creatureFamily) params.set("family", creatureFamily);
      void api<CreatureCatalogPage>(`/api/creatures?${params}`).then((catalog) => {
        if (creatureCatalogRequestRef.current !== requestId) return;
        setCreatures(catalog.items);
        setCreatureFamilies(catalog.families);
        setCreatureCursor(catalog.nextCursor);
      }).catch((catalogError) => {
        if (creatureCatalogRequestRef.current !== requestId) return;
        setCreatures([]);
        setCreatureCursor(null);
        setCreatureCatalogError(catalogError instanceof Error ? catalogError.message : "Unable to load creatures.");
      }).finally(() => {
        if (creatureCatalogRequestRef.current === requestId) setCreatureCatalogLoading(false);
      });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      if (creatureCatalogRequestRef.current === requestId) creatureCatalogRequestRef.current += 1;
    };
  }, [creatureFamily, creatureQuery, paletteOpen, participant?.role]);

  useEffect(() => {
    const mapPackage = state?.encounter.mapPackage;
    if (!mapPackage) return;
    const assets = [...new Set([
      mapPackage.visual.assetUrl,
      ...mapPackage.sceneObjects.map((object) => object.assetUrl),
    ])];
    let disposed = false;
    void Promise.all(assets.map((path) => new Promise<[string, HTMLImageElement] | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve([path, image]);
      image.onerror = () => resolve(null);
      image.src = path;
    }))).then((entries) => {
      if (disposed) return;
      const scene = document.createElement("canvas");
      scene.width = mapPackage.visual.pixelWidth;
      scene.height = mapPackage.visual.pixelHeight;
      renderMapPackageToCanvas(scene, mapPackage, new Map(entries.filter((entry): entry is [string, HTMLImageElement] => entry !== null)), true);
      setRenderedMapScene({ mapId: mapPackage.id, canvas: scene });
    });
    return () => { disposed = true; };
  }, [state?.encounter.mapPackage]);

  useEffect(() => {
    const assets = [...new Set([
      ...(state?.tokens.flatMap((token) => token.artAsset ? [token.artAsset] : []) ?? []),
      ...(placementArtAsset ? [placementArtAsset] : []),
    ])];
    if (assets.length === 0) return;
    let disposed = false;
    void Promise.all(assets.map((path) => new Promise<[string, HTMLImageElement]>((resolve) => {
      const image = new Image(); image.onload = () => resolve([path, image]); image.onerror = () => resolve([path, image]); image.src = path;
    }))).then((entries) => { if (!disposed) setTokenArt(new Map(entries)); });
    return () => { disposed = true; };
  }, [placementArtAsset, state?.tokens]);

  const redraw = useCallback((animationNow = Date.now()) => {
    const mapScene = state?.encounter.mapPackage && renderedMapScene?.mapId === state.encounter.mapPackage.id ? renderedMapScene.canvas : null;
    if (canvasRef.current && state && participant) drawMap(canvasRef.current, state, preview, placementPreview, dragOrigin, participant, mapScene, tokenArt, viewport, pingStartedAtRef.current, animationNow);
  }, [dragOrigin, participant, placementPreview, preview, renderedMapScene, state, tokenArt, viewport]);
  useEffect(() => {
    redraw(); const canvas = canvasRef.current; if (!canvas) return;
    const observer = new ResizeObserver(() => redraw()); observer.observe(canvas); return () => observer.disconnect();
  }, [redraw]);

  useEffect(() => {
    const hasAnimatingPing = () => state?.annotations.some((annotation) => {
      const startedAt = pingStartedAtRef.current.get(annotation.id);
      return annotation.type === "ping" && startedAt !== undefined && Date.now() - startedAt < PING_DURATION_MS;
    });
    if (!hasAnimatingPing()) return;
    let frameId = 0;
    const animate = () => {
      redraw(Date.now());
      if (hasAnimatingPing()) frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [redraw, state?.annotations]);

  const refreshAfterError = async () => {
    if (!participant || !state) return;
    const fresh = await api<EncounterState>(
      `/api/encounters/${encodeURIComponent(state.encounter.code)}/state`,
      { headers: viewerHeaders(participant) },
    ).catch(() => null);
    if (fresh) acceptAuthoritativeState(fresh);
  };

  const command = async <T extends { state: EncounterState }>(
    name: string,
    extra: Record<string, unknown> = {},
    beforeAccept?: (result: T) => void,
  ) => {
    if (!participant || !state) throw new Error("Join the encounter first.");
    const result = await api<T>(`/api/encounters/${encodeURIComponent(state.encounter.code)}/command`, {
      method: "POST", body: sessionPayload(participant, { command: name, ...extra }),
    });
    beforeAccept?.(result);
    acceptAuthoritativeState(result.state); return result;
  };

  const runCommand = async (name: string, extra: Record<string, unknown> = {}, success?: string) => {
    setBusy(true); setError("");
    try { await command(name, extra); if (success) setNotice(success); }
    catch (commandError) { setError(commandError instanceof Error ? commandError.message : "Action rejected."); await refreshAfterError(); }
    finally { setBusy(false); }
  };

  const saveInitiative = async (token: SharedToken) => {
    const draft = initiativeDrafts[token.id];
    if (draft === undefined) return;
    if (draft === "") {
      setInitiativeDrafts((current) => { const next = { ...current }; delete next[token.id]; return next; });
      setInitiativeStatuses((current) => ({ ...current, [token.id]: "saved" }));
      return;
    }
    const initiative = Number(draft);
    if (!Number.isInteger(initiative) || initiative < 0 || initiative > 99) {
      setError("Initiative must be a whole number from 0 to 99.");
      return;
    }
    if (initiative === token.initiative) {
      setInitiativeDrafts((current) => { const next = { ...current }; delete next[token.id]; return next; });
      setInitiativeStatuses((current) => ({ ...current, [token.id]: "saved" }));
      return;
    }
    setBusy(true); setError("");
    setInitiativeStatuses((current) => ({ ...current, [token.id]: "saving" }));
    try {
      await command("set-initiative", { tokenId: token.id, initiative });
      setInitiativeDrafts((current) => { const next = { ...current }; delete next[token.id]; return next; });
      setInitiativeStatuses((current) => ({ ...current, [token.id]: "saved" }));
    } catch (initiativeError) {
      setInitiativeStatuses((current) => ({ ...current, [token.id]: "editing" }));
      setError(initiativeError instanceof Error ? initiativeError.message : "Initiative rejected.");
      await refreshAfterError();
    } finally { setBusy(false); }
  };

  const addEffectToToken = async (tokenId: string) => {
    const name = effectName.trim();
    if (!name) return;
    setBusy(true); setError("");
    try {
      await command("add-effect", {
        tokenId,
        name,
        effectType,
        reminderTiming: effectReminder,
        durationRounds: Number(effectDuration),
      });
      setNotice(`${name} added.`); setEffectName(""); setEffectEditorTokenId(null);
    } catch (effectError) {
      setError(effectError instanceof Error ? effectError.message : "Effect rejected.");
      await refreshAfterError();
    } finally { setBusy(false); }
  };

  const loadMoreCreatures = async () => {
    if (!creatureCursor || creatureCatalogLoading) return;
    const requestId = ++creatureCatalogRequestRef.current;
    setCreatureCatalogLoading(true);
    setCreatureCatalogError("");
    const params = new URLSearchParams({ limit: "24", cursor: creatureCursor });
    if (creatureQuery.trim()) params.set("q", creatureQuery.trim());
    if (creatureFamily) params.set("family", creatureFamily);
    try {
      const catalog = await api<CreatureCatalogPage>(`/api/creatures?${params}`);
      if (creatureCatalogRequestRef.current !== requestId) return;
      setCreatures((current) => {
        const known = new Set(current.map((creature) => creature.id));
        return [...current, ...catalog.items.filter((creature) => !known.has(creature.id))];
      });
      setCreatureFamilies(catalog.families);
      setCreatureCursor(catalog.nextCursor);
    } catch (catalogError) {
      if (creatureCatalogRequestRef.current === requestId) {
        setCreatureCatalogError(catalogError instanceof Error ? catalogError.message : "Unable to load more creatures.");
      }
    } finally {
      if (creatureCatalogRequestRef.current === requestId) setCreatureCatalogLoading(false);
    }
  };

  const placeCreature = async (creature: CreatureTemplate, point: MapPoint) => {
    if (!participant || !state || participant.role !== "dm" || !movementEnabled) return;
    const matchingCount = state.tokens.filter((token) => token.artAsset === creature.artAsset).length;
    const name = matchingCount === 0 ? creature.name : `${creature.name} ${matchingCount + 1}`;
    const summoner = placementSummonerId ? state.tokens.find((token) => token.id === placementSummonerId) : null;
    const temporaryId = `pending-create-${Date.now()}-${++tokenMutationSequenceRef.current}`;
    const optimisticToken: SharedToken = {
      id: temporaryId,
      name,
      artAsset: creature.artAsset,
      kind: placementSummonerId ? "summon" : "monster",
      size: creature.size,
      speed: creature.defaultSpeed,
      hp: creature.defaultHp,
      maxHp: creature.defaultHp,
      healthState: null,
      hidden: false,
      summonerTokenId: placementSummonerId || null,
      initiative: summoner?.initiative ?? null,
      initiativeOrder: summoner?.initiativeOrder ?? null,
      turnComplete: false,
      movementUsed: 0,
      effects: [],
      owner: summoner?.owner ?? null,
      x: point.x,
      y: point.y,
    };
    pendingCreatesRef.current.set(temporaryId, optimisticToken);
    setState((current) => current ? { ...current, tokens: [...current.tokens, optimisticToken] } : current);
    setPlacementPreview(null);
    setError("");
    try {
      await command<{ tokenId: string; state: EncounterState }>("create-token", {
        name,
        kind: placementSummonerId ? "summon" : "monster",
        size: creature.size,
        speed: creature.defaultSpeed,
        maxHp: creature.defaultHp,
        hp: creature.defaultHp,
        artAsset: creature.artAsset,
        summonerTokenId: placementSummonerId || undefined,
        x: point.x,
        y: point.y,
      }, (confirmed) => {
        pendingCreatesRef.current.delete(temporaryId);
        setState((current) => current ? { ...current, tokens: current.tokens.filter((token) => token.id !== temporaryId) } : current);
        setSelectedTokenId(confirmed.tokenId);
      });
      setNotice(`${name} placed at ${creature.defaultHp} HP.`);
    } catch (placementError) {
      pendingCreatesRef.current.delete(temporaryId);
      setState((current) => current ? { ...current, tokens: current.tokens.filter((token) => token.id !== temporaryId) } : current);
      setError(placementError instanceof Error ? placementError.message : "Creature placement was rejected.");
      await refreshAfterError();
    }
  };

  const deleteToken = async (token: SharedToken) => {
    if (!participant || !state || participant.role !== "dm" || pendingCreatesRef.current.has(token.id)) return;
    pendingDeletesRef.current.add(token.id);
    pendingMovesRef.current.delete(token.id);
    setState((current) => current ? { ...current, tokens: current.tokens.filter((currentToken) => currentToken.id !== token.id) } : current);
    setSelectedTokenId((current) => current === token.id ? null : current);
    setError("");
    try {
      await command("delete-token", { tokenId: token.id }, () => {
        pendingDeletesRef.current.delete(token.id);
      });
      setNotice("Token removed.");
    } catch (deleteError) {
      pendingDeletesRef.current.delete(token.id);
      setState((current) => current && !current.tokens.some((currentToken) => currentToken.id === token.id)
        ? { ...current, tokens: [...current.tokens, token] }
        : current);
      setError(deleteError instanceof Error ? deleteError.message : "Token deletion was rejected.");
      await refreshAfterError();
    }
  };

  const paletteCreature = (id: string | null) => creatures.find((creature) => creature.id === id) ?? null;

  const onPaletteDragStart = (event: ReactDragEvent<HTMLButtonElement>, creature: CreatureTemplate) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-creature-id", creature.id);
    setArmedCreatureId(creature.id);
  };

  const onMapDragOver = (event: ReactDragEvent<HTMLCanvasElement>) => {
    if (!state || !participant || participant.role !== "dm" || !movementEnabled) return;
    const creature = paletteCreature(event.dataTransfer.getData("application/x-creature-id") || armedCreatureId);
    if (!creature) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(creature.size));
    setPlacementPreview({ creature, ...point });
  };

  const onMapDrop = (event: ReactDragEvent<HTMLCanvasElement>) => {
    if (!state || !participant || participant.role !== "dm" || !movementEnabled) return;
    const creature = paletteCreature(event.dataTransfer.getData("application/x-creature-id") || armedCreatureId);
    if (!creature) return;
    event.preventDefault();
    const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(creature.size));
    void placeCreature(creature, point);
  };

  const claimToken = async (token: SharedToken) => {
    if (!participant || !state) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ recovered: boolean; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(state.encounter.code)}/claim`,
        { method: "POST", body: sessionPayload(participant, { tokenId: token.id }) },
      );
      acceptAuthoritativeState(result.state); setSelectedTokenId(token.id);
      setNotice(result.recovered ? `${token.name} reconnected.` : `${token.name} is yours.`);
    } catch (claimError) { setError(claimError instanceof Error ? claimError.message : "Unable to claim token."); }
    finally { setBusy(false); }
  };

  const relinquishToken = async () => {
    if (!participant || !state || !primaryToken) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(state.encounter.code)}/relinquish`,
        { method: "POST", body: sessionPayload(participant, { tokenId: primaryToken.id }) },
      );
      previousClaimedTokenRef.current = null; acceptAuthoritativeState(result.state); setSelectedTokenId(null); setNotice(`${primaryToken.name} released.`);
    } catch (releaseError) { setError(releaseError instanceof Error ? releaseError.message : "Unable to release token."); }
    finally { setBusy(false); }
  };

  const publishMove = async (tokenId: string, destination: MapPoint, encounter = state?.encounter.code) => {
    if (!participant || !encounter) return;
    const sequence = ++moveSequenceRef.current;
    pendingMovesRef.current.set(tokenId, { ...destination, sequence });
    setState((current) => current ? {
      ...current,
      tokens: current.tokens.map((token) => token.id === tokenId ? { ...token, ...destination } : token),
    } : current);
    setPreview(null); setDragOrigin(null); setError("");
    try {
      const result = await api<{ distance: number; overBudget: boolean; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(encounter)}/move`,
        { method: "POST", body: sessionPayload(participant, { tokenId, ...destination }) },
      );
      if (pendingMovesRef.current.get(tokenId)?.sequence === sequence) pendingMovesRef.current.delete(tokenId);
      acceptAuthoritativeState(result.state);
      setNotice(result.overBudget
        ? `Move confirmed · ${result.distance} ft · over movement.`
        : `Move confirmed · ${result.distance} ft.`);
    } catch (moveError) {
      if (pendingMovesRef.current.get(tokenId)?.sequence === sequence) pendingMovesRef.current.delete(tokenId);
      setError(moveError instanceof Error ? moveError.message : "Move rejected.");
      await refreshAfterError();
    }
  };

  const addAnnotation = async (type: AnnotationMode, start: MapPoint, end?: MapPoint) => {
    if (type === "move" || type === "erase") return;
    await runCommand("add-annotation", {
      annotationType: type,
      x: start.x, y: start.y,
      x2: end?.x, y2: end?.y,
      color: type === "spotlight" ? "#f5c65c" : "#75c8d8",
    }, type === "drawing" ? "Tactical line shared." : type === "spotlight" ? "DM spotlight shared." : undefined);
    setAnnotationMode("move");
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
    void runCommand("remove-annotation", { annotationId: annotation.id }, "Line erased.");
  };

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!state || !participant || !movementEnabled) return;
    if (event.button !== 0) return;
    const armedCreature = participant.role === "dm" ? paletteCreature(armedCreatureId) : null;
    if (armedCreature) {
      event.preventDefault();
      const placementPoint = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(armedCreature.size));
      void placeCreature(armedCreature, placementPoint);
      return;
    }
    const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY);
    if (annotationMode !== "move") {
      event.preventDefault();
      if (annotationMode === "erase") {
        eraseAnnotationAtPoint(event.currentTarget, point);
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      if (annotationMode === "drawing") annotationStartRef.current = { pointerId: event.pointerId, point };
      else void addAnnotation(annotationMode, point);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const geometry = viewportGeometry(viewport, state, rect.width, rect.height);
    const hitToken = [...state.tokens].reverse().find((token) => {
      if (pendingCreatesRef.current.has(token.id)) return false;
      const controllable = participant.role === "dm" || token.owner?.participantId === participant.id;
      if (!controllable) return false;
      const deltaX = (point.x - token.x) * geometry.cellSize;
      const deltaY = (point.y - token.y) * geometry.cellSize;
      const radius = geometry.cellSize * tokenRadiusCells(token.size);
      return Math.hypot(deltaX, deltaY) <= radius;
    });
    if (hitToken && !dragGestureRef.current) {
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedTokenId(hitToken.id);
      const gesture: DragGesture = {
        pointerId: event.pointerId, tokenId: hitToken.id,
        origin: { x: hitToken.x, y: hitToken.y }, latest: { x: hitToken.x, y: hitToken.y },
        grabOffset: { x: point.x - hitToken.x, y: point.y - hitToken.y },
      };
      dragGestureRef.current = gesture; setDragging(true); setPreview({ tokenId: hitToken.id, x: hitToken.x, y: hitToken.y });
      setDragOrigin(gesture.origin);
      return;
    }
    if (!panGestureRef.current) {
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      panGestureRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        viewport: { zoom: geometry.fit ? 1 : geometry.zoom, centerX: geometry.centerX, centerY: geometry.centerY, mapKey: geometry.mapKey, fit: geometry.fit },
      };
      setPanning(true);
    }
  };

  const dragPoint = (canvas: HTMLCanvasElement, gesture: DragGesture, clientX: number, clientY: number) => {
    if (!state) return gesture.latest;
    const token = state.tokens.find((item) => item.id === gesture.tokenId);
    const radius = tokenRadiusCells(token?.size ?? "medium");
    const pointer = pointerToMap(canvas, state, viewport, clientX, clientY, radius);
    return clampMapPoint(state, { x: pointer.x - gesture.grabOffset.x, y: pointer.y - gesture.grabOffset.y }, radius);
  };

  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
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
    event.preventDefault(); gesture.latest = dragPoint(event.currentTarget, gesture, event.clientX, event.clientY);
    setPreview({ tokenId: gesture.tokenId, ...gesture.latest });
  };

  const onCanvasPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pan = panGestureRef.current;
    if (pan?.pointerId === event.pointerId) {
      event.preventDefault(); panGestureRef.current = null; setPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const drawing = annotationStartRef.current;
    if (drawing?.pointerId === event.pointerId && state) {
      const end = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY);
      annotationStartRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      void addAnnotation("drawing", drawing.point, end); return;
    }
    const gesture = dragGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault(); gesture.latest = dragPoint(event.currentTarget, gesture, event.clientX, event.clientY);
    dragGestureRef.current = null; setPreview({ tokenId: gesture.tokenId, ...gesture.latest }); setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (Math.hypot(gesture.latest.x - gesture.origin.x, gesture.latest.y - gesture.origin.y) < 0.001) {
      setPreview(null); setDragOrigin(null); return;
    }
    void publishMove(gesture.tokenId, gesture.latest);
  };

  const onCanvasPointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    annotationStartRef.current = null;
    if (panGestureRef.current?.pointerId === event.pointerId) {
      panGestureRef.current = null; setPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const gesture = dragGestureRef.current; if (!gesture || gesture.pointerId !== event.pointerId) return;
    dragGestureRef.current = null; setPreview(null); setDragOrigin(null); setDragging(false);
  };

  const onCanvasWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    if (!state) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const focusX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const focusY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setViewport((current) => zoomViewportAt(current, state, rect.width, rect.height, current.zoom * Math.exp(-event.deltaY * 0.0015), focusX, focusY));
  };

  const nudgeViewport = (deltaX: number, deltaY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setViewport((current) => clampViewport({
      ...current,
      centerX: current.centerX + deltaX / current.zoom,
      centerY: current.centerY + deltaY / current.zoom,
    }, state, rect.width, rect.height));
  };

  const changeZoom = (amount: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setViewport((current) => {
      const geometry = viewportGeometry(current, state, rect.width, rect.height);
      return zoomViewportAt(current, state, rect.width, rect.height, geometry.zoom < 1 && amount > 0 ? 1 : geometry.zoom + amount);
    });
  };

  const fitViewport = () => {
    setViewport({
      zoom: 1,
      centerX: state.grid.width / 2,
      centerY: state.grid.height / 2,
      mapKey: `${state.encounter.mapPackage?.id ?? "empty"}:${state.grid.width}x${state.grid.height}`,
      fit: true,
    });
  };

  if (!participant || !state) {
    return (
      <main className="join-shell"><section className="join-card" aria-labelledby="join-title">
        <div className="eyebrow">Living encounter · Tactical companion</div>
        <h1 id="join-title">Enter the Ember Keep</h1>
        <p>Choose your seat for this encounter.</p>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <div className="join-options" role="group" aria-label="Choose participant">
          {JOIN_IDENTITIES.map((identity, index) => (
            <button key={identity.label} className="join-option-button" onClick={() => void join(identity)} disabled={busy} autoFocus={index === 0}>
              {joiningIdentity === identity.label ? "Joining…" : identity.label}
            </button>
          ))}
        </div>
      </section></main>
    );
  }

  const connectionLabel = connection === "live" ? "Live" : connection === "lost" ? "Connection lost" : connection === "reconnecting" ? "Reconnecting" : "Connecting";
  const initiativeTokens = [...state.tokens].filter((token) => token.initiativeOrder !== null).sort((a, b) => (a.initiativeOrder ?? 999) - (b.initiativeOrder ?? 999) || a.name.localeCompare(b.name));

  if (participant.role === "dm" && workshopOpen) return <MapWorkshop
    activeMapPackage={state.encounter.mapPackage}
    activeMapPresetId={state.encounter.activeMapPresetId}
    savedPresets={state.savedMapPresets}
    onCommand={async (name, extra) => command<{ state: EncounterState; presetId?: string }>(name, extra)}
    onClose={() => setWorkshopOpen(false)}
  />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><div className="eyebrow">{state.encounter.status} · {state.encounter.code}</div><h1>{state.encounter.name}{state.encounter.currentRound > 0 ? ` · Round ${state.encounter.currentRound}` : ""}</h1></div>
        <div className={`connection-pill connection-${connection}`} aria-live="polite"><span className="connection-dot" />{connectionLabel}</div>
      </header>
      <div className="workspace">
        <section className="map-panel" aria-label="Shared battle map">
          <div className="map-toolbar" aria-label="Map tools">
            <div className="map-tool-group" role="group" aria-label="Tactical tools">
              <button className={`icon-tool${annotationMode === "move" ? " tool-active" : ""}`} aria-label="Move tokens" aria-pressed={annotationMode === "move"} data-tooltip="Move tokens" onClick={() => setAnnotationMode("move")}><span aria-hidden="true">✥</span></button>
              <button className={`icon-tool${annotationMode === "ping" ? " tool-active" : ""}`} aria-label="Ping map" aria-pressed={annotationMode === "ping"} data-tooltip="Ping map" onClick={() => { enablePingAudio(); setAnnotationMode("ping"); }}><span aria-hidden="true">◉</span></button>
              <button className={`icon-tool${annotationMode === "drawing" ? " tool-active" : ""}`} aria-label="Draw line" aria-pressed={annotationMode === "drawing"} data-tooltip="Draw line" onClick={() => setAnnotationMode("drawing")}><span aria-hidden="true">╱</span></button>
              <button className={`icon-tool${annotationMode === "erase" ? " tool-active" : ""}`} aria-label="Erase line" aria-pressed={annotationMode === "erase"} data-tooltip="Erase line" onClick={() => setAnnotationMode("erase")}><span aria-hidden="true">⌫</span></button>
              {participant.role === "dm" ? <button className={`icon-tool${annotationMode === "spotlight" ? " tool-active" : ""}`} aria-label="Place spotlight" aria-pressed={annotationMode === "spotlight"} data-tooltip="Spotlight" onClick={() => setAnnotationMode("spotlight")}><span aria-hidden="true">◎</span></button> : null}
              {participant.role === "dm" ? <button className="icon-tool" aria-label="Clear all annotations" data-tooltip="Clear all" onClick={() => void runCommand("clear-annotations", {}, "Annotations cleared.")}><span aria-hidden="true">⊘</span></button> : null}
            </div>
            {participant.role === "dm" ? <button className={paletteOpen ? "tool-active creature-tool" : "creature-tool"} onClick={() => { setPaletteOpen((open) => !open); setAnnotationMode("move"); }}><span aria-hidden="true">♞</span> Creatures</button> : null}
            {participant.role === "dm" ? <button className="icon-tool" aria-label="Open Map Workshop" data-tooltip="Map Workshop" onClick={() => setWorkshopOpen(true)}><span aria-hidden="true">▦</span></button> : null}
            <span className="toolbar-spacer" />
            <div className="map-tool-group viewport-tools" role="group" aria-label="Map view">
              <button className="icon-tool" aria-label="Pan left" data-tooltip="Pan left" onClick={() => nudgeViewport(-1, 0)}>←</button>
              <button className="icon-tool" aria-label="Pan up" data-tooltip="Pan up" onClick={() => nudgeViewport(0, -1)}>↑</button>
              <button className="icon-tool" aria-label="Pan down" data-tooltip="Pan down" onClick={() => nudgeViewport(0, 1)}>↓</button>
              <button className="icon-tool" aria-label="Pan right" data-tooltip="Pan right" onClick={() => nudgeViewport(1, 0)}>→</button>
              <button className={`icon-tool${viewport.fit ? " tool-active" : ""}`} aria-label="Fit whole map" aria-pressed={viewport.fit} data-tooltip="Fit whole map" onClick={fitViewport}>⛶</button>
              <button className="icon-tool" aria-label="Zoom out" data-tooltip="Zoom out" onClick={() => changeZoom(-0.5)}>−</button>
              <button className="icon-tool" aria-label="Zoom in" data-tooltip="Zoom in" onClick={() => changeZoom(0.5)}>+</button>
              <button className="zoom-value" aria-label="Reset zoom" data-tooltip="Reset zoom" onClick={() => setViewport({ zoom: 1, centerX: state.grid.width / 2, centerY: state.grid.height / 2, mapKey: `${state.encounter.mapPackage?.id ?? "empty"}:${state.grid.width}x${state.grid.height}`, fit: false })}>{viewport.fit ? "Fit" : `${Math.round((viewport.mapKey === `${state.encounter.mapPackage?.id ?? "empty"}:${state.grid.width}x${state.grid.height}` ? viewport.zoom : 1) * 100)}%`}</button>
            </div>
          </div>
          <div className="map-stage">
          <div className="map-frame" style={{ aspectRatio: `${state.grid.width} / ${state.grid.height}` }}>
            <canvas ref={canvasRef} className={`map-canvas${dragging ? " is-dragging" : ""}${panning ? " is-panning" : ""}${armedCreatureId ? " is-placing" : ""}${annotationMode === "erase" ? " is-erasing" : ""}${movementEnabled ? "" : " is-blocked"}`} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerCancel={onCanvasPointerCancel} onWheel={onCanvasWheel} onDragOver={onMapDragOver} onDrop={onMapDrop} onDragLeave={() => setPlacementPreview(null)} aria-label={`${state.grid.width} by ${state.grid.height} battle grid with ${state.tokens.length} visible tokens. ${armedCreatureId ? "Click to place the selected creature." : annotationMode === "erase" ? "Erase mode. Click a drawn line to remove it." : participant.role === "dm" ? "Drag any token to move it, or drag empty map space to pan." : selectedToken ? `Selected ${selectedToken.name}. Drag the token to move it, or drag empty map space to pan.` : "Scroll to zoom and drag empty map space to pan."}`} role="img" />
            {participant.role === "dm" && paletteOpen ? <section className="creature-palette" aria-label="Creature palette">
              <div className="palette-heading"><div><small>Quick placement</small><h2>Creature palette</h2></div><button aria-label="Close creature palette" onClick={() => { setPaletteOpen(false); setArmedCreatureId(null); setPlacementPreview(null); }}>×</button></div>
              <label className="palette-controller">Control<select value={placementSummonerId} onChange={(event) => setPlacementSummonerId(event.target.value)}><option value="">DM-controlled creature</option>{state.tokens.filter((token) => token.kind === "character" && !token.summonerTokenId).map((token) => <option value={token.id} key={token.id}>Summoned by {token.name}</option>)}</select></label>
              <p>Drag a creature onto the map, or select one and click repeatedly to place copies.</p>
              <div className="palette-search">
                <label><span>Find</span><input type="search" value={creatureQuery} onChange={(event) => { setCreatureQuery(event.target.value); setArmedCreatureId(null); setPlacementPreview(null); }} placeholder="Search creatures" autoComplete="off" /></label>
                <label><span>Family</span><select value={creatureFamily} onChange={(event) => { setCreatureFamily(event.target.value); setArmedCreatureId(null); setPlacementPreview(null); }}><option value="">All</option>{creatureFamilies.map((family) => <option value={family} key={family}>{family}</option>)}</select></label>
              </div>
              <div className="creature-grid">
                {creatures.map((creature) => <button type="button" draggable className={`creature-tile${armedCreatureId === creature.id ? " is-armed" : ""}`} key={creature.id} onDragStart={(event) => onPaletteDragStart(event, creature)} onDragEnd={() => setPlacementPreview(null)} onClick={() => setArmedCreatureId((current) => current === creature.id ? null : creature.id)} aria-pressed={armedCreatureId === creature.id}>
                  {/* The catalog thumbnail is intentionally lazy; full token art loads only when map rendering needs it. */}
                  <NextImage src={creature.thumbnailAsset} alt="" width={72} height={72} loading="lazy" unoptimized />
                  <span><strong>{creature.name}</strong><small>{creature.size} · AC {creature.armorClass} · HP {creature.defaultHp} · {creature.defaultSpeed} ft</small></span>
                </button>)}
              </div>
              {creatureCatalogLoading && creatures.length === 0 ? <div className="palette-status" role="status">Loading creatures…</div> : null}
              {!creatureCatalogLoading && !creatureCatalogError && creatures.length === 0 ? <div className="palette-status">No matching creatures.</div> : null}
              {creatureCatalogError ? <div className="palette-status is-error" role="alert">{creatureCatalogError}</div> : null}
              {creatureCursor ? <button className="palette-load-more" onClick={() => void loadMoreCreatures()} disabled={creatureCatalogLoading}>{creatureCatalogLoading ? "Loading…" : "Load more creatures"}</button> : null}
              {armedCreatureId ? <button className="palette-cancel" onClick={() => { setArmedCreatureId(null); setPlacementPreview(null); }}>Cancel placement</button> : null}
            </section> : null}
            {error ? <div className="map-message is-error" role="alert">{error}</div> : notice ? <div className="map-message" role="status">{notice}</div> : null}
            {connection !== "live" || state.encounter.status === "paused" ? <div className="map-safety-overlay"><strong>{state.encounter.status === "paused" ? "Encounter paused" : connectionLabel}</strong><span>Movement is paused until shared state is current.</span></div> : null}
          </div>
          </div>
          <div className="map-footer"><span>{state.grid.width} × {state.grid.height} squares</span><span>5 ft · equal-cost diagonals · free positioning</span><span>Server version {state.encounter.version}</span></div>
        </section>

        <aside className="control-panel" aria-label="Encounter controls">
          <div className="participant-row"><span className="participant-avatar">{participant.name.charAt(0).toUpperCase()}</span><span><small>{participant.role === "dm" ? "Dungeon Master" : "Joined as"}</small><strong>{participant.name}</strong></span></div>
          <div className="panel-rule" />

          <section className="initiative-panel">
            <div className="section-heading"><div><small>Combat clock</small><h2>Initiative</h2></div><strong>{state.encounter.currentRound ? `Round ${state.encounter.currentRound}` : "Setup"}</strong></div>
            <div className="initiative-list">
              {initiativeTokens.length ? initiativeTokens.map((token) => <div key={token.id} className={`initiative-entry${token.initiativeOrder === state.encounter.activeInitiativeOrder ? " is-active" : ""}${token.turnComplete ? " is-complete" : ""}`}><span>{token.initiative ?? "—"}</span><strong>{token.name}</strong><small>{token.turnComplete ? "Done" : token.initiativeOrder === state.encounter.activeInitiativeOrder ? "Active" : `#${(token.initiativeOrder ?? 0) + 1}`}</small></div>) : <p className="empty-copy">Enter initiative on token cards.</p>}
            </div>
            {participant.role === "dm" ? <div className="button-row"><button className="primary-button" onClick={() => void runCommand("start-combat", {}, "Combat started.")} disabled={busy}>Start combat</button><button className="secondary-button" onClick={() => void runCommand("advance-turn", {}, "Turn advanced.")} disabled={busy || state.encounter.status !== "active"}>Advance</button></div> : null}
            {participant.role === "dm" && initiativeTokens.length ? <div className="turn-correction"><label>Correct round<input type="number" min="1" value={Math.max(1, state.encounter.currentRound)} onChange={(event) => void runCommand("correct-turn", { round: Number(event.target.value), activeOrder: state.encounter.activeInitiativeOrder ?? 0 }, "Round corrected.")} /></label><label>Active group<select value={state.encounter.activeInitiativeOrder ?? 0} onChange={(event) => void runCommand("correct-turn", { round: Math.max(1, state.encounter.currentRound), activeOrder: Number(event.target.value) }, "Active turn corrected.")}>{[...new Set(initiativeTokens.map((token) => token.initiativeOrder))].map((order) => <option key={order} value={order ?? 0}>#{(order ?? 0) + 1}</option>)}</select></label></div> : null}
          </section>

          <div className="panel-rule" />
          <div className="token-roster">
            {state.tokens.map((token) => {
              const pendingCreate = pendingCreatesRef.current.has(token.id);
              const yours = token.owner?.participantId === participant.id;
              const controlled = participant.role === "dm" || yours;
              const sameName = !yours && token.owner?.name.toLocaleLowerCase() === participant.name.toLocaleLowerCase();
              const selected = token.id === selectedToken?.id;
              const active = token.initiativeOrder !== null && token.initiativeOrder === state.encounter.activeInitiativeOrder;
              return <section className={`token-card${selected ? " is-owned" : ""}`} key={token.id}>
                <button className="token-heading token-select" onClick={() => setSelectedTokenId(token.id)} disabled={pendingCreate}>
                  {token.artAsset ? <NextImage className="token-portrait" src={token.artAsset} alt="" width={48} height={48} unoptimized /> : <span className="token-mini">{tokenInitial(token)}</span>}
                  <div><small>{pendingCreate ? "Placing…" : `${token.hidden ? "Hidden · " : ""}${token.kind} · ${token.owner ? `controlled by ${token.owner.name}` : "unclaimed"}`}</small><h2>{token.name}</h2></div>
                </button>
                <div className="token-meta">
                  <span><small>Position</small><strong>{formatPosition(token)}</strong></span>
                  <span><small>Size</small><strong>{token.size.charAt(0).toUpperCase() + token.size.slice(1)}</strong></span>
                  <span><small>Speed</small><strong>{token.speed} ft</strong></span>
                  <span><small>HP</small><strong>{token.hp !== null && token.maxHp !== null ? `${token.hp}/${token.maxHp}` : "—"}</strong></span>
                </div>
                {selected ? <>
                  <div className="initiative-editor"><label>Initiative<input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={initiativeDrafts[token.id] ?? token.initiative ?? ""} onChange={(event) => { const next = event.target.value.replace(/\D/g, "").slice(0, 2); setInitiativeDrafts((current) => ({ ...current, [token.id]: next })); setInitiativeStatuses((current) => ({ ...current, [token.id]: "editing" })); }} onBlur={() => void saveInitiative(token)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} disabled={!controlled || busy} aria-describedby={`initiative-status-${token.id}`} /></label><span id={`initiative-status-${token.id}`} className={`initiative-save-status is-${initiativeStatuses[token.id] ?? "idle"}`} aria-live="polite">{!controlled ? "Controller only" : initiativeStatuses[token.id] === "saving" ? "Saving…" : initiativeStatuses[token.id] === "saved" ? "Saved" : "Enter or leave to save"}</span></div>
                  {controlled && token.hp !== null && token.maxHp !== null ? <div className="hp-row"><strong>HP {token.hp}/{token.maxHp}</strong><input aria-label="HP change" type="number" value={hpDelta} onChange={(event) => setHpDelta(event.target.value)} /><button onClick={() => void command<{ state: EncounterState; concentrationCheckRequired: boolean }>("apply-hp", { tokenId: token.id, delta: Number(hpDelta) }).then((result) => setNotice(result.concentrationCheckRequired ? "HP updated — concentration check reminder." : "HP updated.")).catch((hpError) => setError(hpError instanceof Error ? hpError.message : "HP rejected."))}>Apply</button></div> : null}
                  <div className="effect-list">{token.effects.map((effect) => <span className={effect.due ? "effect-chip is-due" : "effect-chip"} key={effect.id}>{effect.name}{effect.expiresRound ? ` · R${effect.expiresRound}` : ""}{controlled ? <button aria-label={`Remove ${effect.name}`} onClick={() => void runCommand("remove-effect", { effectId: effect.id })}>×</button> : null}</span>)}</div>
                  {controlled && effectEditorTokenId !== token.id ? <button className="inline-action effect-editor-toggle" onClick={() => { setEffectEditorTokenId(token.id); setEffectName(""); }}>+ Effect</button> : null}
                  {controlled && effectEditorTokenId === token.id ? <div className="compact-form effect-form"><select aria-label="Effect preset" defaultValue="" onChange={(event) => { const preset = event.target.value; if (preset === "bless") { setEffectName("Bless"); setEffectType("concentration"); setEffectDuration("10"); } else if (preset === "poisoned") { setEffectName("Poisoned"); setEffectType("condition"); setEffectDuration("1"); } else if (preset === "stunned") { setEffectName("Stunned"); setEffectType("condition"); setEffectDuration("1"); } }}><option value="">Preset…</option><option value="bless">Bless</option><option value="poisoned">Poisoned</option><option value="stunned">Stunned</option></select><input aria-label="Effect name" placeholder="Custom effect" value={effectName} onChange={(event) => setEffectName(event.target.value)} /><select aria-label="Effect type" value={effectType} onChange={(event) => setEffectType(event.target.value)}><option value="condition">Condition</option><option value="effect">Effect</option><option value="concentration">Concentration</option></select><select aria-label="Reminder timing" value={effectReminder} onChange={(event) => setEffectReminder(event.target.value)}><option value="start">Start of turn</option><option value="end">End of turn</option></select><input aria-label="Duration rounds" type="number" min="1" max="99" value={effectDuration} onChange={(event) => setEffectDuration(event.target.value)} /><button onClick={() => void addEffectToToken(token.id)} disabled={!effectName.trim() || busy}>Add</button><button className="effect-editor-cancel" onClick={() => { setEffectEditorTokenId(null); setEffectName(""); }}>Cancel</button></div> : null}
                  {controlled ? <div className="movement-summary"><span>Movement</span><strong>{token.movementUsed}/{token.speed} ft</strong></div> : null}
                  {controlled && preview?.tokenId === token.id ? <div className={`move-review${overMovement ? " is-over" : ""}`}><div><small>Destination</small><strong>{formatPosition(preview)}</strong></div><div><small>Direct / remaining</small><strong>{distance} / {remainingMovement} ft</strong></div></div> : null}
                  {active && controlled && !token.turnComplete ? <button className="end-turn-button" onClick={() => void runCommand("end-turn", { tokenId: token.id }, "Turn ended.")}>End Turn</button> : null}
                  {!token.owner && !primaryToken && !token.summonerTokenId && participant.role === "player" ? <button className="secondary-button" onClick={() => void claimToken(token)}>Claim token</button> : null}
                  {sameName && !primaryToken && !token.summonerTokenId ? <button className="secondary-button" onClick={() => void claimToken(token)}>Reconnect this token</button> : null}
                  {yours && token.id === primaryToken?.id ? <button className="inline-action" onClick={() => void relinquishToken()}>Release token</button> : null}
                  {participant.role === "dm" ? <div className="token-actions"><button className="inline-action" onClick={() => setTokenEditorTokenId((current) => current === token.id ? null : token.id)}>{tokenEditorTokenId === token.id ? "Close details" : "Edit details"}</button><button className="inline-action" onClick={() => void runCommand("update-token", { tokenId: token.id, hidden: !token.hidden }, token.hidden ? "Token revealed." : "Token hidden.")}>{token.hidden ? "Reveal" : "Hide"}</button><button className="inline-action is-danger" onClick={() => void deleteToken(token)}>Delete</button></div> : null}
                  {participant.role === "dm" && tokenEditorTokenId === token.id ? <div className="token-config">
                    <input aria-label="Token name" value={tokenDrafts[token.id]?.name ?? token.name} onChange={(event) => setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], name: event.target.value } }))} />
                    <div className="form-grid">
                      <label>Size<select aria-label="Token size" value={tokenDrafts[token.id]?.size ?? token.size} onChange={(event) => setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], size: event.target.value as CreatureSize } }))}>{CREATURE_SIZES.map((size) => <option value={size} key={size}>{size.charAt(0).toUpperCase() + size.slice(1)}</option>)}</select></label>
                      <label>Speed<input aria-label="Token speed" type="number" value={tokenDrafts[token.id]?.speed ?? token.speed} onChange={(event) => setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], speed: event.target.value } }))} /></label>
                      <label>Max HP<input aria-label="Token maximum HP" type="number" value={tokenDrafts[token.id]?.maxHp ?? token.maxHp ?? ""} onChange={(event) => setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], maxHp: event.target.value } }))} /></label>
                    </div>
                    <label>Portrait<select aria-label="Token portrait" value={tokenDrafts[token.id]?.artAsset ?? token.artAsset ?? ""} onChange={(event) => setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], artAsset: event.target.value } }))}><option value="">No portrait</option>{state.availableArt.map((path) => <option value={path} key={path}>{artLabel(path)}</option>)}</select></label>
                    <button className="secondary-button" onClick={() => { const draft = tokenDrafts[token.id] ?? {}; void runCommand("update-token", { tokenId: token.id, name: draft.name ?? token.name, size: draft.size ?? token.size, speed: Number(draft.speed ?? token.speed), maxHp: draft.maxHp === "" ? undefined : Number(draft.maxHp ?? token.maxHp), artAsset: draft.artAsset ?? token.artAsset ?? "" }, "Token details saved.").then(() => { setTokenDrafts((current) => { const next = { ...current }; delete next[token.id]; return next; }); setTokenEditorTokenId(null); }); }}>Save details</button>
                  </div> : null}
                </> : null}
              </section>;
            })}
          </div>

          {participant.role === "dm" ? <section className="dm-panel">
            <div className="section-heading"><div><small>Dungeon Master</small><h2>Encounter setup</h2></div></div>
            <div className="button-row"><button className="secondary-button" onClick={() => void runCommand("configure-encounter", { status: state.encounter.status === "paused" ? "active" : "paused" }, state.encounter.status === "paused" ? "Encounter resumed." : "Encounter paused.")}>{state.encounter.status === "paused" ? "Resume" : "Pause"}</button><button className="secondary-button" onClick={() => void runCommand("configure-encounter", { status: "setup" }, "Returned to setup.")}>Setup mode</button></div>
          </section> : null}

          <button className="undo-button" onClick={() => void runCommand("undo", {}, "Last reversible action undone.")} disabled={busy || state.undo.available === 0}>Undo my last action{state.undo.available ? ` (${state.undo.available}/10)` : ""}</button>

          {error ? <div className="form-error" role="alert">{error}</div> : null}
          {notice ? <div className="toast" role="status">{notice}</div> : null}
        </aside>
      </div>
    </main>
  );
}
