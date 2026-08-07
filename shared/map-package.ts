export type MapBiome = "forest" | "dungeon" | "cave" | "ruins" | "swamp" | "desert" | "tundra" | "volcanic" | "coast";
export type MapMood = "daylight" | "overcast" | "moonlight" | "torchlight";
export type MapRotation = 0 | 90 | 180 | 270;

export type FullSceneVisual = {
  kind: "generated-scene";
  assetUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  sceneKitId: string;
};

export type PlacedSceneObject = {
  id: string;
  definitionId: string;
  assetUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: MapRotation;
};

export type WallSegment = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  style: "stone" | "cave" | "ruined";
};

export type Portal = {
  id: string;
  x: number;
  y: number;
  orientation: "horizontal" | "vertical";
  kind: "door" | "window";
  open: boolean;
};

export type MapLabel = {
  id: string;
  x: number;
  y: number;
  text: string;
  visibility: "dm" | "everyone";
};

export type MapNote = {
  id: string;
  x: number;
  y: number;
  text: string;
};

export type MapPackage = {
  format: "dnd-battle-map";
  version: 1;
  id: string;
  name: string;
  description: string;
  biome: MapBiome;
  mood: MapMood;
  seed: string;
  width: number;
  height: number;
  visual: FullSceneVisual;
  sceneObjects: PlacedSceneObject[];
  walls: WallSegment[];
  portals: Portal[];
  labels: MapLabel[];
  notes: MapNote[];
  source: { kind: "generated-scene" | "imported" };
  createdAt: number;
};

const BIOMES = new Set<MapBiome>(["forest", "dungeon", "cave", "ruins", "swamp", "desert", "tundra", "volcanic", "coast"]);
const MOODS = new Set<MapMood>(["daylight", "overcast", "moonlight", "torchlight"]);
const ROTATIONS = new Set<MapRotation>([0, 90, 180, 270]);
const MAX_PACKAGE_BYTES = 200_000;
const MAX_ITEMS = 500;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function text(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.length <= maximum ? value : null;
}

function mapAssetPath(value: unknown): string | null {
  const path = text(value, 240);
  return path && /^\/map-assets\/[a-z0-9/_-]+\.(?:jpg|png)$/i.test(path) ? path : null;
}

function array(value: unknown): unknown[] | null {
  return Array.isArray(value) && value.length <= MAX_ITEMS ? value : null;
}

function parseSceneObject(value: unknown, width: number, height: number): PlacedSceneObject | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.id, 96);
  const definitionId = text(item.definitionId, 96);
  const assetUrl = mapAssetPath(item.assetUrl);
  const x = finite(item.x, 0, width);
  const y = finite(item.y, 0, height);
  const itemWidth = finite(item.width, 0.25, width);
  const itemHeight = finite(item.height, 0.25, height);
  const rotation = item.rotation as MapRotation;
  if (!id || !definitionId || !assetUrl || x === null || y === null || itemWidth === null || itemHeight === null || !ROTATIONS.has(rotation)) return null;
  return { id, definitionId, assetUrl, x, y, width: itemWidth, height: itemHeight, rotation };
}

function parseWall(value: unknown, width: number, height: number): WallSegment | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.id, 96);
  const x1 = finite(item.x1, 0, width); const y1 = finite(item.y1, 0, height);
  const x2 = finite(item.x2, 0, width); const y2 = finite(item.y2, 0, height);
  const style = item.style;
  if (!id || x1 === null || y1 === null || x2 === null || y2 === null || (style !== "stone" && style !== "cave" && style !== "ruined")) return null;
  return { id, x1, y1, x2, y2, style };
}

function parsePortal(value: unknown, width: number, height: number): Portal | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.id, 96); const x = finite(item.x, 0, width); const y = finite(item.y, 0, height);
  const orientation = item.orientation; const kind = item.kind;
  if (!id || x === null || y === null || (orientation !== "horizontal" && orientation !== "vertical") || (kind !== "door" && kind !== "window") || typeof item.open !== "boolean") return null;
  return { id, x, y, orientation, kind, open: item.open };
}

function parseLabel(value: unknown, width: number, height: number): MapLabel | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.id, 96); const x = finite(item.x, 0, width); const y = finite(item.y, 0, height); const label = text(item.text, 120);
  const visibility = item.visibility;
  if (!id || x === null || y === null || label === null || (visibility !== "dm" && visibility !== "everyone")) return null;
  return { id, x, y, text: label, visibility };
}

function parseNote(value: unknown, width: number, height: number): MapNote | null {
  const item = record(value);
  if (!item) return null;
  const id = text(item.id, 96); const x = finite(item.x, 0, width); const y = finite(item.y, 0, height); const note = text(item.text, 500);
  return id && x !== null && y !== null && note !== null ? { id, x, y, text: note } : null;
}

function parsedList<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  const values = array(value);
  if (!values) return null;
  const parsed = values.map(parse);
  return parsed.every((item): item is T => item !== null) ? parsed : null;
}

export function parseMapPackage(value: unknown): MapPackage | null {
  try {
    if (JSON.stringify(value).length > MAX_PACKAGE_BYTES) return null;
  } catch { return null; }
  const item = record(value);
  if (!item || item.format !== "dnd-battle-map" || item.version !== 1) return null;
  const id = text(item.id, 96); const name = text(item.name, 100); const description = text(item.description, 500); const seed = text(item.seed, 100);
  const width = finite(item.width, 8, 48); const height = finite(item.height, 8, 48);
  const biome = item.biome as MapBiome; const mood = item.mood as MapMood;
  const createdAt = finite(item.createdAt, 0, Number.MAX_SAFE_INTEGER);
  const visualValue = record(item.visual); const sourceValue = record(item.source);
  if (!id || !name || description === null || seed === null || width === null || height === null || createdAt === null || !BIOMES.has(biome) || !MOODS.has(mood) || !visualValue || visualValue.kind !== "generated-scene" || !sourceValue) return null;
  const assetUrl = mapAssetPath(visualValue.assetUrl); const pixelWidth = finite(visualValue.pixelWidth, 512, 8192); const pixelHeight = finite(visualValue.pixelHeight, 512, 8192); const sceneKitId = text(visualValue.sceneKitId, 96);
  const sourceKind = sourceValue.kind;
  if (!assetUrl || pixelWidth === null || pixelHeight === null || !sceneKitId || (sourceKind !== "generated-scene" && sourceKind !== "imported")) return null;
  const sceneObjects = parsedList(item.sceneObjects, (entry) => parseSceneObject(entry, width, height));
  const walls = parsedList(item.walls, (entry) => parseWall(entry, width, height));
  const portals = parsedList(item.portals, (entry) => parsePortal(entry, width, height));
  const labels = parsedList(item.labels, (entry) => parseLabel(entry, width, height));
  const notes = parsedList(item.notes, (entry) => parseNote(entry, width, height));
  if (!sceneObjects || !walls || !portals || !labels || !notes) return null;
  return {
    format: "dnd-battle-map", version: 1, id, name, description, biome, mood, seed, width, height,
    visual: { kind: "generated-scene", assetUrl, pixelWidth, pixelHeight, sceneKitId },
    sceneObjects, walls, portals, labels, notes, source: { kind: sourceKind }, createdAt,
  };
}

export function cloneMapPackage(map: MapPackage): MapPackage {
  return JSON.parse(JSON.stringify(map)) as MapPackage;
}
