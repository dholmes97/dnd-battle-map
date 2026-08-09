"use client";

import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import NextImage from "next/image";
import MapWorkshop, { renderMapPackageToCanvas } from "@/app/map-workshop";
import {
  CREATURE_SIZES,
  type CreatureSize,
  type CreatureTemplate,
  tokenRadiusCells,
} from "@/shared/creature-library";
import { type MapPackage } from "@/shared/map-package";
import { displayHealth, healthBand } from "@/shared/health.mjs";
import {
  SPELL_EFFECT_KIND,
  SPELL_EFFECTS,
  spellEffectByArt,
  spellEffectById,
  type SpellEffectDefinition,
} from "@/shared/spell-effects";

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
  initiativeGroupId: string | null;
  initiativeOrder: number | null;
  turnComplete: boolean;
  movementUsed: number;
  movementOrigin: MapPoint | null;
  effects: SharedEffect[];
  controller: { name: string };
  controlledByViewer: boolean;
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
    strictMovement: boolean;
    updatedAt: number;
  };
  grid: { width: number; height: number; feetPerCell: number };
  viewer: null | { id: string; role: Role };
  undo: { available: number; redoAvailable: number; lastAction: string | null; nextRedoAction: string | null };
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
type SpellPlacementPreview = MapPoint & { spell: SpellEffectDefinition };
type PendingMove = MapPoint & { sequence: number; movementUsed: number; movementOrigin: MapPoint | null };
type OptimisticMutation = { apply: (state: EncounterState) => EncounterState };
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
type EncounterSummary = {
  code: string;
  name: string;
  status: "setup" | "active" | "paused";
  updatedAt: number;
};

const DEFAULT_CODE = "EMBER-KEEP";
const DEFAULT_ENCOUNTER: EncounterSummary = { code: DEFAULT_CODE, name: "The Ember Keep", status: "setup", updatedAt: 0 };
const JOIN_IDENTITIES: JoinIdentity[] = [
  { label: "Join as Dan (Dar'eleth)", participantName: "Dan", role: "player" },
  { label: "Join as Barry (Jelton)", participantName: "Barry", role: "player" },
  { label: "Join as Scott (Malichar)", participantName: "Scott", role: "player" },
  { label: "Join as Kevin (DM)", participantName: "Kevin", role: "dm" },
];
const TOKEN_COLORS = ["#c97546", "#639a72", "#8c72b8", "#628aaa", "#a16b75"];
// Below this cell size a name under every token turns the map into noise.
const TOKEN_LABEL_MIN_CELL_PX = 30;
const HEARTBEAT_INTERVAL_MS = 20_000;
const JOIN_TIMEOUT_MS = 12_000;
const PING_PULSE_COUNT = 3;
const PING_PULSE_MS = 420;
const PING_DURATION_MS = PING_PULSE_COUNT * PING_PULSE_MS;
const OPTIMISTIC_HISTORY_COMMANDS = new Set([
  "set-initiative", "set-initiative-group", "apply-hp", "add-effect", "remove-effect",
  "add-annotation", "remove-annotation", "create-token", "update-token", "move",
  "create-spell-effect",
]);

// Stroked 20x20 paths so every tool reads at the same weight. The glyph
// characters they replace rendered inconsistently across fonts.
const ICON_PATHS = {
  move: "M10 3v14M3 10h14M10 3 7.6 5.4M10 3l2.4 2.4M10 17l-2.4-2.4M10 17l2.4-2.4M3 10l2.4-2.4M3 10l2.4 2.4M17 10l-2.4-2.4M17 10l-2.4 2.4",
  ping: "M10 10h.01M6.1 13.9a5.5 5.5 0 0 1 0-7.8M13.9 6.1a5.5 5.5 0 0 1 0 7.8M3.6 16.4a9 9 0 0 1 0-12.8M16.4 3.6a9 9 0 0 1 0 12.8",
  line: "M5 15 15 5M5 15h.01M15 5h.01",
  erase: "m4 13 6.5-6.5a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 16H7zM4 16h12",
  spotlight: "M10 3v2M10 15v2M3 10h2M15 10h2M5.2 5.2l1.4 1.4M13.4 13.4l1.4 1.4M14.8 5.2l-1.4 1.4M6.6 13.4l-1.4 1.4M10 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6",
  clear: "M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14M5 5l10 10",
  creatures: "M7 4.5a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2M13 4.5a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2M4 9.2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3M16 9.2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3M10 9.5c2 0 3.6 1.7 3.9 3.3.3 1.6-.8 3.2-2.5 3.2h-2.8c-1.7 0-2.8-1.6-2.5-3.2C6.4 11.2 8 9.5 10 9.5",
  spells: "M10 2.8 11.6 7l4.4-1.4-2.5 3.8 3.7 2.7-4.6.2.2 4.7-2.8-3.7L7.2 17l.2-4.7-4.6-.2 3.7-2.7L4 5.6 8.4 7zM15.5 3.5h.01M3.8 15.8h.01",
  workshop: "M3 5.6 7.6 3.5l4.8 2.1L17 3.5v10.9l-4.6 2.1-4.8-2.1L3 16.5zM7.6 3.5v10.9M12.4 5.6v10.9",
  scenarios: "M3 5h5l1.7 2H17v9H3zM6 10h8M6 13h5",
  undo: "M7 5 3.5 8.5 7 12M3.5 8.5H12a4.5 4.5 0 0 1 0 9h-3",
  redo: "M13 5l3.5 3.5L13 12M16.5 8.5H8a4.5 4.5 0 0 0 0 9h3",
  fit: "M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4",
  zoomOut: "M9 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11M13 13l3.5 3.5M6.8 9h4.4",
  zoomIn: "M9 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11M13 13l3.5 3.5M6.8 9h4.4M9 6.8v4.4",
  sidebar: "M3 4.5h14v11H3zM12.5 4.5v11",
  present: "M3 7.5v-3h3M17 7.5v-3h-3M3 12.5v3h3M17 12.5v3h-3",
  settings: "M4 5.5h12M7 3.5v4M4 10h12M13 8v4M4 14.5h12M8.5 12.5v4",
  close: "M5 5l10 10M15 5L5 15",
  search: "M9 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11M13 13l3.5 3.5",
} as const;

type IconName = keyof typeof ICON_PATHS;

function Icon({ name }: { name: IconName }) {
  return (
    <svg className="ui-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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

type RosterRow =
  | { type: "token"; token: SharedToken; grouped: boolean }
  | { type: "group"; key: string; label: string; tokens: SharedToken[]; expanded: boolean };

// A pack of identical mobs collapses into one row once it reaches this size.
const ROSTER_GROUP_THRESHOLD = 3;

// Optimistic tokens carry this id prefix until the server confirms them, which
// lets render read pending state without touching a ref.
function isPendingCreate(token: SharedToken) {
  return token.id.startsWith("pending-create-");
}

function rosterBaseName(name: string) {
  return name.replace(/\s+\d+$/, "").trim() || name;
}

function rosterGroupKey(token: SharedToken) {
  return `${rosterBaseName(token.name)}|${token.artAsset ?? ""}`;
}

function initiativePackMembers(token: SharedToken, tokens: SharedToken[]) {
  if (token.kind !== "monster" || token.summonerTokenId) return [token];
  const key = rosterGroupKey(token);
  return tokens.filter((candidate) =>
    candidate.kind === "monster" && !candidate.summonerTokenId && rosterGroupKey(candidate) === key);
}

function compareTokenNames(a: SharedToken, b: SharedToken) {
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}

// During combat the roster is strictly the turn order. Outside it, the tokens
// the viewer actually controls come first and identical mobs fold together.
function buildRosterRows(
  tokens: SharedToken[],
  inCombat: boolean,
  filter: string,
  expandedGroups: ReadonlySet<string>,
): RosterRow[] {
  const needle = filter.trim().toLocaleLowerCase();
  const rosterTokens = tokens.filter((token) => token.kind !== SPELL_EFFECT_KIND);
  const visible = needle ? rosterTokens.filter((token) => token.name.toLocaleLowerCase().includes(needle)) : rosterTokens;
  if (inCombat) {
    const rows: RosterRow[] = [];
    const groups = new Map<string, SharedToken[]>();
    for (const token of [...visible].sort((a, b) => (a.initiativeOrder ?? 999) - (b.initiativeOrder ?? 999) || compareTokenNames(a, b))) {
      const key = token.initiativeOrder === null ? `untracked:${token.id}` : `initiative:${token.initiativeOrder}`;
      const members = groups.get(key);
      if (members) members.push(token); else groups.set(key, [token]);
    }
    for (const [key, members] of groups) {
      if (members.length === 1 || members[0].initiativeOrder === null) {
        rows.push({ type: "token", token: members[0], grouped: false });
        continue;
      }
      const leader = members.find((token) => !token.summonerTokenId) ?? members[0];
      const sameKind = members.every((token) => rosterBaseName(token.name) === rosterBaseName(leader.name));
      const expanded = expandedGroups.has(key);
      rows.push({ type: "group", key, label: sameKind ? rosterBaseName(leader.name) : `${leader.name}’s group`, tokens: members, expanded });
      if (expanded) for (const token of members) rows.push({ type: "token", token, grouped: true });
    }
    return rows;
  }
  if (needle) {
    return [...visible].sort(compareTokenNames).map((token) => ({ type: "token", token, grouped: false }));
  }
  // Ownership cannot drive this: the DM controls everything, and a roster that
  // never groups is exactly the screen the DM is drowning in.
  const priority = (token: SharedToken) =>
    token.kind === "character" ? (token.controlledByViewer ? 0 : 1)
      : token.summonerTokenId ? 2
      : 3;
  const rows: RosterRow[] = visible
    .filter((token) => priority(token) < 3)
    .sort((a, b) => priority(a) - priority(b) || compareTokenNames(a, b))
    .map((token) => ({ type: "token", token, grouped: false }));
  const groups = new Map<string, SharedToken[]>();
  for (const token of visible.filter((token) => priority(token) === 3).sort(compareTokenNames)) {
    const key = rosterGroupKey(token);
    const bucket = groups.get(key);
    if (bucket) bucket.push(token);
    else groups.set(key, [token]);
  }
  for (const [key, members] of groups) {
    if (members.length < ROSTER_GROUP_THRESHOLD) {
      for (const token of members) rows.push({ type: "token", token, grouped: false });
      continue;
    }
    const expanded = expandedGroups.has(key);
    rows.push({ type: "group", key, label: rosterBaseName(members[0].name), tokens: members, expanded });
    if (expanded) for (const token of members) rows.push({ type: "token", token, grouped: true });
  }
  return rows;
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

function spellParticleSeed(value: string, index: number) {
  let hash = 2166136261 ^ index;
  for (let character = 0; character < value.length; character += 1) {
    hash ^= value.charCodeAt(character);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function tokenHasEffect(token: SharedToken, effectName: string) {
  const normalizedName = effectName.trim().toLocaleLowerCase();
  return token.effects.some((effect) => effect.name.trim().toLocaleLowerCase() === normalizedName);
}

function drawBlessEffect(
  context: CanvasRenderingContext2D,
  token: SharedToken,
  x: number,
  y: number,
  radius: number,
  animationNow: number,
) {
  if (!tokenHasEffect(token, "Bless")) return;
  const time = animationNow / 1_000;
  const seed = spellParticleSeed(token.id, 77);
  const angle = time * 0.38 + seed * Math.PI * 2;
  const orbit = radius * 1.38;
  const moteX = x + Math.cos(angle) * orbit;
  const moteY = y + Math.sin(angle) * orbit;
  const flareCycle = (time + seed * 5.4) % 5.4;
  const flare = flareCycle < 0.48 ? Math.sin(Math.PI * flareCycle / 0.48) ** 2 : 0;
  const moteRadius = Math.max(1.35, radius * 0.06) * (1 + flare * 0.48);
  context.save();
  context.globalCompositeOperation = "screen";
  context.shadowColor = "#ffe9a0";
  context.shadowBlur = Math.max(4.5, radius * 0.16) + flare * radius * 0.28;
  context.globalAlpha = 0.66 + Math.sin(time * 2.1 + seed * 4) * 0.08 + flare * 0.2;
  context.fillStyle = "#ffe18a";
  context.beginPath(); context.arc(moteX, moteY, moteRadius, 0, Math.PI * 2); context.fill();
  context.globalAlpha *= 0.72;
  context.lineWidth = Math.max(0.7, radius * 0.02);
  context.strokeStyle = "#fff7d1";
  context.beginPath();
  context.moveTo(moteX - moteRadius * 1.55, moteY); context.lineTo(moteX + moteRadius * 1.55, moteY);
  context.moveTo(moteX, moteY - moteRadius * 1.55); context.lineTo(moteX, moteY + moteRadius * 1.55);
  context.stroke();
  if (flare > 0.02) {
    context.globalAlpha = flare * 0.38;
    context.lineWidth = Math.max(0.6, radius * 0.016);
    context.beginPath();
    context.moveTo(moteX - moteRadius * 2.5, moteY - moteRadius * 2.5); context.lineTo(moteX + moteRadius * 2.5, moteY + moteRadius * 2.5);
    context.moveTo(moteX + moteRadius * 2.5, moteY - moteRadius * 2.5); context.lineTo(moteX - moteRadius * 2.5, moteY + moteRadius * 2.5);
    context.stroke();
  }
  context.restore();
}

function drawHasteEffect(
  context: CanvasRenderingContext2D,
  token: SharedToken,
  x: number,
  y: number,
  radius: number,
  animationNow: number,
) {
  if (!tokenHasEffect(token, "Haste")) return;
  const time = animationNow / 1_000;
  const seed = spellParticleSeed(token.id, 91);
  const intervals = [0, 1, 2, 3].map((index) => 2 + spellParticleSeed(token.id, 120 + index));
  const sequenceDuration = intervals.reduce((total, interval) => total + interval, 0);
  const shiftedTime = time + seed * sequenceDuration;
  const sequenceIndex = Math.floor(shiftedTime / sequenceDuration);
  let phase = shiftedTime % sequenceDuration;
  let pulseSlot = 0;
  while (pulseSlot < intervals.length - 1 && phase >= intervals[pulseSlot]) {
    phase -= intervals[pulseSlot];
    pulseSlot += 1;
  }
  const pulseDuration = 0.78;
  if (phase > pulseDuration) return;
  const pulseKey = sequenceIndex * intervals.length + pulseSlot;
  const clockPosition = Math.floor(spellParticleSeed(token.id, 200 + pulseKey) * 12);
  const angle = clockPosition * Math.PI * 2 / 12 - Math.PI / 2;
  const orbit = radius * 1.43;
  const pulseX = x + Math.cos(angle) * orbit;
  const pulseY = y + Math.sin(angle) * orbit;
  const progress = phase / pulseDuration;
  const intensity = Math.sin(Math.PI * progress) ** 2;
  const coreRadius = Math.max(1.6, radius * 0.07) * (0.8 + intensity * 0.45);
  context.save();
  context.globalCompositeOperation = "screen";
  context.lineCap = "round";
  context.shadowColor = "#7de6ff";
  context.shadowBlur = Math.max(5, radius * 0.2) * intensity;
  context.globalAlpha = intensity * 0.9;
  context.fillStyle = "#e9fcff";
  context.beginPath(); context.arc(pulseX, pulseY, coreRadius, 0, Math.PI * 2); context.fill();
  context.strokeStyle = "#91e9ff";
  context.lineWidth = Math.max(0.8, radius * 0.024);
  context.globalAlpha = intensity * (1 - progress) * 0.78;
  context.beginPath(); context.arc(pulseX, pulseY, coreRadius * (1.2 + progress * 3.4), 0, Math.PI * 2); context.stroke();
  context.globalAlpha = intensity * 0.62;
  const ray = coreRadius * (2.2 + intensity * 1.2);
  context.beginPath();
  context.moveTo(pulseX - ray, pulseY); context.lineTo(pulseX + ray, pulseY);
  context.moveTo(pulseX, pulseY - ray); context.lineTo(pulseX, pulseY + ray);
  context.stroke();
  context.restore();
}

function drawSpellEffect(
  context: CanvasRenderingContext2D,
  token: SharedToken,
  x: number,
  y: number,
  radius: number,
  art: HTMLImageElement | null,
  animationNow: number,
  selected: boolean,
  owned: boolean,
) {
  const spell = spellEffectByArt(token.artAsset);
  if (!spell) return;
  const time = animationNow / 1_000;
  const isMoonbeam = spell.id === "moonbeam";
  const isMagicCircle = spell.id === "magic-circle";
  const pulseSpeed = isMoonbeam ? 2.1 : isMagicCircle ? 1.35 : 5.2;
  const pulseDepth = isMoonbeam ? 0.055 : isMagicCircle ? 0.025 : 0.095;
  const pulse = 1 + Math.sin(time * pulseSpeed + spellParticleSeed(token.id, 1) * 5) * pulseDepth;
  // Magic Circle's PNG keeps transparent breathing room around its outer
  // ornament. Compensate for that padding so the visible ring—not the image
  // box—lands at the full ten-foot radius.
  const visualRadius = radius * (isMoonbeam ? 1.25 : isMagicCircle ? 1.25 : 1.36);

  context.save();
  if (token.hidden) context.globalAlpha = 0.48;
  const aura = context.createRadialGradient(x, y, visualRadius * 0.08, x, y, visualRadius * 1.22);
  if (isMoonbeam) {
    aura.addColorStop(0, "rgba(245,248,255,.78)");
    aura.addColorStop(0.38, "rgba(154,186,255,.28)");
    aura.addColorStop(0.75, "rgba(120,102,255,.12)");
    aura.addColorStop(1, "rgba(80,70,210,0)");
  } else if (isMagicCircle) {
    aura.addColorStop(0, "rgba(255,247,200,.08)");
    aura.addColorStop(0.54, "rgba(255,220,112,.1)");
    aura.addColorStop(0.82, "rgba(255,190,62,.18)");
    aura.addColorStop(1, "rgba(255,176,38,0)");
  } else {
    aura.addColorStop(0, "rgba(255,244,178,.9)");
    aura.addColorStop(0.3, "rgba(255,125,24,.38)");
    aura.addColorStop(0.72, "rgba(221,40,12,.16)");
    aura.addColorStop(1, "rgba(170,20,0,0)");
  }
  context.globalCompositeOperation = "screen";
  context.fillStyle = aura;
  context.beginPath(); context.arc(x, y, visualRadius * 1.22 * pulse, 0, Math.PI * 2); context.fill();

  if (art) {
    context.save();
    context.translate(x, y);
    context.rotate(time * (isMoonbeam ? 0.13 : isMagicCircle ? 0.055 : 0.72));
    const plateRadius = visualRadius * pulse;
    context.globalAlpha *= isMoonbeam ? 0.86 : isMagicCircle ? 0.92 : 0.94;
    context.drawImage(art, -plateRadius, -plateRadius, plateRadius * 2, plateRadius * 2);
    context.restore();
    context.save();
    context.translate(x, y);
    context.rotate(-time * (isMoonbeam ? 0.22 : isMagicCircle ? 0.09 : 0.46));
    const echoRadius = visualRadius * (isMoonbeam ? 0.76 : isMagicCircle ? 0.93 : 0.7) * (2 - pulse);
    context.globalAlpha *= isMoonbeam ? 0.34 : isMagicCircle ? 0.24 : 0.46;
    context.drawImage(art, -echoRadius, -echoRadius, echoRadius * 2, echoRadius * 2);
    context.restore();
  }

  if (isMoonbeam) {
    context.save();
    context.translate(x, y);
    context.rotate(-time * 0.18);
    context.strokeStyle = "rgba(226,235,255,.8)";
    context.shadowColor = "#a9c7ff";
    context.shadowBlur = Math.max(8, radius * 0.24);
    context.lineWidth = Math.max(1.2, radius * 0.025);
    context.setLineDash([radius * 0.16, radius * 0.11]);
    context.beginPath(); context.arc(0, 0, radius * 1.05, 0, Math.PI * 2); context.stroke();
    context.setLineDash([]);
    context.restore();
    for (let index = 0; index < 12; index += 1) {
      const seed = spellParticleSeed(token.id, index + 10);
      const orbit = visualRadius * (0.38 + seed * 0.7);
      const angle = seed * Math.PI * 2 + time * (0.18 + (index % 3) * 0.07);
      const flicker = 0.35 + 0.65 * Math.abs(Math.sin(time * 2.3 + seed * 12));
      context.globalAlpha = flicker;
      context.fillStyle = index % 3 === 0 ? "#ffffff" : "#b8d0ff";
      context.shadowColor = "#d8e5ff"; context.shadowBlur = 8;
      context.beginPath(); context.arc(x + Math.cos(angle) * orbit, y + Math.sin(angle) * orbit, Math.max(1.2, radius * (0.022 + seed * 0.025)), 0, Math.PI * 2); context.fill();
    }
  } else if (isMagicCircle) {
    context.save();
    context.translate(x, y);
    context.rotate(-time * 0.13);
    context.strokeStyle = "rgba(255,239,164,.76)";
    context.shadowColor = "#ffd66b";
    context.shadowBlur = Math.max(9, radius * 0.2);
    context.lineWidth = Math.max(1.2, radius * 0.018);
    context.setLineDash([radius * 0.12, radius * 0.08]);
    context.beginPath(); context.arc(0, 0, visualRadius * 0.84, 0, Math.PI * 2); context.stroke();
    context.setLineDash([]);
    context.restore();
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4 + time * 0.06;
      const flare = 0.42 + Math.sin(time * 2 + index * 0.9) * 0.2;
      context.globalAlpha = flare;
      context.fillStyle = index % 2 === 0 ? "#fff8ce" : "#bde8ff";
      context.shadowColor = "#ffe38a"; context.shadowBlur = 8;
      context.beginPath(); context.arc(x + Math.cos(angle) * visualRadius * 0.88, y + Math.sin(angle) * visualRadius * 0.88, Math.max(1.2, radius * 0.018), 0, Math.PI * 2); context.fill();
    }
  } else {
    for (let index = 0; index < 18; index += 1) {
      const seed = spellParticleSeed(token.id, index + 30);
      const cycle = (time * (0.42 + seed * 0.35) + seed * 5) % 1;
      const orbit = visualRadius * (0.45 + cycle * 0.9);
      const angle = seed * Math.PI * 2 + time * (0.9 + seed);
      context.globalAlpha = (1 - cycle) * (0.45 + seed * 0.55);
      context.fillStyle = seed > 0.64 ? "#fff4a8" : seed > 0.3 ? "#ff9b21" : "#ff3b0a";
      context.shadowColor = "#ff5a00"; context.shadowBlur = 7;
      const emberSize = Math.max(1.2, radius * (0.018 + seed * 0.035));
      context.beginPath(); context.arc(x + Math.cos(angle) * orbit, y + Math.sin(angle) * orbit, emberSize, 0, Math.PI * 2); context.fill();
    }
    context.globalAlpha = 0.28 + Math.sin(time * 8) * 0.06;
    context.strokeStyle = "#ffd05a";
    context.lineWidth = Math.max(1.5, radius * 0.045);
    context.beginPath(); context.arc(x, y, radius * (0.72 + Math.sin(time * 4.4) * 0.05), 0, Math.PI * 2); context.stroke();
  }

  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.shadowBlur = 0;
  if ((selected || owned) && !isMagicCircle) {
    context.strokeStyle = selected ? "#f5c65c" : spell.accent;
    context.lineWidth = selected ? 2.4 : 1.2;
    context.globalAlpha = selected ? 0.95 : 0.48;
    context.setLineDash(selected ? [5, 5] : [2, 5]);
    context.beginPath(); context.arc(x, y, radius * 1.22, 0, Math.PI * 2); context.stroke();
  }
  context.restore();
}

function drawMap(
  canvas: HTMLCanvasElement,
  state: EncounterState,
  preview: TokenPreview | null,
  placementPreview: PlacementPreview | null,
  spellPlacementPreview: SpellPlacementPreview | null,
  dragOrigin: MapPoint | null,
  participant: Participant,
  mapScene: HTMLCanvasElement | null,
  tokenArt: Map<string, HTMLImageElement>,
  viewport: Viewport,
  pingStartedAt: ReadonlyMap<string, number>,
  animationNow: number,
  selectedTokenId: string | null,
  gridOpacity: number,
  transparentTokenBackgrounds: boolean,
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

  context.strokeStyle = `rgba(232, 220, 190, ${Math.min(1, Math.max(0, gridOpacity))})`;
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

  state.tokens.filter((token) => token.kind === SPELL_EFFECT_KIND).forEach((token) => {
    const position = preview?.tokenId === token.id ? preview : token;
    const x = screenX(position.x);
    const y = screenY(position.y);
    const radius = Math.min(cellWidth, cellHeight) * tokenRadiusCells(token.size);
    drawSpellEffect(context, token, x, y, radius, token.artAsset ? tokenArt.get(token.artAsset) ?? null : null,
      animationNow, token.id === selectedTokenId, token.controlledByViewer);
  });

  if (preview && dragOrigin) {
    const movingToken = state.tokens.find((token) => token.id === preview.tokenId);
    if (movingToken?.kind !== SPELL_EFFECT_KIND) {
      const distance = calculateDirectDistance(dragOrigin, preview, state.grid.feetPerCell);
      const overMovement = Boolean(movingToken && distance > movingToken.speed + 0.05);
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
  }

  state.tokens.filter((token) => token.kind !== SPELL_EFFECT_KIND).forEach((token, index) => {
    const position = preview?.tokenId === token.id ? preview : token;
    const owned = token.controller.name.toLocaleLowerCase() === participant.name.toLocaleLowerCase();
    const active = token.initiativeOrder !== null && token.initiativeOrder === state.encounter.activeInitiativeOrder;
    const selected = token.id === selectedTokenId;
    // Exact when the server trusted this viewer with numbers, otherwise the
    // ring snaps to the band so players read "bloodied", never "37/104".
    const health = displayHealth(token.hp, token.maxHp, token.healthState);
    const down = health?.band === "down";
    const x = screenX(position.x);
    const y = screenY(position.y);
    const radius = Math.min(cellWidth, cellHeight) * tokenRadiusCells(token.size);
    context.save();
    if (token.hidden) context.globalAlpha *= 0.48;
    if (down) context.globalAlpha *= 0.55;
    context.shadowColor = "rgba(0,0,0,.45)";
    context.shadowBlur = transparentTokenBackgrounds ? 5 : 10;
    context.fillStyle = transparentTokenBackgrounds
      ? "rgba(16, 15, 13, 0.12)"
      : active ? "#f5c65c" : TOKEN_COLORS[index % TOKEN_COLORS.length];
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
      context.fillStyle = transparentTokenBackgrounds ? "#f3eadb" : "#261d18";
      if (transparentTokenBackgrounds) {
        context.shadowColor = "rgba(0, 0, 0, 0.9)";
        context.shadowBlur = 4;
      }
      context.font = `800 ${Math.max(12, radius * 0.88)}px ui-sans-serif, system-ui`;
      context.textAlign = "center"; context.textBaseline = "middle";
      context.fillText(tokenInitial(token), x, y + 1);
    }
    if (!transparentTokenBackgrounds) {
      context.strokeStyle = owned ? "#fff1ba" : active ? "#ffe29a" : "#f0d0a0";
      context.lineWidth = owned || active ? Math.max(3, radius * 0.16) : Math.max(2, radius * 0.1);
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.stroke();
    }

    if (health) {
      const healthRadius = radius * 1.12;
      // Keep the HP ring as slim as it is on a Tiny token. Its radius still
      // follows the creature footprint, but larger creatures do not get a
      // progressively heavier ring.
      const smallestTokenRadius = Math.min(cellWidth, cellHeight) * tokenRadiusCells("tiny");
      const healthWidth = Math.max(2.5, smallestTokenRadius * 0.17);
      context.lineCap = "butt";
      context.lineWidth = healthWidth;
      context.strokeStyle = "rgba(12, 11, 10, 0.72)";
      context.beginPath(); context.arc(x, y, healthRadius, 0, Math.PI * 2); context.stroke();
      if (health.ratio > 0) {
        context.strokeStyle = health.color;
        context.beginPath();
        context.arc(x, y, healthRadius, -Math.PI / 2, -Math.PI / 2 + health.ratio * Math.PI * 2);
        context.stroke();
      }
      if (down) {
        context.strokeStyle = health.color;
        context.lineWidth = Math.max(2, radius * 0.14);
        context.lineCap = "round";
        const slash = radius * 0.6;
        context.beginPath();
        context.moveTo(x - slash, y - slash); context.lineTo(x + slash, y + slash);
        context.moveTo(x + slash, y - slash); context.lineTo(x - slash, y + slash);
        context.stroke();
      }
      context.lineCap = "butt";
    }

    drawBlessEffect(context, token, x, y, radius, animationNow);
    drawHasteEffect(context, token, x, y, radius, animationNow);

    if (token.effects.length > 0) {
      context.fillStyle = token.effects.some((effect) => effect.due) ? "#d95f59" : "#8ec9a0";
      context.beginPath(); context.arc(x + radius * 0.72, y - radius * 0.72, radius * 0.24, 0, Math.PI * 2); context.fill();
    }

    if (selected) {
      context.globalAlpha = 1;
      context.strokeStyle = "#f5c65c";
      context.lineWidth = 2;
      context.setLineDash([4, 4]);
      context.beginPath(); context.arc(x, y, radius * 1.32, 0, Math.PI * 2); context.stroke();
      context.setLineDash([]);
    }

    if (geometry.cellSize >= TOKEN_LABEL_MIN_CELL_PX) {
      const label = token.name.length > 16 ? `${token.name.slice(0, 15)}…` : token.name;
      const fontSize = Math.max(9, Math.min(13, geometry.cellSize * 0.23));
      context.globalAlpha = token.hidden ? 0.6 : 1;
      context.font = `650 ${fontSize}px ui-sans-serif, system-ui`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const labelY = y + radius * 1.12 + fontSize * 0.95;
      const labelWidth = context.measureText(label).width + fontSize * 0.7;
      context.fillStyle = "rgba(14, 13, 12, 0.78)";
      context.beginPath();
      context.roundRect(x - labelWidth / 2, labelY - fontSize * 0.72, labelWidth, fontSize * 1.44, fontSize * 0.36);
      context.fill();
      context.fillStyle = active ? "#f7dc9d" : owned ? "#efe6d6" : "#c8bfb1";
      context.fillText(label, x, labelY);
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
  if (spellPlacementPreview) {
    const spellToken: SharedToken = {
      id: `spell-preview-${spellPlacementPreview.spell.id}`,
      name: spellPlacementPreview.spell.name,
      artAsset: spellPlacementPreview.spell.artAsset,
      kind: SPELL_EFFECT_KIND,
      size: spellPlacementPreview.spell.size,
      speed: 0,
      hp: null,
      maxHp: null,
      healthState: null,
      hidden: false,
      summonerTokenId: null,
      initiative: null,
      initiativeGroupId: null,
      initiativeOrder: null,
      turnComplete: false,
      movementUsed: 0,
      movementOrigin: null,
      effects: [],
      controller: { name: participant.name },
      controlledByViewer: true,
      x: spellPlacementPreview.x,
      y: spellPlacementPreview.y,
    };
    const radius = Math.min(cellWidth, cellHeight) * tokenRadiusCells(spellToken.size);
    context.save(); context.globalAlpha = 0.78;
    drawSpellEffect(context, spellToken, screenX(spellToken.x), screenY(spellToken.y), radius,
      tokenArt.get(spellToken.artAsset ?? "") ?? null, animationNow, true, true);
    context.restore();
  }
}

export default function BattleMapPrototype() {
  const [encounterCode, setEncounterCode] = useState(DEFAULT_CODE);
  const [encounters, setEncounters] = useState<EncounterSummary[]>([DEFAULT_ENCOUNTER]);
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
  const [hpAmount, setHpAmount] = useState("5");
  const [effectName, setEffectName] = useState("");
  const [effectType, setEffectType] = useState("condition");
  const [effectDuration, setEffectDuration] = useState("1");
  const [effectReminder, setEffectReminder] = useState("end");
  const [effectEditorTokenId, setEffectEditorTokenId] = useState<string | null>(null);
  const [tokenEditorTokenId, setTokenEditorTokenId] = useState<string | null>(null);
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const [scenarioCreatorOpen, setScenarioCreatorOpen] = useState(false);
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioMode, setScenarioMode] = useState<"party" | "duplicate">("party");
  const [scenarioCreating, setScenarioCreating] = useState(false);
  const [scenarioError, setScenarioError] = useState("");
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [encounterAction, setEncounterAction] = useState<"pause" | "resume" | "reset" | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [spellPaletteOpen, setSpellPaletteOpen] = useState(false);
  const [creatures, setCreatures] = useState<CreatureTemplate[]>([]);
  const [creatureFamilies, setCreatureFamilies] = useState<string[]>([]);
  const [creatureQuery, setCreatureQuery] = useState("");
  const [creatureFamily, setCreatureFamily] = useState("");
  const [creatureCursor, setCreatureCursor] = useState<string | null>(null);
  const [creatureCatalogLoading, setCreatureCatalogLoading] = useState(false);
  const [creatureCatalogError, setCreatureCatalogError] = useState("");
  const [armedCreatureId, setArmedCreatureId] = useState<string | null>(null);
  const [placementPreview, setPlacementPreview] = useState<PlacementPreview | null>(null);
  const [armedSpellId, setArmedSpellId] = useState<string | null>(null);
  const [spellPlacementPreview, setSpellPlacementPreview] = useState<SpellPlacementPreview | null>(null);
  const [placementSummonerId, setPlacementSummonerId] = useState("");
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, centerX: 12, centerY: 8, mapKey: "", fit: false });
  const [panning, setPanning] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const [rosterFilter, setRosterFilter] = useState("");
  const [gridOpacity, setGridOpacity] = useState(0.17);
  const [transparentTokenBackgrounds, setTransparentTokenBackgrounds] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [pendingDeleteTokenId, setPendingDeleteTokenId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragGestureRef = useRef<DragGesture | null>(null);
  const panGestureRef = useRef<PanGesture | null>(null);
  const annotationStartRef = useRef<{ pointerId: number; point: MapPoint } | null>(null);
  const pingStartedAtRef = useRef<Map<string, number>>(new Map());
  const pingAudioContextRef = useRef<AudioContext | null>(null);
  const pendingMovesRef = useRef<Map<string, PendingMove>>(new Map());
  const pendingCreatesRef = useRef<Map<string, SharedToken>>(new Map());
  const pendingDeletesRef = useRef<Set<string>>(new Set());
  const pendingOptimisticRef = useRef<Map<number, OptimisticMutation>>(new Map());
  const localUndoHistoryRef = useRef<Array<{ mutationId: number; state: EncounterState }>>([]);
  const localRedoHistoryRef = useRef<Array<{ mutationId: number; state: EncounterState }>>([]);
  const moveSequenceRef = useRef(0);
  const tokenMutationSequenceRef = useRef(0);
  const optimisticSequenceRef = useRef(0);
  const turnAdvanceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const creatureCatalogRequestRef = useRef(0);

  const acceptAuthoritativeState = useCallback((next: EncounterState) => {
    setState((current) => {
      if (current && next.encounter.code !== current.encounter.code) return current;
      if (current && next.encounter.version < current.encounter.version) return current;
      const pendingMoves = pendingMovesRef.current;
      const pendingCreates = pendingCreatesRef.current;
      const pendingDeletes = pendingDeletesRef.current;
      const pendingOptimistic = pendingOptimisticRef.current;
      if (pendingMoves.size === 0 && pendingCreates.size === 0 && pendingDeletes.size === 0 && pendingOptimistic.size === 0) return next;
      const tokens = next.tokens
        .filter((token) => !pendingDeletes.has(token.id))
        .map((token) => {
          const pending = pendingMoves.get(token.id);
          return pending ? { ...token, x: pending.x, y: pending.y, movementUsed: pending.movementUsed, movementOrigin: pending.movementOrigin } : token;
        });
      let merged = {
        ...next,
        tokens: [...tokens, ...[...pendingCreates.values()].filter((token) => !tokens.some((currentToken) => currentToken.id === token.id))],
      };
      for (const mutation of pendingOptimistic.values()) merged = mutation.apply(merged);
      return merged;
    });
  }, []);

  const normalizedCode = encounterCode.trim().toUpperCase() || DEFAULT_CODE;
  const selectedEncounter = encounters.find((encounter) => encounter.code === normalizedCode) ?? encounters[0] ?? DEFAULT_ENCOUNTER;
  const joinedCode = state?.encounter.code;
  const controlledTokens = state?.tokens.filter((token) => token.controlledByViewer) ?? [];
  const playerCharacter = participant?.role === "player"
    ? controlledTokens.find((token) => token.kind === "character" && !token.summonerTokenId) ?? null
    : null;
  const effectivePlacementSummonerId = participant?.role === "player"
    ? playerCharacter?.id ?? ""
    : placementSummonerId;
  const effectiveSelectedTokenId = selectedTokenId ?? controlledTokens[0]?.id ?? null;
  const selectedToken = state?.tokens.find((token) => token.id === effectiveSelectedTokenId) ?? null;
  const selectedSpell = selectedToken?.kind === SPELL_EFFECT_KIND ? spellEffectByArt(selectedToken.artAsset) : null;
  const movementEnabled = connection === "live" && !busy && state?.encounter.status !== "paused";
  const canMoveToken = (token: SharedToken) => Boolean(
    participant && state && (participant.role === "dm" || token.controlledByViewer || !state.encounter.strictMovement),
  );
  const distance = state && dragOrigin && preview
    ? calculateDirectDistance(dragOrigin, preview, state.grid.feetPerCell)
    : 0;
  const remainingMovement = selectedToken ? Math.max(0, selectedToken.speed - distance) : 0;
  const overMovement = Boolean(selectedToken && distance > selectedToken.speed + 0.05);
  const placementArtAsset = placementPreview?.creature.artAsset ?? spellPlacementPreview?.spell.artAsset ?? null;

  const enablePingAudio = () => {
    if (typeof AudioContext === "undefined") return;
    if (!pingAudioContextRef.current || pingAudioContextRef.current.state === "closed") {
      pingAudioContextRef.current = new AudioContext();
    }
    if (pingAudioContextRef.current.state === "suspended") void pingAudioContextRef.current.resume().catch(() => undefined);
  };

  useEffect(() => {
    let disposed = false;
    void api<{ items: EncounterSummary[] }>("/api/encounters")
      .then(({ items }) => {
        if (disposed || items.length === 0) return;
        setEncounters(items);
        setEncounterCode((current) => items.some((encounter) => encounter.code === current) ? current : items[0].code);
      })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, []);

  const join = async (identity: JoinIdentity) => {
    const name = identity.participantName;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), JOIN_TIMEOUT_MS);
    enablePingAudio();
    setJoiningIdentity(identity.label); setBusy(true); setError("");
    try {
      const result = await api<{ participantId: string; sessionSecret: string; role: Role; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(normalizedCode)}/join`,
        { method: "POST", signal: controller.signal, body: JSON.stringify({ participantName: name, role: identity.role }) },
      );
      const joined = { id: result.participantId, name, role: result.role, sessionSecret: result.sessionSecret };
      setParticipant(joined); setState(result.state); setEncounterCode(result.state.encounter.code); setConnection("connecting");
    } catch (joinError) {
      setError(joinError instanceof DOMException && joinError.name === "AbortError"
        ? "The encounter took too long to respond. Please try again."
        : joinError instanceof Error ? joinError.message : "Unable to join.");
    } finally {
      window.clearTimeout(timeout);
      setJoiningIdentity(null);
      setBusy(false);
    }
  };

  const createScenario = async () => {
    if (!participant || participant.role !== "dm" || !state || scenarioCreating) return;
    const name = scenarioName.trim();
    if (name.length < 3) {
      setScenarioError("Enter a scenario name of at least three characters.");
      return;
    }
    setScenarioCreating(true);
    setScenarioError("");
    try {
      const result = await api<{
        participantId: string;
        sessionSecret: string;
        role: Role;
        scenario: EncounterSummary;
        state: EncounterState;
      }>(`/api/encounters/${encodeURIComponent(state.encounter.code)}/command`, {
        method: "POST",
        body: sessionPayload(participant, { command: "create-scenario", name, mode: scenarioMode }),
      });
      pendingMovesRef.current.clear();
      pendingCreatesRef.current.clear();
      pendingDeletesRef.current.clear();
      pendingOptimisticRef.current.clear();
      localUndoHistoryRef.current = [];
      localRedoHistoryRef.current = [];
      const joined = { id: result.participantId, name: "Kevin", role: result.role, sessionSecret: result.sessionSecret };
      setParticipant(joined);
      setState(result.state);
      setEncounterCode(result.scenario.code);
      setEncounters((current) => [result.scenario, ...current.filter((encounter) => encounter.code !== result.scenario.code)]);
      setSelectedTokenId(null);
      setScenarioCreatorOpen(false);
      setScenarioName("");
      setScenarioMode("party");
      setConnection("connecting");
      setNotice(`${result.scenario.name} created.`);
    } catch (scenarioCreateError) {
      setScenarioError(scenarioCreateError instanceof Error ? scenarioCreateError.message : "The scenario could not be created.");
    } finally {
      setScenarioCreating(false);
    }
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
    if (!paletteOpen || !participant?.role) return;
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
    if (canvasRef.current && state && participant) drawMap(canvasRef.current, state, preview, placementPreview, spellPlacementPreview, dragOrigin, participant, mapScene, tokenArt, viewport, pingStartedAtRef.current, animationNow, effectiveSelectedTokenId, gridOpacity, transparentTokenBackgrounds);
  }, [dragOrigin, effectiveSelectedTokenId, gridOpacity, participant, placementPreview, preview, renderedMapScene, spellPlacementPreview, state, tokenArt, transparentTokenBackgrounds, viewport]);
  useEffect(() => {
    redraw(); const canvas = canvasRef.current; if (!canvas) return;
    const observer = new ResizeObserver(() => redraw()); observer.observe(canvas); return () => observer.disconnect();
  }, [redraw]);

  useEffect(() => {
    const hasAnimatingPing = () => state?.annotations.some((annotation) => {
      const startedAt = pingStartedAtRef.current.get(annotation.id);
      return annotation.type === "ping" && startedAt !== undefined && Date.now() - startedAt < PING_DURATION_MS;
    });
    const hasPersistentSpell = state?.tokens.some((token) => token.kind === SPELL_EFFECT_KIND) || Boolean(spellPlacementPreview);
    const hasAttachedVfx = state?.tokens.some((token) => tokenHasEffect(token, "Bless") || tokenHasEffect(token, "Haste"));
    if (!hasAnimatingPing() && !hasPersistentSpell && !hasAttachedVfx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { redraw(); return; }
    let frameId = 0;
    let lastPaint = 0;
    const animate = (now: number) => {
      if (now - lastPaint >= 1000 / 24) { redraw(Date.now()); lastPaint = now; }
      if (hasAnimatingPing() || hasPersistentSpell || hasAttachedVfx) frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [redraw, spellPlacementPreview, state?.annotations, state?.tokens]);

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
    setError("");
    try { await command(name, extra); if (success) setNotice(success); return true; }
    catch (commandError) { setError(commandError instanceof Error ? commandError.message : "Action rejected."); await refreshAfterError(); return false; }
  };

  const runOptimisticCommand = async <T extends { state: EncounterState }>(
    name: string,
    extra: Record<string, unknown>,
    apply: (current: EncounterState) => EncounterState,
    success?: string,
    beforeAccept?: (result: T) => void,
    trackHistory = OPTIMISTIC_HISTORY_COMMANDS.has(name),
    serializeTurnAdvance = false,
  ): Promise<T | null> => {
    const mutationId = ++optimisticSequenceRef.current;
    const applyOptimistic = (current: EncounterState) => {
      const applied = apply(current);
      return trackHistory ? {
        ...applied,
        undo: { ...applied.undo, available: Math.min(10, current.undo.available + 1), redoAvailable: 0 },
      } : applied;
    };
    pendingOptimisticRef.current.set(mutationId, { apply: applyOptimistic });
    flushSync(() => {
      setState((current) => {
        if (!current) return current;
        if (trackHistory && !localUndoHistoryRef.current.some((entry) => entry.mutationId === mutationId)) {
          localUndoHistoryRef.current = [...localUndoHistoryRef.current.slice(-9), { mutationId, state: current }];
          localRedoHistoryRef.current = [];
        }
        return applyOptimistic(current);
      });
    });
    setError("");
    try {
      const send = () => command<T>(name, extra);
      let result: T;
      if (serializeTurnAdvance) {
        const queued = turnAdvanceQueueRef.current.then(send);
        turnAdvanceQueueRef.current = queued.then(() => undefined, () => undefined);
        result = await queued;
      } else {
        result = await send();
      }
      beforeAccept?.(result);
      pendingOptimisticRef.current.delete(mutationId);
      acceptAuthoritativeState(result.state);
      if (success) setNotice(success);
      return result;
    } catch (commandError) {
      pendingOptimisticRef.current.delete(mutationId);
      if (trackHistory) localUndoHistoryRef.current = localUndoHistoryRef.current.filter((entry) => entry.mutationId !== mutationId);
      setError(commandError instanceof Error ? commandError.message : "Action rejected.");
      await refreshAfterError();
      return null;
    }
  };

  const runHistoryOptimistically = async (direction: "undo" | "redo") => {
    const historyNotice = direction === "undo" ? "Last action undone." : "Last action redone.";
    setNotice(historyNotice);
    const source = direction === "undo" ? localUndoHistoryRef : localRedoHistoryRef;
    const destination = direction === "undo" ? localRedoHistoryRef : localUndoHistoryRef;
    const entry = source.current.at(-1);
    if (!entry || !state) {
      const confirmed = await runCommand(direction);
      if (!confirmed) setNotice("");
      return;
    }
    source.current = source.current.slice(0, -1);
    const inverseEntry = { mutationId: ++optimisticSequenceRef.current, state };
    destination.current = [...destination.current.slice(-9), inverseEntry];
    const result = await runOptimisticCommand(
      direction,
      {},
      () => ({
        ...entry.state,
        undo: {
          ...entry.state.undo,
          available: direction === "undo" ? Math.max(0, state.undo.available - 1) : Math.min(10, state.undo.available + 1),
          redoAvailable: direction === "undo" ? Math.min(10, state.undo.redoAvailable + 1) : Math.max(0, state.undo.redoAvailable - 1),
        },
      }),
      undefined,
      undefined,
      false,
    );
    if (!result) {
      setNotice("");
      destination.current = destination.current.filter((item) => item.mutationId !== inverseEntry.mutationId);
      source.current = [...source.current, entry];
    }
  };

  const runHistoryFromShortcut = useEffectEvent((direction: "undo" | "redo") => {
    void runHistoryOptimistically(direction);
  });

  useEffect(() => {
    if (!participant || !state) return;
    const onHistoryShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select")) return;
      const key = event.key.toLocaleLowerCase();
      const modifier = event.metaKey || event.ctrlKey;
      const wantsUndo = modifier && key === "z" && !event.shiftKey;
      const wantsRedo = (modifier && key === "z" && event.shiftKey) || (event.ctrlKey && !event.metaKey && key === "y");
      if (busy || (!wantsUndo && !wantsRedo)) return;
      if (wantsUndo && state.undo.available > 0) {
        event.preventDefault();
        runHistoryFromShortcut("undo");
      } else if (wantsRedo && state.undo.redoAvailable > 0) {
        event.preventDefault();
        runHistoryFromShortcut("redo");
      }
    };
    window.addEventListener("keydown", onHistoryShortcut);
    return () => window.removeEventListener("keydown", onHistoryShortcut);
  }, [busy, participant, state]);

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
    const packMembers = participant?.role === "dm" && state ? initiativePackMembers(token, state.tokens) : [token];
    const alreadyOnePack = packMembers.length > 1
      && packMembers.every((member) => member.initiative === initiative
        && member.initiativeGroupId && member.initiativeGroupId === packMembers[0].initiativeGroupId);
    if (initiative === token.initiative && (packMembers.length === 1 || alreadyOnePack)) {
      setInitiativeDrafts((current) => { const next = { ...current }; delete next[token.id]; return next; });
      setInitiativeStatuses((current) => ({ ...current, [token.id]: "saved" }));
      return;
    }
    setInitiativeStatuses((current) => ({ ...current, [token.id]: "saving" }));
    const packIds = new Set(packMembers.map((member) => member.id));
    const optimisticGroupId = `pending-group-${++tokenMutationSequenceRef.current}`;
    const result = packMembers.length > 1
      ? await runOptimisticCommand(
          "set-initiative-group",
          { tokenIds: [...packIds], initiative },
          (current) => ({ ...current, tokens: current.tokens.map((item) => packIds.has(item.id)
            ? { ...item, initiative, initiativeGroupId: optimisticGroupId, turnComplete: false, movementUsed: 0, movementOrigin: null }
            : item) }),
          `${rosterBaseName(token.name)} initiative set for all ${packMembers.length}.`,
        )
      : await runOptimisticCommand(
          "set-initiative",
          { tokenId: token.id, initiative },
          (current) => ({ ...current, tokens: current.tokens.map((item) => item.id === token.id
            ? { ...item, initiative, initiativeGroupId: null, initiativeOrder: null, turnComplete: false, movementUsed: 0, movementOrigin: null }
            : item) }),
        );
    if (result) {
      setInitiativeDrafts((current) => { const next = { ...current }; delete next[token.id]; return next; });
      setInitiativeStatuses((current) => ({ ...current, [token.id]: "saved" }));
    } else {
      setInitiativeStatuses((current) => ({ ...current, [token.id]: "editing" }));
    }
  };

  const splitInitiativePack = (token: SharedToken) => {
    if (token.initiative === null) return;
    void runOptimisticCommand(
      "set-initiative",
      { tokenId: token.id, initiative: token.initiative },
      (current) => ({ ...current, tokens: current.tokens.map((item) => item.id === token.id
        ? { ...item, initiativeGroupId: null, turnComplete: false, movementUsed: 0, movementOrigin: null }
        : item) }),
      `${token.name} split from its initiative pack.`,
    );
  };

  const saveInitiativeGroup = async (key: string, tokens: SharedToken[]) => {
    const draftKey = `group:${key}`;
    const draft = initiativeDrafts[draftKey];
    if (draft === undefined || draft === "") return;
    const initiative = Number(draft);
    if (!Number.isInteger(initiative) || initiative < 0 || initiative > 99) {
      setError("Initiative must be a whole number from 0 to 99.");
      return;
    }
    if (tokens.every((token) => token.initiative === initiative && token.initiativeGroupId && token.initiativeGroupId === tokens[0].initiativeGroupId)) {
      setInitiativeDrafts((current) => { const next = { ...current }; delete next[draftKey]; return next; });
      return;
    }
    setInitiativeStatuses((current) => ({ ...current, [draftKey]: "saving" }));
    const optimisticGroupId = `pending-group-${++tokenMutationSequenceRef.current}`;
    const tokenIds = new Set(tokens.map((token) => token.id));
    const result = await runOptimisticCommand(
      "set-initiative-group",
      { tokenIds: [...tokenIds], initiative },
      (current) => ({ ...current, tokens: current.tokens.map((token) => tokenIds.has(token.id)
        ? { ...token, initiative, initiativeGroupId: optimisticGroupId, initiativeOrder: null, turnComplete: false, movementUsed: 0, movementOrigin: null }
        : token) }),
      `${rosterBaseName(tokens[0].name)} initiative set for all ${tokens.length}.`,
    );
    if (result) {
      setInitiativeDrafts((current) => { const next = { ...current }; delete next[draftKey]; return next; });
      setInitiativeStatuses((current) => ({ ...current, [draftKey]: "saved" }));
    } else {
      setInitiativeStatuses((current) => ({ ...current, [draftKey]: "editing" }));
    }
  };

  const addEffectToToken = async (tokenId: string) => {
    const name = effectName.trim();
    if (!name) return;
    const temporaryId = `pending-effect-${Date.now()}-${++tokenMutationSequenceRef.current}`;
    const durationRounds = Number(effectDuration);
    const optimisticEffect: SharedEffect = {
      id: temporaryId,
      name,
      type: effectType,
      durationRounds,
      expiresRound: Math.max(1, state?.encounter.currentRound || 1) + durationRounds,
      reminderTiming: effectReminder,
      due: false,
    };
    setEffectName(""); setEffectEditorTokenId(null);
    const result = await runOptimisticCommand(
      "add-effect",
      { tokenId, name, effectType, reminderTiming: effectReminder, durationRounds },
      (current) => ({ ...current, tokens: current.tokens.map((token) => token.id === tokenId ? { ...token, effects: [...token.effects, optimisticEffect] } : token) }),
      `${name} added.`,
    );
    if (!result) { setEffectEditorTokenId(tokenId); setEffectName(name); }
  };

  const applyHpToToken = async (token: SharedToken, delta: number) => {
    if (!Number.isFinite(delta) || delta === 0 || token.maxHp === null) return;
    const hp = Math.min(token.maxHp, Math.max(0, (token.hp ?? token.maxHp) + Math.trunc(delta)));
    const result = await runOptimisticCommand<{ state: EncounterState; concentrationCheckRequired: boolean }>(
      "apply-hp",
      { tokenId: token.id, delta },
      (current) => ({ ...current, tokens: current.tokens.map((item) => item.id === token.id ? { ...item, hp, healthState: healthBand(hp, token.maxHp) } : item) }),
    );
    if (result) setNotice(result.concentrationCheckRequired ? "HP updated — concentration check reminder." : "HP updated.");
  };

  const removeEffectFromToken = (tokenId: string, effectId: string) => {
    void runOptimisticCommand(
      "remove-effect",
      { effectId },
      (current) => ({ ...current, tokens: current.tokens.map((token) => token.id === tokenId ? { ...token, effects: token.effects.filter((effect) => effect.id !== effectId) } : token) }),
    );
  };

  const saveTokenDetails = async (token: SharedToken) => {
    const draft = tokenDrafts[token.id] ?? {};
    const name = draft.name ?? token.name;
    const size = draft.size ?? token.size;
    const requestedSpeed = Number(draft.speed ?? token.speed);
    const speed = Number.isFinite(requestedSpeed) ? requestedSpeed : token.speed;
    const requestedMaxHp = draft.maxHp === undefined || draft.maxHp === "" ? token.maxHp : Number(draft.maxHp);
    const maxHp = requestedMaxHp !== null && Number.isFinite(requestedMaxHp) ? Math.max(1, Math.trunc(requestedMaxHp)) : token.maxHp;
    const artAsset = draft.artAsset ?? token.artAsset ?? "";
    setTokenEditorTokenId(null);
    const result = await runOptimisticCommand(
      "update-token",
      { tokenId: token.id, name, size, speed, maxHp: maxHp ?? undefined, artAsset },
      (current) => ({ ...current, tokens: current.tokens.map((item) => item.id === token.id ? { ...item, name, size, speed, maxHp, hp: maxHp === null ? null : Math.min(maxHp, item.hp ?? maxHp), artAsset: artAsset || null } : item) }),
      "Token details saved.",
    );
    if (result) {
      setTokenDrafts((current) => { const next = { ...current }; delete next[token.id]; return next; });
    } else {
      setTokenEditorTokenId(token.id);
    }
  };

  const startCombatOptimistically = () => {
    void runOptimisticCommand(
      "start-combat",
      {},
      (current) => {
        const leaders = current.tokens
          .filter((token) => !token.summonerTokenId && token.initiative !== null)
          .sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0) || a.name.localeCompare(b.name));
        const groupKeys = [...new Set(leaders.map((leader) => leader.initiativeGroupId || leader.id))];
        const groupOrders = new Map(groupKeys.map((key, order) => [key, order]));
        const orders = new Map(leaders.map((leader) => [leader.id, groupOrders.get(leader.initiativeGroupId || leader.id)!]));
        return {
          ...current,
          encounter: { ...current.encounter, status: "active", currentRound: 1, activeInitiativeOrder: 0 },
          tokens: current.tokens.map((token) => {
            const leaderId = token.summonerTokenId ?? token.id;
            return orders.has(leaderId)
              ? { ...token, initiativeOrder: orders.get(leaderId)!, turnComplete: false, movementUsed: 0, movementOrigin: null }
              : { ...token, initiativeOrder: null, turnComplete: false, movementUsed: 0, movementOrigin: null };
          }),
        };
      },
      "Combat started.",
    );
  };

  const advanceTurnState = (current: EncounterState, completeCurrentGroup: boolean) => {
    const orders = [...new Set(current.tokens.map((token) => token.initiativeOrder).filter((order): order is number => order !== null))].sort((a, b) => a - b);
    if (orders.length === 0) return current;
    const active = current.encounter.activeInitiativeOrder ?? orders[0];
    const index = Math.max(0, orders.indexOf(active));
    const wrapped = index >= orders.length - 1;
    const nextOrder = wrapped ? orders[0] : orders[index + 1];
    return {
      ...current,
      encounter: { ...current.encounter, activeInitiativeOrder: nextOrder, currentRound: Math.max(1, current.encounter.currentRound) + (wrapped ? 1 : 0) },
      tokens: current.tokens.map((token) => token.initiativeOrder === nextOrder
        ? { ...token, turnComplete: false, movementUsed: 0, movementOrigin: null }
        : completeCurrentGroup && token.initiativeOrder === active ? { ...token, turnComplete: true } : token),
    };
  };

  const endTurnOptimistically = (token: SharedToken) => {
    void runOptimisticCommand(
      "end-turn",
      { tokenId: token.id },
      (current) => advanceTurnState(current, true),
      "Group turn ended.",
      undefined,
      undefined,
      true,
    );
  };

  const advanceTurnOptimistically = () => {
    void runOptimisticCommand(
      "advance-turn",
      {},
      (current) => advanceTurnState(current, true),
      "Turn advanced.",
      undefined,
      undefined,
      true,
    );
  };

  const correctTurnOptimistically = (round: number, activeOrder: number) => {
    void runOptimisticCommand(
      "correct-turn",
      { round, activeOrder },
      (current) => ({
        ...current,
        encounter: { ...current.encounter, status: "active", currentRound: round, activeInitiativeOrder: activeOrder },
        tokens: current.tokens.map((token) => token.initiativeOrder === activeOrder ? { ...token, turnComplete: false, movementUsed: 0, movementOrigin: null } : token),
      }),
      "Turn corrected.",
    );
  };

  const configureEncounterOptimistically = async (status: "setup" | "active" | "paused", notice: string) => {
    const action = status === "setup" ? "reset" : status === "paused" ? "pause" : "resume";
    setEncounterAction(action);
    try {
      return await runOptimisticCommand("configure-encounter", { status }, (current) => ({ ...current, encounter: { ...current.encounter, status } }), notice);
    } finally {
      setEncounterAction(null);
    }
  };

  const setStrictMovementOptimistically = (enabled: boolean) => {
    void runOptimisticCommand(
      "set-strict-movement",
      { enabled },
      (current) => ({ ...current, encounter: { ...current.encounter, strictMovement: enabled } }),
      enabled ? "Strict movement enabled." : "Open movement enabled.",
    );
  };

  useEffect(() => {
    if (!resetConfirmOpen && !restartConfirmOpen && !scenarioCreatorOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setResetConfirmOpen(false);
        setRestartConfirmOpen(false);
        if (!scenarioCreating) setScenarioCreatorOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [resetConfirmOpen, restartConfirmOpen, scenarioCreating, scenarioCreatorOpen]);

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
    if (!participant || !state || !movementEnabled) return;
    if (participant.role === "player" && !effectivePlacementSummonerId) {
      setError("Your character is not available in this scenario, so a summon cannot be placed.");
      return;
    }
    const matchingCount = state.tokens.filter((token) => token.artAsset === creature.artAsset).length;
    const name = matchingCount === 0 ? creature.name : `${creature.name} ${matchingCount + 1}`;
    const summoner = effectivePlacementSummonerId ? state.tokens.find((token) => token.id === effectivePlacementSummonerId) : null;
    const temporaryId = `pending-create-${Date.now()}-${++tokenMutationSequenceRef.current}`;
    const historyMutationId = ++optimisticSequenceRef.current;
    const optimisticToken: SharedToken = {
      id: temporaryId,
      name,
      artAsset: creature.artAsset,
      kind: effectivePlacementSummonerId ? "summon" : "monster",
      size: creature.size,
      speed: creature.defaultSpeed,
      hp: creature.defaultHp,
      maxHp: creature.defaultHp,
      healthState: null,
      hidden: false,
      summonerTokenId: effectivePlacementSummonerId || null,
      initiative: summoner?.initiative ?? null,
      initiativeGroupId: null,
      initiativeOrder: summoner?.initiativeOrder ?? null,
      turnComplete: false,
      movementUsed: 0,
      movementOrigin: null,
      effects: [],
      controller: summoner?.controller ?? { name: participant.name },
      controlledByViewer: true,
      x: point.x,
      y: point.y,
    };
    pendingCreatesRef.current.set(temporaryId, optimisticToken);
    setState((current) => {
      if (!current) return current;
      localUndoHistoryRef.current = [...localUndoHistoryRef.current.slice(-9), { mutationId: historyMutationId, state: current }];
      localRedoHistoryRef.current = [];
      return { ...current, undo: { ...current.undo, available: Math.min(10, current.undo.available + 1), redoAvailable: 0 }, tokens: [...current.tokens, optimisticToken] };
    });
    setPlacementPreview(null);
    setError("");
    try {
      await command<{ tokenId: string; state: EncounterState }>("create-token", {
        name,
        kind: effectivePlacementSummonerId ? "summon" : "monster",
        size: creature.size,
        speed: creature.defaultSpeed,
        maxHp: creature.defaultHp,
        hp: creature.defaultHp,
        artAsset: creature.artAsset,
        summonerTokenId: effectivePlacementSummonerId || undefined,
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
      localUndoHistoryRef.current = localUndoHistoryRef.current.filter((entry) => entry.mutationId !== historyMutationId);
      setState((current) => current ? { ...current, tokens: current.tokens.filter((token) => token.id !== temporaryId) } : current);
      setError(placementError instanceof Error ? placementError.message : "Creature placement was rejected.");
      await refreshAfterError();
    }
  };

  const placeSpellEffect = async (spell: SpellEffectDefinition, point: MapPoint) => {
    if (!participant || !state || !movementEnabled) return;
    if (participant.role === "player" && !effectivePlacementSummonerId) {
      setError("Your character is not available in this scenario, so the spell cannot be placed.");
      return;
    }
    const matchingCount = state.tokens.filter((token) => token.kind === SPELL_EFFECT_KIND && token.artAsset === spell.artAsset).length;
    const name = matchingCount === 0 ? spell.name : `${spell.name} ${matchingCount + 1}`;
    const caster = effectivePlacementSummonerId ? state.tokens.find((token) => token.id === effectivePlacementSummonerId) : null;
    const temporaryId = `pending-create-${Date.now()}-${++tokenMutationSequenceRef.current}`;
    const historyMutationId = ++optimisticSequenceRef.current;
    const optimisticToken: SharedToken = {
      id: temporaryId,
      name,
      artAsset: spell.artAsset,
      kind: SPELL_EFFECT_KIND,
      size: spell.size,
      speed: 0,
      hp: null,
      maxHp: null,
      healthState: null,
      hidden: false,
      summonerTokenId: effectivePlacementSummonerId || null,
      initiative: caster?.initiative ?? null,
      initiativeGroupId: null,
      initiativeOrder: caster?.initiativeOrder ?? null,
      turnComplete: false,
      movementUsed: 0,
      movementOrigin: null,
      effects: [],
      controller: caster?.controller ?? { name: participant.name },
      controlledByViewer: true,
      x: point.x,
      y: point.y,
    };
    pendingCreatesRef.current.set(temporaryId, optimisticToken);
    setState((current) => {
      if (!current) return current;
      localUndoHistoryRef.current = [...localUndoHistoryRef.current.slice(-9), { mutationId: historyMutationId, state: current }];
      localRedoHistoryRef.current = [];
      return { ...current, undo: { ...current.undo, available: Math.min(10, current.undo.available + 1), redoAvailable: 0 }, tokens: [...current.tokens, optimisticToken] };
    });
    setSpellPlacementPreview(null);
    setError("");
    try {
      await command<{ tokenId: string; state: EncounterState }>("create-spell-effect", {
        spellId: spell.id,
        summonerTokenId: effectivePlacementSummonerId || undefined,
        x: point.x,
        y: point.y,
      }, (confirmed) => {
        pendingCreatesRef.current.delete(temporaryId);
        setState((current) => current ? { ...current, tokens: current.tokens.filter((token) => token.id !== temporaryId) } : current);
        setSelectedTokenId(confirmed.tokenId);
      });
      setNotice(`${spell.name} manifested.`);
    } catch (placementError) {
      pendingCreatesRef.current.delete(temporaryId);
      localUndoHistoryRef.current = localUndoHistoryRef.current.filter((entry) => entry.mutationId !== historyMutationId);
      setState((current) => current ? { ...current, tokens: current.tokens.filter((token) => token.id !== temporaryId) } : current);
      setError(placementError instanceof Error ? placementError.message : "Spell placement was rejected.");
      await refreshAfterError();
    }
  };

  const deleteToken = async (token: SharedToken) => {
    if (!participant || !state || pendingCreatesRef.current.has(token.id)) return;
    if (participant.role !== "dm" && (token.kind !== SPELL_EFFECT_KIND || !token.controlledByViewer)) return;
    pendingDeletesRef.current.add(token.id);
    pendingMovesRef.current.delete(token.id);
    setState((current) => current ? { ...current, tokens: current.tokens.filter((currentToken) => currentToken.id !== token.id) } : current);
    setSelectedTokenId((current) => current === token.id ? null : current);
    setError("");
    try {
      await command("delete-token", { tokenId: token.id }, () => {
        pendingDeletesRef.current.delete(token.id);
      });
      setNotice(token.kind === SPELL_EFFECT_KIND ? `${token.name} dismissed.` : "Token removed.");
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

  const onSpellDragStart = (event: ReactDragEvent<HTMLButtonElement>, spell: SpellEffectDefinition) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-spell-effect-id", spell.id);
    setArmedSpellId(spell.id);
  };

  const onMapDragOver = (event: ReactDragEvent<HTMLCanvasElement>) => {
    if (!state || !participant || !movementEnabled || (participant.role === "player" && !playerCharacter)) return;
    const spell = spellEffectById(event.dataTransfer.getData("application/x-spell-effect-id") || armedSpellId);
    if (spell) {
      event.preventDefault(); event.dataTransfer.dropEffect = "copy";
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
      void placeSpellEffect(spell, point);
      return;
    }
    const creature = paletteCreature(event.dataTransfer.getData("application/x-creature-id") || armedCreatureId);
    if (!creature) return;
    event.preventDefault();
    const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(creature.size));
    void placeCreature(creature, point);
  };

  const publishMove = async (tokenId: string, destination: MapPoint, encounter = state?.encounter.code) => {
    if (!participant || !encounter) return;
    const sequence = ++moveSequenceRef.current;
    const historyMutationId = ++optimisticSequenceRef.current;
    setState((current) => {
      if (!current) return current;
      const movingToken = current.tokens.find((token) => token.id === tokenId);
      if (!movingToken) return current;
      const movementOrigin = movingToken.kind === SPELL_EFFECT_KIND ? null : current.encounter.status === "active"
        ? movingToken.movementOrigin ?? { x: movingToken.x, y: movingToken.y }
        : movingToken.movementOrigin;
      const movementUsed = movingToken.kind === SPELL_EFFECT_KIND ? 0 : current.encounter.status === "active" && movementOrigin
        ? calculateDirectDistance(movementOrigin, destination, current.grid.feetPerCell)
        : movingToken.movementUsed;
      pendingMovesRef.current.set(tokenId, { ...destination, sequence, movementUsed, movementOrigin });
      localUndoHistoryRef.current = [...localUndoHistoryRef.current.slice(-9), { mutationId: historyMutationId, state: current }];
      localRedoHistoryRef.current = [];
      return { ...current, undo: { ...current.undo, available: Math.min(10, current.undo.available + 1), redoAvailable: 0 }, tokens: current.tokens.map((token) => token.id === tokenId ? { ...token, ...destination, movementUsed, movementOrigin } : token) };
    });
    setPreview(null); setDragOrigin(null); setError("");
    try {
      const result = await api<{ distance: number; overBudget: boolean; state: EncounterState }>(
        `/api/encounters/${encodeURIComponent(encounter)}/move`,
        { method: "POST", body: sessionPayload(participant, { tokenId, ...destination }) },
      );
      if (pendingMovesRef.current.get(tokenId)?.sequence === sequence) pendingMovesRef.current.delete(tokenId);
      acceptAuthoritativeState(result.state);
      const movedToken = state?.tokens.find((token) => token.id === tokenId);
      setNotice(movedToken?.kind === SPELL_EFFECT_KIND
        ? `${movedToken.name} repositioned.`
        : result.overBudget
          ? `Move confirmed · ${result.distance} ft · over movement.`
          : `Move confirmed · ${result.distance} ft.`);
    } catch (moveError) {
      if (pendingMovesRef.current.get(tokenId)?.sequence === sequence) pendingMovesRef.current.delete(tokenId);
      localUndoHistoryRef.current = localUndoHistoryRef.current.filter((entry) => entry.mutationId !== historyMutationId);
      setError(moveError instanceof Error ? moveError.message : "Move rejected.");
      await refreshAfterError();
    }
  };

  const addAnnotation = async (type: AnnotationMode, start: MapPoint, end?: MapPoint) => {
    if (type === "move" || type === "erase") return;
    const temporaryId = `pending-annotation-${Date.now()}-${++tokenMutationSequenceRef.current}`;
    const annotation: SharedAnnotation = {
      id: temporaryId,
      type,
      x: start.x,
      y: start.y,
      x2: end?.x ?? null,
      y2: end?.y ?? null,
      color: type === "spotlight" ? "#f5c65c" : "#75c8d8",
      label: null,
      createdBy: participant?.id ?? "pending",
      expiresAt: type === "ping" ? Date.now() + PING_DURATION_MS : type === "spotlight" ? Date.now() + 15_000 : null,
    };
    setAnnotationMode("move");
    await runOptimisticCommand("add-annotation", {
      annotationType: type,
      x: start.x, y: start.y,
      x2: end?.x, y2: end?.y,
      color: annotation.color,
    }, (current) => ({ ...current, annotations: [...current.annotations, annotation] }), type === "drawing" ? "Tactical line shared." : type === "spotlight" ? "DM spotlight shared." : undefined);
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
    void runOptimisticCommand(
      "remove-annotation",
      { annotationId: annotation.id },
      (current) => ({ ...current, annotations: current.annotations.filter((item) => item.id !== annotation.id) }),
      "Line erased.",
    );
  };

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!state || !participant) return;
    if (event.button !== 0) return;
    const point = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY);
    const rect = event.currentTarget.getBoundingClientRect();
    const geometry = viewportGeometry(viewport, state, rect.width, rect.height);
    const hitTokens = [...state.tokens].reverse().filter((token) => {
      if (pendingCreatesRef.current.has(token.id)) return false;
      const deltaX = (point.x - token.x) * geometry.cellSize;
      const deltaY = (point.y - token.y) * geometry.cellSize;
      const radius = geometry.cellSize * tokenRadiusCells(token.size);
      const distance = Math.hypot(deltaX, deltaY);
      const spell = token.kind === SPELL_EFFECT_KIND ? spellEffectByArt(token.artAsset) : null;
      if (spell?.id === "magic-circle") {
        const outerRadius = radius * 1.25;
        return distance >= outerRadius * 0.72 && distance <= outerRadius * 1.08;
      }
      return distance <= radius;
    });
    // A circle is scenery around its occupants: clicking a token inside must
    // select that token, while clicking the luminous perimeter selects the spell.
    const hitToken = hitTokens.find((token) => token.kind !== SPELL_EFFECT_KIND) ?? hitTokens[0];
    if (!movementEnabled) {
      if (hitToken?.kind === SPELL_EFFECT_KIND) setSelectedTokenId(hitToken.id);
      return;
    }
    const armedCreature = participant.role === "dm" || playerCharacter ? paletteCreature(armedCreatureId) : null;
    if (armedCreature) {
      event.preventDefault();
      const placementPoint = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(armedCreature.size));
      void placeCreature(armedCreature, placementPoint);
      return;
    }
    const armedSpell = participant.role === "dm" || playerCharacter ? spellEffectById(armedSpellId) : null;
    if (armedSpell) {
      event.preventDefault();
      const placementPoint = pointerToMap(event.currentTarget, state, viewport, event.clientX, event.clientY, tokenRadiusCells(armedSpell.size));
      void placeSpellEffect(armedSpell, placementPoint);
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
      else void addAnnotation(annotationMode, point);
      return;
    }
    if (hitToken && !dragGestureRef.current) {
      event.preventDefault();
      setSelectedTokenId(hitToken.id);
      if (!canMoveToken(hitToken)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const gesture: DragGesture = {
        pointerId: event.pointerId, tokenId: hitToken.id,
        origin: { x: hitToken.x, y: hitToken.y }, latest: { x: hitToken.x, y: hitToken.y },
        grabOffset: { x: point.x - hitToken.x, y: point.y - hitToken.y },
      };
      dragGestureRef.current = gesture; setDragging(true); setPreview({ tokenId: hitToken.id, x: hitToken.x, y: hitToken.y });
      setDragOrigin(hitToken.kind === SPELL_EFFECT_KIND ? null : state.encounter.status === "active" ? hitToken.movementOrigin ?? gesture.origin : gesture.origin);
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

  const togglePresenting = useCallback(() => {
    setPresenting((current) => {
      const next = !current;
      // Browser fullscreen is a bonus, not the mechanism: the class alone
      // already hides every panel, so a rejected request still presents.
      if (next) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
      return next;
    });
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!participant || !state) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest?.("input, textarea, select")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLocaleLowerCase();
      if (key === "escape" && presenting) { event.preventDefault(); togglePresenting(); return; }
      const tool: Record<string, AnnotationMode> = { v: "move", p: "ping", l: "drawing", e: "erase", s: "spotlight" };
      if (tool[key] && (tool[key] !== "spotlight" || participant?.role === "dm")) {
        event.preventDefault();
        if (tool[key] === "ping") enablePingAudio();
        setAnnotationMode(tool[key]);
        return;
      }
      if (key === "\\") { event.preventDefault(); setSidebarOpen((open) => !open); return; }
      if (key === "f") { event.preventDefault(); togglePresenting(); return; }
      if (key === "0") { event.preventDefault(); fitViewport(); return; }
      if (key === "=" || key === "+") { event.preventDefault(); changeZoom(0.5); return; }
      if (key === "-" || key === "_") { event.preventDefault(); changeZoom(-0.5); }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant?.role, presenting, togglePresenting, state]);

  if (!participant || !state) {
    return (
      <main className="join-shell"><section className="join-card" aria-labelledby="join-title">
        <div className="eyebrow">Living encounter · Tactical companion</div>
        <h1 id="join-title">Choose a scenario</h1>
        <p>Select the prepared encounter, then choose your seat.</p>
        <label className="scenario-picker">Scenario
          <select value={selectedEncounter.code} onChange={(event) => setEncounterCode(event.target.value)} disabled={busy}>
            {encounters.map((encounter) => <option key={encounter.code} value={encounter.code}>{encounter.name}</option>)}
          </select>
        </label>
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
  const connectionTooltip = connection === "live"
    ? "Live connection — shared encounter updates are current."
    : connection === "lost"
      ? "Connection lost — shared updates are unavailable."
      : connection === "reconnecting"
        ? "Reconnecting — restoring shared encounter updates."
        : "Connecting — loading shared encounter updates.";
  const initiativeTokens = [...state.tokens].filter((token) => token.kind !== SPELL_EFFECT_KIND && token.initiativeOrder !== null).sort((a, b) => (a.initiativeOrder ?? 999) - (b.initiativeOrder ?? 999) || a.name.localeCompare(b.name));

  if (participant.role === "dm" && workshopOpen) return <MapWorkshop
    activeMapPackage={state.encounter.mapPackage}
    activeMapPresetId={state.encounter.activeMapPresetId}
    savedPresets={state.savedMapPresets}
    onCommand={async (name, extra) => command<{ state: EncounterState; presetId?: string }>(name, extra)}
    onClose={() => setWorkshopOpen(false)}
  />;

  const mapKey = `${state.encounter.mapPackage?.id ?? "empty"}:${state.grid.width}x${state.grid.height}`;
  const inCombat = state.encounter.status === "active";
  const rosterRows = buildRosterRows(state.tokens, inCombat, rosterFilter, expandedGroups);
  const selectedHealth = selectedToken && !selectedSpell ? displayHealth(selectedToken.hp, selectedToken.maxHp, selectedToken.healthState) : null;
  const hpStep = Math.max(1, Math.trunc(Number(hpAmount)) || 1);
  const activeTurnMembers = state.tokens.filter((token) => token.kind !== SPELL_EFFECT_KIND &&
    token.initiativeOrder !== null && token.initiativeOrder === state.encounter.activeInitiativeOrder);
  const activeOwnTurnToken = activeTurnMembers.find((token) =>
    token.controlledByViewer && !token.turnComplete) ?? null;
  const activeOwnTurnIsGroup = activeTurnMembers.length > 1;

  const toolButton = (mode: AnnotationMode, icon: IconName, label: string, shortcut: string) => (
    <button
      className={`icon-tool${annotationMode === mode ? " tool-active" : ""}`}
      aria-label={label}
      data-tooltip={`${label} — ${shortcut}`}
      aria-pressed={annotationMode === mode}
      onClick={() => { if (mode === "ping") enablePingAudio(); setAnnotationMode(mode); }}
    ><Icon name={icon} /></button>
  );

  const healthBar = (token: SharedToken) => {
    const health = displayHealth(token.hp, token.maxHp, token.healthState);
    if (!health) return <span className="roster-health is-unknown" aria-hidden="true" />;
    return (
      <span className={`roster-health is-${health.band}`} title={health.label ?? undefined}>
        <span className="roster-health-fill" style={{ width: `${Math.round(health.ratio * 100)}%`, background: health.color }} />
      </span>
    );
  };

  const rosterRow = (token: SharedToken, grouped: boolean) => {
    const selected = token.id === selectedToken?.id;
    const active = token.initiativeOrder !== null && token.initiativeOrder === state.encounter.activeInitiativeOrder;
    const pendingCreate = isPendingCreate(token);
    return (
      <button
        key={token.id}
        type="button"
        className={`roster-row${selected ? " is-selected" : ""}${active ? " is-active" : ""}${token.turnComplete ? " is-complete" : ""}${grouped ? " is-grouped" : ""}${token.controlledByViewer ? " is-mine" : ""}`}
        aria-pressed={selected}
        disabled={pendingCreate}
        onClick={() => setSelectedTokenId(token.id)}
      >
        {token.artAsset
          ? <NextImage className="roster-portrait" src={token.artAsset} alt="" width={44} height={44} unoptimized />
          : <span className="roster-portrait roster-initial">{tokenInitial(token)}</span>}
        <span className="roster-name">{token.name}{token.hidden ? <em> · hidden</em> : null}</span>
        {healthBar(token)}
        <span className="roster-hp">{token.hp !== null && token.maxHp !== null ? `${token.hp}/${token.maxHp}` : ""}</span>
        {token.effects.length > 0
          ? <span className={`roster-effects${token.effects.some((effect) => effect.due) ? " is-due" : ""}`}>{token.effects.length}</span>
          : null}
        <span className="roster-initiative">{token.initiative ?? "—"}</span>
      </button>
    );
  };

  return (
    <main className={`app-shell${presenting ? " is-presenting" : ""}${sidebarOpen ? "" : " is-collapsed"}`}>
      <div className="command-bar" aria-label="Map tools and encounter status">
        <div className="map-tool-group" role="group" aria-label="Tactical tools">
          {toolButton("move", "move", "Move tokens", "V")}
          {toolButton("ping", "ping", "Ping map", "P")}
          {toolButton("drawing", "line", "Draw line", "L")}
          {toolButton("erase", "erase", "Erase line", "E")}
          {participant.role === "dm" ? toolButton("spotlight", "spotlight", "Place spotlight", "S") : null}
          {participant.role === "dm" ? <button className="icon-tool" aria-label="Clear all annotations" data-tooltip="Clear all annotations" onClick={() => void runOptimisticCommand("clear-annotations", {}, (current) => ({ ...current, annotations: [] }), "Annotations cleared.")}><Icon name="clear" /></button> : null}
        </div>
        <div className="map-tool-group" role="group" aria-label="Map content">
          <button className={`icon-tool${paletteOpen ? " tool-active" : ""}`} aria-label="Creature palette" data-tooltip="Creature palette" aria-pressed={paletteOpen} onClick={() => { setPaletteOpen((open) => !open); setSpellPaletteOpen(false); setArmedSpellId(null); setSpellPlacementPreview(null); setAnnotationMode("move"); }}><Icon name="creatures" /></button>
          <button className={`icon-tool${spellPaletteOpen ? " tool-active" : ""}`} aria-label="Spell effects" data-tooltip="Spell effects" aria-pressed={spellPaletteOpen} onClick={() => { setSpellPaletteOpen((open) => !open); setPaletteOpen(false); setArmedCreatureId(null); setPlacementPreview(null); setAnnotationMode("move"); }}><Icon name="spells" /></button>
          {participant.role === "dm" ? <button className="icon-tool" aria-label="Open Map Workshop" data-tooltip="Map Workshop" onClick={() => setWorkshopOpen(true)}><Icon name="workshop" /></button> : null}
          {participant.role === "dm" ? <button className="icon-tool" aria-label="Create scenario" data-tooltip="Create scenario" onClick={() => { setScenarioError(""); setScenarioCreatorOpen(true); }}><Icon name="scenarios" /></button> : null}
        </div>
        <div className="map-tool-group" role="group" aria-label="Action history">
          <button className="icon-tool" aria-label="Undo last action" data-tooltip="Undo — Ctrl/Cmd + Z" onClick={() => void runHistoryOptimistically("undo")} disabled={busy || state.undo.available === 0}><Icon name="undo" /></button>
          <button className="icon-tool" aria-label="Redo last action" data-tooltip="Redo — Ctrl + Y or Cmd + Shift + Z" onClick={() => void runHistoryOptimistically("redo")} disabled={busy || state.undo.redoAvailable === 0}><Icon name="redo" /></button>
        </div>

        <div className="encounter-identity">
          <strong>{state.encounter.name}</strong>
          <span>{state.encounter.status}</span>
        </div>
        <div className="round-counter" aria-label={state.encounter.currentRound > 0 ? `Current round ${state.encounter.currentRound}` : "Combat has not started"}>
          <span>Round</span>
          <strong>{state.encounter.currentRound > 0 ? state.encounter.currentRound : "—"}</strong>
        </div>

        <div className="map-tool-group viewport-tools" role="group" aria-label="Map view">
          <button className={`icon-tool${viewport.fit ? " tool-active" : ""}`} aria-label="Fit whole map" data-tooltip="Fit whole map — 0" aria-pressed={viewport.fit} onClick={fitViewport}><Icon name="fit" /></button>
          <button className="icon-tool" aria-label="Zoom out" data-tooltip="Zoom out — minus" onClick={() => changeZoom(-0.5)}><Icon name="zoomOut" /></button>
          <button className="zoom-value" aria-label="Reset zoom" data-tooltip="Reset zoom" onClick={() => setViewport({ zoom: 1, centerX: state.grid.width / 2, centerY: state.grid.height / 2, mapKey, fit: false })}>{viewport.fit ? "Fit" : `${Math.round((viewport.mapKey === mapKey ? viewport.zoom : 1) * 100)}%`}</button>
          <button className="icon-tool" aria-label="Zoom in" data-tooltip="Zoom in — plus" onClick={() => changeZoom(0.5)}><Icon name="zoomIn" /></button>
        </div>
        <div className={`connection-pill connection-${connection}`} aria-label={connectionTooltip} data-tooltip={connectionTooltip} aria-live="polite"><span className="connection-dot" /><em>{connectionLabel}</em></div>
        <div className="map-tool-group" role="group" aria-label="Layout">
          <details className="ui-settings-menu">
            <summary className="icon-tool" aria-label="UI Settings" data-tooltip="UI Settings"><Icon name="settings" /></summary>
            <section className="ui-settings-panel" aria-label="UI Settings">
              <div className="ui-settings-heading"><strong>UI Settings</strong><small>Personal and encounter display controls</small></div>
              <div className="ui-settings-section-label"><strong>Your display</strong><small>Only changes your view</small></div>
              <label className="grid-opacity-control">
                <span>Grid visibility <output>{Math.round(gridOpacity * 100)}%</output></span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(gridOpacity * 100)}
                  style={{ "--grid-level": `${Math.round(gridOpacity * 100)}%` } as CSSProperties}
                  aria-label="Grid visibility"
                  onChange={(event) => setGridOpacity(Number(event.target.value) / 100)}
                />
              </label>
              <label className="ui-setting-toggle">
                <span><strong>Transparent token centers</strong><small>Show terrain instead of colored disks</small></span>
                <input
                  type="checkbox"
                  checked={transparentTokenBackgrounds}
                  aria-label="Transparent token centers"
                  onChange={(event) => setTransparentTokenBackgrounds(event.target.checked)}
                />
              </label>
              {participant.role === "dm" ? <div className="ui-settings-global">
                <div className="ui-settings-section-label"><strong>Encounter settings</strong><small>Affects everyone</small></div>
                <label
                  className="ui-setting-toggle"
                  data-tooltip="With strict movement on, players can move only their own character and related summons. The DM can always move any token. Turn it off to let anyone move any visible token."
                >
                  <span><strong>Strict movement</strong><small>Players move only their tokens</small></span>
                  <input
                    type="checkbox"
                    checked={state.encounter.strictMovement}
                    aria-label="Strict movement"
                    aria-describedby="strict-movement-help"
                    onChange={(event) => setStrictMovementOptimistically(event.target.checked)}
                  />
                </label>
                <span id="strict-movement-help" className="visually-hidden">With strict movement on, players can move only their own character and related summons. The DM can always move any token. Turn it off to let anyone move any visible token.</span>
              </div> : null}
            </section>
          </details>
          <button className={`icon-tool${sidebarOpen ? "" : " tool-active"}`} aria-label={sidebarOpen ? "Hide encounter panel" : "Show encounter panel"} data-tooltip={"Encounter panel — \\"} aria-pressed={!sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}><Icon name="sidebar" /></button>
          <button className={`icon-tool${presenting ? " tool-active" : ""}`} aria-label="Presentation mode" data-tooltip="Presentation mode — F" aria-pressed={presenting} onClick={togglePresenting}><Icon name="present" /></button>
        </div>
      </div>

      <div className="workspace">
        <section className="map-panel" aria-label="Shared battle map">
          <div className="map-stage">
          <div className="map-frame" style={{ aspectRatio: `${state.grid.width} / ${state.grid.height}` }}>
            <canvas ref={canvasRef} className={`map-canvas${dragging ? " is-dragging" : ""}${panning ? " is-panning" : ""}${armedCreatureId || armedSpellId ? " is-placing" : ""}${annotationMode === "erase" ? " is-erasing" : ""}${movementEnabled ? "" : " is-blocked"}`} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerCancel={onCanvasPointerCancel} onWheel={onCanvasWheel} onDragOver={onMapDragOver} onDrop={onMapDrop} onDragLeave={() => { setPlacementPreview(null); setSpellPlacementPreview(null); }} aria-label={`${state.grid.width} by ${state.grid.height} battle grid with ${state.tokens.length} visible tokens. ${armedCreatureId ? "Click to place the selected creature." : armedSpellId ? "Click to manifest the selected spell effect." : annotationMode === "erase" ? "Erase mode. Click a drawn line to remove it." : participant.role === "dm" || !state.encounter.strictMovement ? "Drag any visible token to move it, or drag empty map space to pan." : selectedToken ? `Selected ${selectedToken.name}. Drag the token to move it, or drag empty map space to pan.` : "Scroll to zoom and drag empty map space to pan."}`} role="img" />
            {paletteOpen ? <section className="creature-palette" aria-label="Creature palette">
              <div className="palette-heading"><div><small>Quick placement</small><h2>Creature palette</h2></div><button aria-label="Close creature palette" onClick={() => { setPaletteOpen(false); setArmedCreatureId(null); setPlacementPreview(null); }}><Icon name="close" /></button></div>
              {participant.role === "dm"
                ? <label className="palette-controller">Control<select value={placementSummonerId} onChange={(event) => setPlacementSummonerId(event.target.value)}><option value="">DM-controlled creature</option>{state.tokens.filter((token) => token.kind === "character" && !token.summonerTokenId).map((token) => <option value={token.id} key={token.id}>Summoned by {token.name}</option>)}</select></label>
                : <p className="palette-controller">Anything you place is summoned by {playerCharacter?.name ?? "your character"} and controlled by you.</p>}
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
              <p className="palette-hint">Drag a creature onto the map, or select one and click repeatedly to place copies.</p>
            </section> : null}
            {spellPaletteOpen ? <section className="spell-palette" aria-label="Spell effects palette">
              <div className="palette-heading"><div><small>Persistent magic</small><h2>Spell effects</h2></div><button aria-label="Close spell effects" onClick={() => { setSpellPaletteOpen(false); setArmedSpellId(null); setSpellPlacementPreview(null); }}><Icon name="close" /></button></div>
              <p className="spell-palette-intro">Drag an effect onto the battlefield. It stays live, synchronizes for everyone, and can be repositioned like a token.</p>
              <div className="spell-grid">
                {SPELL_EFFECTS.map((spell) => <button type="button" draggable className={`spell-tile is-${spell.id}${armedSpellId === spell.id ? " is-armed" : ""}`} key={spell.id} onDragStart={(event) => onSpellDragStart(event, spell)} onDragEnd={() => setSpellPlacementPreview(null)} onClick={() => setArmedSpellId((current) => current === spell.id ? null : spell.id)} aria-pressed={armedSpellId === spell.id}>
                  <span className="spell-art"><NextImage src={spell.artAsset} alt="" width={240} height={240} unoptimized /></span>
                  <span className="spell-copy"><small>{spell.areaLabel}</small><strong>{spell.name}</strong><em>{spell.description}</em></span>
                </button>)}
              </div>
              {participant.role === "player" ? <p className="palette-controller">Your effects are controlled by {playerCharacter?.name ?? "your character"}.</p> : <p className="palette-controller">DM effects are controlled by Kevin.</p>}
              {armedSpellId ? <button className="palette-cancel" onClick={() => { setArmedSpellId(null); setSpellPlacementPreview(null); }}>Cancel spell placement</button> : null}
              <p className="palette-hint">Drag onto the map, or select an effect and click to place it.</p>
            </section> : null}
            {error ? <div className="map-message is-error" role="alert">{error}</div> : notice ? <div className="map-message" role="status">{notice}</div> : null}
            {connection !== "live" || state.encounter.status === "paused" ? <div className="map-safety-overlay"><strong>{state.encounter.status === "paused" ? "Encounter paused" : connectionLabel}</strong><span>{state.encounter.status === "paused" ? "The DM paused the encounter. Movement and turn advancement are temporarily disabled." : "Movement is paused until shared state is current."}</span></div> : null}
            {presenting ? <button className="present-exit" onClick={togglePresenting}>Exit presentation · Esc</button> : null}
          </div>
          </div>
        </section>

        <aside className="control-panel" aria-label="Encounter controls" hidden={!sidebarOpen || presenting}>
          <div className="panel-head">
            <div className="participant-row"><span className="participant-avatar">{participant.name.charAt(0).toUpperCase()}</span><span><small>{participant.role === "dm" ? "Dungeon Master" : "Joined as"}</small><strong>{participant.name}</strong></span></div>
            <span className="panel-round">{state.tokens.length} tokens</span>
          </div>
          <label className="roster-filter">
            <Icon name="search" />
            <input type="search" value={rosterFilter} onChange={(event) => setRosterFilter(event.target.value)} placeholder={inCombat ? "Filter turn order" : "Filter tokens"} aria-label="Filter tokens" autoComplete="off" />
          </label>

          <div className="token-roster" role="list" aria-label={inCombat ? "Turn order" : "Tokens"}>
            {rosterRows.length === 0 ? <p className="empty-copy">No tokens match “{rosterFilter}”.</p> : null}
            {rosterRows.map((row) => row.type === "group" ? (
              <div className={`roster-group${row.tokens[0].initiativeOrder !== null && row.tokens[0].initiativeOrder === state.encounter.activeInitiativeOrder ? " is-active" : ""}`} key={row.key}>
                <button
                  type="button"
                  className="roster-row is-group"
                  aria-expanded={row.expanded}
                  onClick={() => setExpandedGroups((current) => {
                    const next = new Set(current);
                    if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
                    return next;
                  })}
                >
                  {row.tokens[0].artAsset
                    ? <NextImage className="roster-portrait" src={row.tokens[0].artAsset} alt="" width={44} height={44} unoptimized />
                    : <span className="roster-portrait roster-initial">{tokenInitial(row.tokens[0])}</span>}
                  <span className="roster-name">{row.label}<em> ×{row.tokens.length}</em></span>
                  <span className="roster-group-toggle">{row.expanded ? "Hide" : "Show"}</span>
                  <span className="roster-initiative">{row.tokens[0].initiative ?? "—"}</span>
                </button>
                {!inCombat && participant.role === "dm" ? <div className="roster-group-initiative">
                  <label htmlFor={`initiative-${row.key}`}>All</label>
                  <input
                    id={`initiative-${row.key}`}
                    aria-label={`Initiative for all ${row.label} creatures`}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={2}
                    placeholder={row.tokens.every((token) => token.initiative === row.tokens[0].initiative) && row.tokens[0].initiative !== null ? String(row.tokens[0].initiative) : "—"}
                    value={initiativeDrafts[`group:${row.key}`] ?? ""}
                    onChange={(event) => {
                      const next = event.target.value.replace(/\D/g, "").slice(0, 2);
                      setInitiativeDrafts((current) => ({ ...current, [`group:${row.key}`]: next }));
                      setInitiativeStatuses((current) => ({ ...current, [`group:${row.key}`]: "editing" }));
                    }}
                    onBlur={() => void saveInitiativeGroup(row.key, row.tokens)}
                    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                  />
                  <span aria-live="polite">{initiativeStatuses[`group:${row.key}`] === "saving" ? "Saving…" : "initiative"}</span>
                </div> : null}
              </div>
            ) : rosterRow(row.token, row.grouped))}
          </div>

          {selectedToken && selectedSpell ? <section className={`spell-detail is-${selectedSpell.id}`} aria-label={`${selectedToken.name} spell effect details`}>
            <div className="spell-detail-visual"><NextImage src={selectedSpell.artAsset} alt="" width={180} height={180} unoptimized /></div>
            <div className="spell-detail-copy"><small>Persistent spell · controlled by {selectedToken.controller.name}</small><h2>{selectedToken.name}</h2><p>{selectedSpell.description}</p></div>
            <div className="spell-detail-meta"><span><small>Area</small><strong>{selectedSpell.areaLabel}</strong></span><span><small>Movement</small><strong>{canMoveToken(selectedToken) ? "Drag directly" : `Owner only · ${selectedToken.controller.name}`}</strong></span></div>
            {selectedToken.controlledByViewer ? <button className="dismiss-spell-button" onClick={() => void deleteToken(selectedToken)}>Dismiss {selectedSpell.name}</button> : null}
          </section> : selectedToken ? <section className="token-detail" aria-label={`${selectedToken.name} details`}>
            <div className="token-heading">
              {selectedToken.artAsset ? <NextImage className="token-portrait" src={selectedToken.artAsset} alt="" width={48} height={48} unoptimized /> : <span className="token-mini">{tokenInitial(selectedToken)}</span>}
              <div><small>{`${selectedToken.hidden ? "Hidden · " : ""}${selectedToken.kind} · controlled by ${selectedToken.controller.name}`}</small><h2>{selectedToken.name}</h2></div>
            </div>
            <div className="token-meta">
              <span><small>Size</small><strong>{selectedToken.size.charAt(0).toUpperCase() + selectedToken.size.slice(1)}</strong></span>
              <span><small>Speed</small><strong>{selectedToken.speed} ft</strong></span>
              <span><small>HP</small><strong>{selectedHealth?.label ?? "—"}</strong></span>
            </div>
            {(() => {
              const token = selectedToken;
              const controlled = token.controlledByViewer;
              const packMembers = initiativePackMembers(token, state.tokens);
              return <>
                <div className="initiative-editor"><label>Initiative<input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={initiativeDrafts[token.id] ?? token.initiative ?? ""} onChange={(event) => { const next = event.target.value.replace(/\D/g, "").slice(0, 2); setInitiativeDrafts((current) => ({ ...current, [token.id]: next })); setInitiativeStatuses((current) => ({ ...current, [token.id]: "editing" })); }} onBlur={() => void saveInitiative(token)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} disabled={!controlled} aria-describedby={`initiative-status-${token.id}`} /></label><span id={`initiative-status-${token.id}`} className={`initiative-save-status is-${initiativeStatuses[token.id] ?? "idle"}`} aria-live="polite">{!controlled ? "Controller only" : initiativeStatuses[token.id] === "saving" ? "Saving…" : initiativeStatuses[token.id] === "saved" ? "Saved" : "Enter or leave to save"}</span></div>
                {participant.role === "dm" && packMembers.length > 1 ? <div className="initiative-pack-note">
                  <span>{token.initiativeGroupId ? `Shared with ${packMembers.length - 1} matching ${packMembers.length === 2 ? "creature" : "creatures"}.` : `Changes apply to all ${packMembers.length} matching creatures.`}</span>
                  {token.initiativeGroupId ? <button className="inline-action" onClick={() => splitInitiativePack(token)}>Split from group</button> : null}
                </div> : null}
                {controlled && token.hp !== null && token.maxHp !== null ? <div className="hp-panel">
                  <div className="hp-readout"><strong>HP {token.hp}/{token.maxHp}</strong><span className={`hp-track is-${selectedHealth?.band ?? "unharmed"}`}><span className="hp-track-fill" style={{ width: `${Math.round((selectedHealth?.ratio ?? 0) * 100)}%`, background: selectedHealth?.color }} /></span></div>
                  <div className="hp-row">
                    <button className="hp-step" aria-label="Decrease amount" onClick={() => setHpAmount(String(Math.max(1, hpStep - 1)))}>−</button>
                    <input aria-label="HP change amount" type="text" inputMode="numeric" pattern="[0-9]*" value={hpAmount} onChange={(event) => setHpAmount(event.target.value.replace(/\D/g, "").slice(0, 3))} onKeyDown={(event) => { if (event.key === "Enter") void applyHpToToken(token, -hpStep); }} />
                    <button className="hp-step" aria-label="Increase amount" onClick={() => setHpAmount(String(hpStep + 1))}>+</button>
                    <button className="hp-apply is-damage" onClick={() => void applyHpToToken(token, -hpStep)}>Damage</button>
                    <button className="hp-apply is-heal" onClick={() => void applyHpToToken(token, hpStep)}>Heal</button>
                  </div>
                </div> : null}
                <div className="effect-list">{token.effects.map((effect) => <span className={effect.due ? "effect-chip is-due" : "effect-chip"} key={effect.id}>{effect.name}{effect.expiresRound ? ` · R${effect.expiresRound}` : ""}{controlled ? <button aria-label={`Remove ${effect.name}`} onClick={() => removeEffectFromToken(token.id, effect.id)}>×</button> : null}</span>)}</div>
                {controlled && effectEditorTokenId !== token.id ? <button className="inline-action effect-editor-toggle" onClick={() => { setEffectEditorTokenId(token.id); setEffectName(""); }}>+ Effect</button> : null}
                {controlled && effectEditorTokenId === token.id ? <div className="compact-form effect-form"><select aria-label="Effect preset" defaultValue="" onChange={(event) => { const preset = event.target.value; if (preset === "bless") { setEffectName("Bless"); setEffectType("concentration"); setEffectDuration("10"); } else if (preset === "poisoned") { setEffectName("Poisoned"); setEffectType("condition"); setEffectDuration("1"); } else if (preset === "stunned") { setEffectName("Stunned"); setEffectType("condition"); setEffectDuration("1"); } }}><option value="">Preset…</option><option value="bless">Bless</option><option value="poisoned">Poisoned</option><option value="stunned">Stunned</option></select><input aria-label="Effect name" placeholder="Custom effect" value={effectName} onChange={(event) => setEffectName(event.target.value)} /><select aria-label="Effect type" value={effectType} onChange={(event) => setEffectType(event.target.value)}><option value="condition">Condition</option><option value="effect">Effect</option><option value="concentration">Concentration</option></select><select aria-label="Reminder timing" value={effectReminder} onChange={(event) => setEffectReminder(event.target.value)}><option value="start">Start of turn</option><option value="end">End of turn</option></select><input aria-label="Duration rounds" type="number" min="1" max="99" value={effectDuration} onChange={(event) => setEffectDuration(event.target.value)} /><button onClick={() => void addEffectToToken(token.id)} disabled={!effectName.trim()}>Add</button><button className="effect-editor-cancel" onClick={() => { setEffectEditorTokenId(null); setEffectName(""); }}>Cancel</button></div> : null}
                {controlled ? <div className="movement-summary"><span>Movement</span><strong>{token.movementUsed}/{token.speed} ft</strong></div> : null}
                {controlled && preview?.tokenId === token.id ? <div className={`move-review${overMovement ? " is-over" : ""}`}><div><small>Destination</small><strong>{formatPosition(preview)}</strong></div><div><small>Direct / remaining</small><strong>{distance} / {remainingMovement} ft</strong></div></div> : null}
                {participant.role === "dm" ? <div className="token-actions">
                  <button className="inline-action" onClick={() => setTokenEditorTokenId((current) => current === token.id ? null : token.id)}>{tokenEditorTokenId === token.id ? "Close details" : "Edit details"}</button>
                  <button className="inline-action" onClick={() => void runOptimisticCommand("update-token", { tokenId: token.id, hidden: !token.hidden }, (current) => ({ ...current, tokens: current.tokens.map((item) => item.id === token.id ? { ...item, hidden: !token.hidden } : item) }), token.hidden ? "Token revealed." : "Token hidden.")}>{token.hidden ? "Reveal" : "Hide"}</button>
                  {pendingDeleteTokenId === token.id
                    ? <><button className="inline-action is-danger is-confirming" onClick={() => { setPendingDeleteTokenId(null); void deleteToken(token); }}>Confirm delete</button><button className="inline-action" onClick={() => setPendingDeleteTokenId(null)}>Keep</button></>
                    : <button className="inline-action is-danger" onClick={() => setPendingDeleteTokenId(token.id)}>Delete</button>}
                </div> : null}
                {participant.role === "dm" && tokenEditorTokenId === token.id ? <div className="token-config">
                  <input aria-label="Token name" value={tokenDrafts[token.id]?.name ?? token.name} onChange={(event) => setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], name: event.target.value } }))} />
                  <div className="form-grid">
                    <label>Size<select aria-label="Token size" value={tokenDrafts[token.id]?.size ?? token.size} onChange={(event) => setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], size: event.target.value as CreatureSize } }))}>{CREATURE_SIZES.map((size) => <option value={size} key={size}>{size.charAt(0).toUpperCase() + size.slice(1)}</option>)}</select></label>
                    <label>Speed<input aria-label="Token speed" type="number" value={tokenDrafts[token.id]?.speed ?? token.speed} onChange={(event) => setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], speed: event.target.value } }))} /></label>
                    <label>Max HP<input aria-label="Token maximum HP" type="number" value={tokenDrafts[token.id]?.maxHp ?? token.maxHp ?? ""} onChange={(event) => setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], maxHp: event.target.value } }))} /></label>
                  </div>
                  <label>Portrait<select aria-label="Token portrait" value={tokenDrafts[token.id]?.artAsset ?? token.artAsset ?? ""} onChange={(event) => setTokenDrafts((current) => ({ ...current, [token.id]: { ...current[token.id], artAsset: event.target.value } }))}><option value="">No portrait</option>{state.availableArt.map((path) => <option value={path} key={path}>{artLabel(path)}</option>)}</select></label>
                  <button className="secondary-button" onClick={() => void saveTokenDetails(token)}>Save details</button>
                </div> : null}
              </>;
            })()}
          </section> : null}

          <div className="panel-foot">
            {activeOwnTurnToken && participant.role !== "dm"
              ? <button className="end-turn-button" onClick={() => endTurnOptimistically(activeOwnTurnToken)}>{activeOwnTurnIsGroup ? "End Group Turn" : "End Turn"}</button>
              : null}
            {participant.role === "dm" ? <>
              <div className="button-row">
                <button className="primary-button" aria-describedby="restart-combat-help" data-tooltip={inCombat ? "Start again at round 1 using the current initiative. Keeps the map, tokens, HP, effects, and initiative values." : "Begin combat at round 1 using the entered initiative values."} onClick={() => { if (inCombat) setRestartConfirmOpen(true); else startCombatOptimistically(); }}>{inCombat ? "Restart combat" : "Start combat"}</button>
                <span id="restart-combat-help" className="visually-hidden">Restart begins combat again at round 1 using the current initiative values while preserving the map, tokens, HP, and effects.</span>
                <button className="secondary-button" onClick={advanceTurnOptimistically} disabled={!inCombat}>Advance</button>
              </div>
              <div className="button-row encounter-state-controls">
                <button
                  className={`secondary-button${encounterAction === "pause" || encounterAction === "resume" ? " is-pending" : ""}`}
                  aria-busy={encounterAction === "pause" || encounterAction === "resume"}
                  aria-describedby="pause-encounter-help"
                  data-tooltip="Temporarily freezes movement and turn advancement. The current round and initiative are preserved."
                  disabled={encounterAction !== null}
                  onClick={() => void configureEncounterOptimistically(state.encounter.status === "paused" ? "active" : "paused", state.encounter.status === "paused" ? "Encounter resumed." : "Encounter paused.")}
                >{encounterAction === "pause" ? "Pausing…" : encounterAction === "resume" ? "Resuming…" : state.encounter.status === "paused" ? "Resume" : "Pause"}</button>
                <span id="pause-encounter-help" className="visually-hidden">Temporarily freezes movement and turn advancement while preserving the current round and initiative.</span>
                <button className={`secondary-button${encounterAction === "reset" ? " is-pending" : ""}`} aria-busy={encounterAction === "reset"} aria-describedby="reset-encounter-help" data-tooltip="Exit combat and return to setup. Clears the round, active turn, and movement tracking; keeps the map, tokens, HP, effects, and initiative values." disabled={encounterAction !== null} onClick={() => setResetConfirmOpen(true)}>{encounterAction === "reset" ? "Resetting…" : "Reset"}</button>
                <span id="reset-encounter-help" className="visually-hidden">Reset exits combat and returns the encounter to setup while preserving the map, tokens, HP, effects, and initiative values.</span>
              </div>
              {initiativeTokens.length ? <details className="turn-correction-details">
                <summary>Correct turn</summary>
                <div className="turn-correction"><label>Round<input type="number" min="1" value={Math.max(1, state.encounter.currentRound)} onChange={(event) => correctTurnOptimistically(Number(event.target.value), state.encounter.activeInitiativeOrder ?? 0)} /></label><label>Active group<select value={state.encounter.activeInitiativeOrder ?? 0} onChange={(event) => correctTurnOptimistically(Math.max(1, state.encounter.currentRound), Number(event.target.value))}>{[...new Set(initiativeTokens.map((token) => token.initiativeOrder))].map((order) => <option key={order} value={order ?? 0}>#{(order ?? 0) + 1}</option>)}</select></label></div>
              </details> : null}
            </> : null}
          </div>
        </aside>
      </div>
      {participant.role === "dm" && resetConfirmOpen ? <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResetConfirmOpen(false); }}>
        <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-encounter-title" aria-describedby="reset-encounter-description">
          <div className="eyebrow">Encounter control</div>
          <h2 id="reset-encounter-title">Reset combat?</h2>
          <p id="reset-encounter-description">This returns the encounter to setup, clears the current round, active turn, and movement tracking. The map, tokens, HP, effects, and entered initiative numbers stay intact.</p>
          <div className="button-row">
            <button className="secondary-button" autoFocus onClick={() => setResetConfirmOpen(false)}>Cancel</button>
            <button className="danger-button" onClick={() => { setResetConfirmOpen(false); void configureEncounterOptimistically("setup", "Encounter reset to setup."); }}>Reset combat</button>
          </div>
        </section>
      </div> : null}
      {participant.role === "dm" && restartConfirmOpen ? <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRestartConfirmOpen(false); }}>
        <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="restart-combat-title" aria-describedby="restart-combat-description">
          <div className="eyebrow">Encounter control</div>
          <h2 id="restart-combat-title">Restart combat?</h2>
          <p id="restart-combat-description">This returns combat to round 1 and rebuilds the turn order from the current initiative numbers. Movement and completed-turn tracking reset. The map, tokens, HP, and effects stay intact.</p>
          <div className="button-row">
            <button className="secondary-button" autoFocus onClick={() => setRestartConfirmOpen(false)}>Cancel</button>
            <button className="danger-button" onClick={() => { setRestartConfirmOpen(false); startCombatOptimistically(); }}>Restart combat</button>
          </div>
        </section>
      </div> : null}
      {participant.role === "dm" && scenarioCreatorOpen ? <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !scenarioCreating) setScenarioCreatorOpen(false); }}>
        <section className="confirm-dialog scenario-dialog" role="dialog" aria-modal="true" aria-labelledby="create-scenario-title" aria-describedby="create-scenario-description">
          <div className="eyebrow">Scenario library</div>
          <h2 id="create-scenario-title">Create a scenario</h2>
          <p id="create-scenario-description">The new scenario gets its own map, tokens, combat state, and history. You will switch to it immediately.</p>
          <label>Scenario name<input autoFocus maxLength={64} value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createScenario(); } }} placeholder="The Sunken Observatory" disabled={scenarioCreating} /></label>
          <label>Starting point<select value={scenarioMode} onChange={(event) => setScenarioMode(event.target.value === "duplicate" ? "duplicate" : "party")} disabled={scenarioCreating}>
            <option value="party">Fresh scenario — current party only</option>
            <option value="duplicate">Duplicate current map and tokens</option>
          </select></label>
          <p className="scenario-mode-help">{scenarioMode === "duplicate" ? "Copies the map and every token. Combat, initiative, effects, and history start clean." : "Copies Dar'eleth, Jelton, and Malichar at full health. Choose a map and add encounters afterward."}</p>
          {scenarioError ? <div className="form-error" role="alert">{scenarioError}</div> : null}
          <div className="button-row">
            <button className="secondary-button" onClick={() => setScenarioCreatorOpen(false)} disabled={scenarioCreating}>Cancel</button>
            <button className={`primary-button${scenarioCreating ? " is-pending" : ""}`} onClick={() => void createScenario()} disabled={scenarioCreating || scenarioName.trim().length < 3}>{scenarioCreating ? "Creating…" : "Create and open"}</button>
          </div>
        </section>
      </div> : null}
    </main>
  );
}
