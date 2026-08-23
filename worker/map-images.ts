import {
  hydrateMapPackage,
  mapSetupFromPackage,
  parseMapPackage,
  parseMapSetup,
  type MapImage,
  type MapPackage,
} from "../shared/map-package.ts";
import type { MapImageRow } from "./types.ts";

const BIOMES = new Set<MapImage["biome"]>(["forest", "dungeon", "cave", "ruins", "swamp", "desert", "tundra", "volcanic", "coast"]);
const MOODS = new Set<MapImage["mood"]>(["daylight", "overcast", "moonlight", "torchlight"]);
const SOURCES = new Set<MapImage["sourceKind"]>(["built-in", "generated", "imported"]);

export function mapImageFromRow(row: MapImageRow): MapImage | null {
  const biome = row.biome as MapImage["biome"];
  const mood = row.mood as MapImage["mood"];
  const sourceKind = row.source_kind as MapImage["sourceKind"];
  if (!BIOMES.has(biome) || !MOODS.has(mood) || !SOURCES.has(sourceKind)) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    biome,
    mood,
    assetPath: row.asset_path,
    gridWidth: row.grid_width,
    gridHeight: row.grid_height,
    pixelWidth: row.pixel_width,
    pixelHeight: row.pixel_height,
    sourceKind,
    sourcePrompt: row.source_prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    active: Boolean(row.is_active),
  };
}

export function hydrateStoredMap(imageRow: MapImageRow | null, setupJson: string | null): MapPackage | null {
  const image = imageRow ? mapImageFromRow(imageRow) : null;
  if (!image || !setupJson) return null;
  try {
    const setup = parseMapSetup(JSON.parse(setupJson), image.gridWidth, image.gridHeight);
    return setup ? hydrateMapPackage(image, setup) : null;
  } catch {
    return null;
  }
}

export function serializedMapSetup(map: MapPackage): string {
  return JSON.stringify(mapSetupFromPackage(map));
}

export function legacyMapPackage(value: string | null): MapPackage | null {
  if (!value) return null;
  try {
    return parseMapPackage(JSON.parse(value));
  } catch {
    return null;
  }
}
