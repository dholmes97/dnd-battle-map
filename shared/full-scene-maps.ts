import type { MapBiome, MapPackage } from "./map-package.ts";

export type SceneKitDefinition = {
  id: string;
  name: string;
  description: string;
  assetUrl: string;
  width: number;
  height: number;
};

type FullSceneDefinition = {
  id: string;
  name: string;
  description: string;
  biome: MapBiome;
  mood: MapPackage["mood"];
  assetUrl: string;
  sceneKitId: string;
};

export const FULL_SCENE_MAPS: FullSceneDefinition[] = [
  {
    id: "ancient-forest-clearing-v2",
    name: "Ancient Forest Crossing",
    description: "An old-growth woodland crossing with a mossy ruin, pond, trails, and open tactical ground.",
    biome: "forest",
    mood: "daylight",
    assetUrl: "/map-assets/ancient-forest-clearing-02.jpg",
    sceneKitId: "ancient-forest",
  },
  {
    id: "ruined-underground-temple-v2",
    name: "Flooded Temple Ruin",
    description: "A torchlit underground temple with side chambers, broken masonry, and a flooded lower edge.",
    biome: "dungeon",
    mood: "torchlight",
    assetUrl: "/map-assets/ruined-underground-temple-02.jpg",
    sceneKitId: "underground-temple",
  },
  {
    id: "storm-coast-ruins-v2",
    name: "Storm Coast Ruins",
    description: "A wave-battered island ruin with tide pools, a broken causeway, and multiple approach routes.",
    biome: "coast",
    mood: "overcast",
    assetUrl: "/map-assets/storm-coast-ruins-02.jpg",
    sceneKitId: "storm-coast",
  },
];

export const SCENE_KITS: Record<string, SceneKitDefinition[]> = {
  "ancient-forest": [
    { id: "forest-log", name: "Mossy fallen log", description: "A forest-floor obstacle matched to this scene.", assetUrl: "/map-assets/scene-kits/forest-log.png", width: 5, height: 5 },
    { id: "forest-rocks", name: "Fern boulders", description: "Mossy stones and ferns matched to this scene.", assetUrl: "/map-assets/scene-kits/forest-rocks.png", width: 5, height: 5 },
  ],
  "underground-temple": [
    { id: "temple-debris", name: "Carved rubble", description: "Broken temple stone matched to this scene.", assetUrl: "/map-assets/scene-kits/temple-debris.png", width: 5, height: 5 },
    { id: "temple-table", name: "Overturned ritual table", description: "A damaged furnishing matched to this scene.", assetUrl: "/map-assets/scene-kits/temple-table.png", width: 5, height: 5 },
  ],
  "storm-coast": [
    { id: "coast-boat", name: "Wrecked rowboat", description: "A wet wreck matched to this scene.", assetUrl: "/map-assets/scene-kits/coast-boat.png", width: 6, height: 6 },
    { id: "coast-barricade", name: "Broken sea wall", description: "Stone and driftwood matched to this scene.", assetUrl: "/map-assets/scene-kits/coast-barricade.png", width: 6, height: 6 },
  ],
};

export function createFullSceneMap(definition: FullSceneDefinition): MapPackage {
  const width = 24;
  const height = 16;
  return {
    format: "dnd-battle-map",
    version: 1,
    id: definition.id,
    name: definition.name,
    description: definition.description,
    biome: definition.biome,
    mood: definition.mood,
    seed: definition.id.toUpperCase(),
    width,
    height,
    walls: [],
    portals: [],
    labels: [],
    notes: [],
    visual: {
      kind: "generated-scene",
      assetUrl: definition.assetUrl,
      pixelWidth: 3072,
      pixelHeight: 2048,
      sceneKitId: definition.sceneKitId,
    },
    sceneObjects: [],
    source: { kind: "generated-scene" },
    createdAt: Date.now(),
  };
}
