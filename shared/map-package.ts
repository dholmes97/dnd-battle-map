export type MapBiome = "forest" | "dungeon" | "cave" | "ruins" | "swamp" | "desert" | "tundra" | "volcanic" | "coast";
export type MapSize = "scouting" | "standard" | "expansive";
export type MapDensity = "open" | "balanced" | "dense";
export type PathStyle = "none" | "direct" | "winding";
export type WaterFeature = "none" | "pond" | "stream";
export type MapMood = "daylight" | "overcast" | "moonlight" | "torchlight";
export type TerrainKind = "grass" | "earth" | "water" | "stone" | "cave" | "rubble" | "mud" | "sand" | "snow" | "ash" | "lava";
export type StampCategory = "nature" | "structure" | "hazard" | "furnishing" | "detail";
export type StampRenderKind = "image" | "stones" | "ruin" | "bones" | "stalagmites" | "campfire" | "bridge" | "crypt" | "thicket" | "supplies" | "altar" | "bars" | "mushrooms" | "fountain" | "cart" | "pit" | "rune" | "dunes" | "ice" | "lava" | "wreck";
export type Cell = { x: number; y: number };
export type MapRotation = 0 | 90 | 180 | 270;
export type StampAssetSet = readonly [string, string, string, string, string];

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

export type StampDefinition = {
  id: string;
  name: string;
  assets: StampAssetSet;
  rotationMode: "orthogonal" | "fixed";
  width: number;
  height: number;
  mask: Cell[];
  description: string;
  category: StampCategory;
  biomes: MapBiome[];
  renderKind: StampRenderKind;
};

export type PlacedStamp = {
  id: string;
  definitionId: string;
  x: number;
  y: number;
  rotation: MapRotation;
  flipX?: boolean;
  variant?: number;
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
  terrain: TerrainKind[];
  stamps: PlacedStamp[];
  walls: WallSegment[];
  portals: Portal[];
  labels: MapLabel[];
  notes: MapNote[];
  visual?: FullSceneVisual;
  sceneObjects?: PlacedSceneObject[];
  source: {
    kind: "procedural" | "prompt" | "imported" | "generated-scene";
    prompt?: string;
  };
  createdAt: number;
};

export type GeneratorSettings = {
  biome: MapBiome;
  size: MapSize;
  density: MapDensity;
  pathStyle: PathStyle;
  water: WaterFeature;
  landmarks: number;
  mood: MapMood;
  seed: string;
  name?: string;
};

export type PromptComposition = {
  settings: GeneratorSettings;
  detectedFeatures: string[];
  map: MapPackage;
};

export const MAP_SIZES: Record<MapSize, { width: number; height: number; label: string }> = {
  scouting: { width: 16, height: 11, label: "Scouting · 16 × 11" },
  standard: { width: 24, height: 16, label: "Standard · 24 × 16" },
  expansive: { width: 32, height: 22, label: "Expansive · 32 × 22" },
};

export const TERRAIN_ASSETS: Record<TerrainKind, string> = {
  grass: "/assets/terrain/terrain-meadow-grass-01.png",
  earth: "/assets/terrain/terrain-packed-earth-01.png",
  water: "/assets/terrain/terrain-shallow-water-01.png",
  stone: "/assets/terrain/terrain-dungeon-flagstone-01.png",
  cave: "/assets/terrain/terrain-cave-floor-01.png",
  rubble: "/assets/terrain/terrain-rubble-01.png",
  mud: "/assets/terrain/terrain-swamp-mud-01.png",
  sand: "/assets/terrain/terrain-desert-sand-01.png",
  snow: "/assets/terrain/terrain-tundra-snow-01.png",
  ash: "/assets/terrain/terrain-volcanic-ash-01.png",
  lava: "/assets/terrain/terrain-lava-crust-01.png",
};

export const TERRAIN_LABELS: Record<TerrainKind, string> = {
  grass: "Meadow",
  earth: "Packed earth",
  water: "Shallow water",
  stone: "Flagstone",
  cave: "Cave floor",
  rubble: "Broken stone",
  mud: "Mud",
  sand: "Sand",
  snow: "Snow and ice",
  ash: "Volcanic ash",
  lava: "Lava crust",
};

export function baseTerrainForBiome(biome: MapBiome): TerrainKind {
  if (biome === "dungeon") return "stone";
  if (biome === "cave") return "cave";
  if (biome === "swamp") return "mud";
  if (biome === "desert" || biome === "coast") return "sand";
  if (biome === "tundra") return "snow";
  if (biome === "volcanic") return "ash";
  return "grass";
}

const rectangleMask = (width: number, height: number): Cell[] =>
  Array.from({ length: width * height }, (_, index) => ({ x: index % width, y: Math.floor(index / width) }));

const stampAssets = (stem: string, firstStem = stem): StampAssetSet => [
  `/assets/map-stamps/${firstStem}-01.png`,
  `/assets/map-stamps/${stem}-02.png`,
  `/assets/map-stamps/${stem}-03.png`,
  `/assets/map-stamps/${stem}-04.png`,
  `/assets/map-stamps/${stem}-05.png`,
];

export const STAMP_LIBRARY: StampDefinition[] = [
  {
    id: "ancient-oak",
    name: "Ancient oak",
    assets: stampAssets("ancient-oak", "forest-ancient-oak"),
    rotationMode: "fixed",
    width: 5,
    height: 5,
    mask: [
      { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
      { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 },
      { x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 },
    ],
    description: "A broad old-growth landmark with an irregular canopy footprint.",
    category: "nature",
    biomes: ["forest", "ruins", "swamp"],
    renderKind: "image",
  },
  {
    id: "l-grove",
    name: "L-shaped grove",
    assets: stampAssets("l-grove", "forest-l-grove"),
    rotationMode: "orthogonal",
    width: 5,
    height: 4,
    mask: [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
      { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 },
    ],
    description: "Dense trees with a two-by-two open notch for interlocking layouts.",
    category: "nature",
    biomes: ["forest", "ruins", "swamp"],
    renderKind: "image",
  },
  {
    id: "fallen-log",
    name: "Fallen log & stones",
    assets: stampAssets("fallen-log", "forest-fallen-log"),
    rotationMode: "orthogonal",
    width: 4,
    height: 2,
    mask: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
    description: "A long natural obstacle with open corner cells.",
    category: "nature",
    biomes: ["forest", "ruins", "swamp"],
    renderKind: "image",
  },
  {
    id: "standing-stones",
    name: "Standing-stone ring",
    assets: stampAssets("standing-stones"),
    rotationMode: "fixed",
    width: 4,
    height: 4,
    mask: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 1, y: 3 }, { x: 0, y: 2 }, { x: 0, y: 1 }],
    description: "An open-centered ritual ring that leaves playable space inside.",
    category: "structure",
    biomes: ["forest", "ruins", "swamp", "desert", "tundra", "volcanic", "coast"],
    renderKind: "stones",
  },
  {
    id: "ruined-l-wall",
    name: "Ruined L-wall",
    assets: stampAssets("ruined-l-wall"),
    rotationMode: "orthogonal",
    width: 5,
    height: 4,
    mask: [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
      { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }, { x: 1, y: 3 },
    ],
    description: "A broken wall corner with gaps and low rubble along its footprint.",
    category: "structure",
    biomes: ["ruins", "forest", "dungeon", "desert", "tundra", "volcanic", "coast"],
    renderKind: "ruin",
  },
  {
    id: "bone-scatter",
    name: "Bone scatter",
    assets: stampAssets("bone-scatter"),
    rotationMode: "fixed",
    width: 3,
    height: 2,
    mask: rectangleMask(3, 2),
    description: "Loose bones and skull fragments for lairs, crypts, and ominous trails.",
    category: "detail",
    biomes: ["cave", "dungeon", "ruins", "desert", "tundra", "volcanic", "coast", "swamp"],
    renderKind: "bones",
  },
  {
    id: "cave-bone-lair",
    name: "Bone-strewn lair",
    assets: stampAssets("cave-bone-lair"),
    rotationMode: "fixed",
    width: 5,
    height: 3,
    mask: [
      { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 },
    ],
    description: "A large irregular trophy-and-remains scatter for a creature lair.",
    category: "detail",
    biomes: ["cave", "dungeon", "ruins"],
    renderKind: "image",
  },
  {
    id: "stalagmite-cluster",
    name: "Stalagmite cluster",
    assets: stampAssets("stalagmite-cluster"),
    rotationMode: "fixed",
    width: 3,
    height: 3,
    mask: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
    description: "A jagged, irregular cave obstacle with narrow gaps around it.",
    category: "nature",
    biomes: ["cave"],
    renderKind: "stalagmites",
  },
  {
    id: "campfire",
    name: "Campfire",
    assets: stampAssets("campfire"),
    rotationMode: "fixed",
    width: 2,
    height: 2,
    mask: rectangleMask(2, 2),
    description: "A compact lit campsite anchor.",
    category: "furnishing",
    biomes: ["forest", "cave", "ruins", "dungeon", "swamp", "desert", "tundra", "volcanic", "coast"],
    renderKind: "campfire",
  },
  {
    id: "rope-bridge",
    name: "Rope bridge",
    assets: stampAssets("rope-bridge"),
    rotationMode: "orthogonal",
    width: 6,
    height: 2,
    mask: rectangleMask(6, 2),
    description: "A long crossing piece suited to streams and cave gaps.",
    category: "structure",
    biomes: ["forest", "cave", "ruins", "swamp", "tundra", "volcanic", "coast"],
    renderKind: "bridge",
  },
  {
    id: "stone-crypt",
    name: "Stone crypt",
    assets: stampAssets("stone-crypt"),
    rotationMode: "orthogonal",
    width: 4,
    height: 3,
    mask: rectangleMask(4, 3),
    description: "A substantial tomb or sealed stone chamber.",
    category: "structure",
    biomes: ["dungeon", "ruins"],
    renderKind: "crypt",
  },
  {
    id: "ruined-moon-shrine",
    name: "Ruined moon shrine",
    assets: stampAssets("ruined-moon-shrine"),
    rotationMode: "fixed",
    width: 6,
    height: 5,
    mask: [
      { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 },
      { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 },
      { x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 },
    ],
    description: "A crescent dais, broken altar, and fallen columns with playable gaps.",
    category: "structure",
    biomes: ["ruins"],
    renderKind: "image",
  },
  {
    id: "boulder-outcrop",
    name: "Boulder outcrop",
    assets: stampAssets("boulder-outcrop"),
    rotationMode: "fixed",
    width: 4,
    height: 3,
    mask: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
    description: "A broad natural rock formation with an uneven footprint.",
    category: "nature",
    biomes: ["forest", "cave", "ruins", "swamp", "desert", "tundra", "volcanic", "coast"],
    renderKind: "stones",
  },
  {
    id: "thorn-thicket",
    name: "Thorn thicket",
    assets: stampAssets("thorn-thicket"),
    rotationMode: "fixed",
    width: 4,
    height: 3,
    mask: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
    description: "Low tangled vegetation that blocks sight without reading as another tree canopy.",
    category: "nature",
    biomes: ["forest", "ruins", "swamp"],
    renderKind: "thicket",
  },
  {
    id: "crates-and-barrels",
    name: "Crates & barrels",
    assets: stampAssets("crates-and-barrels"),
    rotationMode: "fixed",
    width: 3,
    height: 2,
    mask: rectangleMask(3, 2),
    description: "A compact supply cache for rooms, camps, and ambush cover.",
    category: "furnishing",
    biomes: ["dungeon", "cave", "ruins", "forest", "swamp", "desert", "tundra", "volcanic", "coast"],
    renderKind: "supplies",
  },
  {
    id: "stone-altar",
    name: "Stone altar",
    assets: stampAssets("stone-altar"),
    rotationMode: "orthogonal",
    width: 3,
    height: 2,
    mask: rectangleMask(3, 2),
    description: "A small ritual focus suitable for temples, crypts, and hidden caves.",
    category: "furnishing",
    biomes: ["dungeon", "cave", "ruins", "swamp", "desert", "tundra", "volcanic", "coast"],
    renderKind: "altar",
  },
  {
    id: "prison-bars",
    name: "Prison bars",
    assets: stampAssets("prison-bars"),
    rotationMode: "orthogonal",
    width: 4,
    height: 1,
    mask: rectangleMask(4, 1),
    description: "A straight barred partition that can rotate across a corridor.",
    category: "structure",
    biomes: ["dungeon", "ruins"],
    renderKind: "bars",
  },
  {
    id: "glow-mushrooms",
    name: "Glow mushrooms",
    assets: stampAssets("glow-mushrooms"),
    rotationMode: "fixed",
    width: 3,
    height: 2,
    mask: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
    description: "A sparse bioluminescent cave detail with open cells around the caps.",
    category: "detail",
    biomes: ["cave", "swamp"],
    renderKind: "mushrooms",
  },
  {
    id: "broken-fountain",
    name: "Broken fountain",
    assets: stampAssets("broken-fountain"),
    rotationMode: "fixed",
    width: 4,
    height: 4,
    mask: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 3 }],
    description: "A circular civic ruin with chipped basin stones and stagnant water.",
    category: "structure",
    biomes: ["ruins", "dungeon", "desert", "coast"],
    renderKind: "fountain",
  },
  {
    id: "abandoned-cart",
    name: "Abandoned cart",
    assets: stampAssets("abandoned-cart"),
    rotationMode: "orthogonal",
    width: 4,
    height: 2,
    mask: rectangleMask(4, 2),
    description: "A broken wagon obstacle for roads, supply rooms, and ruined approaches.",
    category: "furnishing",
    biomes: ["forest", "ruins", "dungeon", "desert", "tundra", "coast"],
    renderKind: "cart",
  },
  {
    id: "spike-pit",
    name: "Spike pit",
    assets: stampAssets("spike-pit"),
    rotationMode: "fixed",
    width: 3,
    height: 3,
    mask: rectangleMask(3, 3),
    description: "A readable open hazard with a dark rim and wooden spikes.",
    category: "hazard",
    biomes: ["dungeon", "cave", "ruins", "desert", "tundra", "volcanic"],
    renderKind: "pit",
  },
  {
    id: "warding-rune",
    name: "Warding rune",
    assets: stampAssets("warding-rune"),
    rotationMode: "fixed",
    width: 2,
    height: 2,
    mask: rectangleMask(2, 2),
    description: "A faint magical floor mark for traps, seals, and ritual thresholds.",
    category: "hazard",
    biomes: ["dungeon", "cave", "ruins", "forest", "swamp", "desert", "tundra", "volcanic", "coast"],
    renderKind: "rune",
  },
  {
    id: "twisted-mangroves",
    name: "Twisted mangroves",
    assets: stampAssets("twisted-mangroves"),
    rotationMode: "fixed",
    width: 5,
    height: 4,
    mask: [{ x: 1, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 1, y: 3 }, { x: 3, y: 3 }],
    description: "Gnarled wetland trees and exposed roots forming irregular channels.",
    category: "nature",
    biomes: ["swamp", "coast"],
    renderKind: "thicket",
  },
  {
    id: "reed-bed",
    name: "Reed bed",
    assets: stampAssets("reed-bed"),
    rotationMode: "fixed",
    width: 4,
    height: 3,
    mask: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }],
    description: "Dense marsh reeds with narrow playable openings between clumps.",
    category: "nature",
    biomes: ["swamp", "coast"],
    renderKind: "thicket",
  },
  {
    id: "wind-carved-dunes",
    name: "Wind-carved dunes",
    assets: stampAssets("wind-carved-dunes"),
    rotationMode: "fixed",
    width: 5,
    height: 3,
    mask: rectangleMask(5, 3),
    description: "Overlapping sand ridges that break up an otherwise open battlefield.",
    category: "nature",
    biomes: ["desert", "coast"],
    renderKind: "dunes",
  },
  {
    id: "ice-spires",
    name: "Ice spires",
    assets: stampAssets("ice-spires"),
    rotationMode: "fixed",
    width: 4,
    height: 3,
    mask: [{ x: 1, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 0, y: 2 }, { x: 2, y: 2 }],
    description: "Jagged translucent ice formations with irregular sight-line gaps.",
    category: "nature",
    biomes: ["tundra", "cave"],
    renderKind: "ice",
  },
  {
    id: "lava-vent",
    name: "Lava vent",
    assets: stampAssets("lava-vent"),
    rotationMode: "fixed",
    width: 3,
    height: 3,
    mask: rectangleMask(3, 3),
    description: "A cracked volcanic vent with a visible molten center.",
    category: "hazard",
    biomes: ["volcanic", "cave"],
    renderKind: "lava",
  },
  {
    id: "coastal-wreck",
    name: "Coastal wreck",
    assets: stampAssets("coastal-wreck"),
    rotationMode: "orthogonal",
    width: 6,
    height: 3,
    mask: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 4, y: 2 }],
    description: "Broken ribs, decking, and mast fragments from a beached vessel.",
    category: "structure",
    biomes: ["coast", "swamp"],
    renderKind: "wreck",
  },
  {
    id: "pine-cluster",
    name: "Pine cluster",
    assets: stampAssets("pine-cluster"),
    rotationMode: "fixed",
    width: 4,
    height: 4,
    mask: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 3 }],
    description: "A compact evergreen stand with layered, irregular crowns.",
    category: "nature",
    biomes: ["forest", "tundra"],
    renderKind: "image",
  },
  {
    id: "birch-grove",
    name: "Birch grove",
    assets: stampAssets("birch-grove"),
    rotationMode: "fixed",
    width: 5,
    height: 4,
    mask: [{ x: 1, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 1, y: 3 }, { x: 3, y: 3 }],
    description: "A loose pale-barked grove with playable gaps between canopies.",
    category: "nature",
    biomes: ["forest", "tundra"],
    renderKind: "image",
  },
  {
    id: "tree-stump",
    name: "Tree stump",
    assets: stampAssets("tree-stump"),
    rotationMode: "fixed",
    width: 2,
    height: 2,
    mask: rectangleMask(2, 2),
    description: "A broad weathered stump, exposed roots, and small forest debris.",
    category: "nature",
    biomes: ["forest", "ruins", "swamp"],
    renderKind: "image",
  },
  {
    id: "shrub-cluster",
    name: "Shrub cluster",
    assets: stampAssets("shrub-cluster"),
    rotationMode: "fixed",
    width: 3,
    height: 2,
    mask: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
    description: "Low mixed shrubs for soft cover and varied forest edges.",
    category: "nature",
    biomes: ["forest", "ruins", "swamp", "coast"],
    renderKind: "image",
  },
  {
    id: "fern-patch",
    name: "Fern patch",
    assets: stampAssets("fern-patch"),
    rotationMode: "fixed",
    width: 3,
    height: 2,
    mask: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
    description: "A low understory patch with several distinct fern crowns.",
    category: "detail",
    biomes: ["forest", "swamp", "coast"],
    renderKind: "image",
  },
  {
    id: "rock-pile",
    name: "Rock pile",
    assets: stampAssets("rock-pile"),
    rotationMode: "fixed",
    width: 3,
    height: 2,
    mask: rectangleMask(3, 2),
    description: "A compact mound of hand-sized and medium fieldstones.",
    category: "nature",
    biomes: ["forest", "cave", "ruins", "swamp", "desert", "tundra", "volcanic", "coast"],
    renderKind: "image",
  },
  {
    id: "pebble-scatter",
    name: "Pebble scatter",
    assets: stampAssets("pebble-scatter"),
    rotationMode: "fixed",
    width: 3,
    height: 2,
    mask: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }],
    description: "Sparse stones that add texture without creating a major obstacle.",
    category: "detail",
    biomes: ["forest", "cave", "ruins", "swamp", "desert", "tundra", "volcanic", "coast"],
    renderKind: "image",
  },
  {
    id: "dead-tree",
    name: "Dead tree",
    assets: stampAssets("dead-tree"),
    rotationMode: "fixed",
    width: 4,
    height: 4,
    mask: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 3 }],
    description: "A leafless snag with a broad root flare and broken limbs.",
    category: "nature",
    biomes: ["forest", "ruins", "swamp", "desert", "tundra", "volcanic"],
    renderKind: "image",
  },
  {
    id: "wooden-table",
    name: "Wooden table",
    assets: stampAssets("wooden-table"),
    rotationMode: "orthogonal",
    width: 3,
    height: 2,
    mask: rectangleMask(3, 2),
    description: "A sturdy scarred table with sparse room-specific clutter.",
    category: "furnishing",
    biomes: ["dungeon", "cave", "ruins", "forest", "coast"],
    renderKind: "image",
  },
  {
    id: "bedroll-camp",
    name: "Bedroll camp",
    assets: stampAssets("bedroll-camp"),
    rotationMode: "fixed",
    width: 3,
    height: 3,
    mask: rectangleMask(3, 3),
    description: "A small resting camp with bedrolls, packs, and cookware.",
    category: "furnishing",
    biomes: ["forest", "cave", "ruins", "dungeon", "swamp", "desert", "tundra", "coast"],
    renderKind: "image",
  },
  {
    id: "weapon-rack",
    name: "Weapon rack",
    assets: stampAssets("weapon-rack"),
    rotationMode: "orthogonal",
    width: 3,
    height: 1,
    mask: rectangleMask(3, 1),
    description: "A long low rack of assorted mundane arms and shields.",
    category: "furnishing",
    biomes: ["dungeon", "ruins"],
    renderKind: "image",
  },
  {
    id: "bookshelf",
    name: "Bookshelf",
    assets: stampAssets("bookshelf"),
    rotationMode: "orthogonal",
    width: 4,
    height: 1,
    mask: rectangleMask(4, 1),
    description: "A long bookcase seen from above, with varied books and scrolls.",
    category: "furnishing",
    biomes: ["dungeon", "ruins"],
    renderKind: "image",
  },
  {
    id: "treasure-chest",
    name: "Treasure chest",
    assets: stampAssets("treasure-chest"),
    rotationMode: "orthogonal",
    width: 2,
    height: 1,
    mask: rectangleMask(2, 1),
    description: "A reinforced chest with distinct wear, lock, and trim variations.",
    category: "furnishing",
    biomes: ["dungeon", "cave", "ruins", "forest", "swamp", "desert", "tundra", "volcanic", "coast"],
    renderKind: "image",
  },
  {
    id: "rubble-heap",
    name: "Rubble heap",
    assets: stampAssets("rubble-heap"),
    rotationMode: "fixed",
    width: 4,
    height: 3,
    mask: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
    description: "Collapsed masonry, fractured beams, and irregular broken stone.",
    category: "structure",
    biomes: ["dungeon", "ruins", "cave", "desert", "volcanic", "coast"],
    renderKind: "image",
  },
  {
    id: "dungeon-column",
    name: "Dungeon column",
    assets: stampAssets("dungeon-column"),
    rotationMode: "fixed",
    width: 2,
    height: 2,
    mask: rectangleMask(2, 2),
    description: "A substantial carved pillar or column base viewed from above.",
    category: "structure",
    biomes: ["dungeon", "ruins"],
    renderKind: "image",
  },
  {
    id: "ruined-arch",
    name: "Ruined arch",
    assets: stampAssets("ruined-arch"),
    rotationMode: "orthogonal",
    width: 4,
    height: 2,
    mask: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
    description: "A broken freestanding stone arch with a passable center.",
    category: "structure",
    biomes: ["ruins", "dungeon", "desert", "coast"],
    renderKind: "image",
  },
  {
    id: "stone-statue",
    name: "Stone statue",
    assets: stampAssets("stone-statue"),
    rotationMode: "fixed",
    width: 2,
    height: 2,
    mask: rectangleMask(2, 2),
    description: "A weathered figure on a square plinth with varied subjects.",
    category: "structure",
    biomes: ["dungeon", "ruins", "forest", "desert", "coast"],
    renderKind: "image",
  },
  {
    id: "old-well",
    name: "Old well",
    assets: stampAssets("old-well"),
    rotationMode: "fixed",
    width: 3,
    height: 3,
    mask: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
    description: "A round stone well with different rims, ropes, and covers.",
    category: "structure",
    biomes: ["forest", "ruins", "dungeon", "swamp", "desert", "coast"],
    renderKind: "image",
  },
  {
    id: "grave-markers",
    name: "Grave markers",
    assets: stampAssets("grave-markers"),
    rotationMode: "fixed",
    width: 4,
    height: 3,
    mask: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 0, y: 2 }, { x: 2, y: 2 }],
    description: "A scattered cluster of worn headstones and small grave slabs.",
    category: "detail",
    biomes: ["ruins", "forest", "swamp", "dungeon"],
    renderKind: "image",
  },
  {
    id: "brazier",
    name: "Brazier",
    assets: stampAssets("brazier"),
    rotationMode: "fixed",
    width: 2,
    height: 2,
    mask: rectangleMask(2, 2),
    description: "A metal fire bowl with varied stands, coals, and flame shapes.",
    category: "furnishing",
    biomes: ["dungeon", "ruins", "cave", "desert", "volcanic"],
    renderKind: "image",
  },
  {
    id: "cactus-cluster",
    name: "Cactus cluster",
    assets: stampAssets("cactus-cluster"),
    rotationMode: "fixed",
    width: 3,
    height: 3,
    mask: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
    description: "A desert plant cluster with several distinct silhouettes.",
    category: "nature",
    biomes: ["desert"],
    renderKind: "image",
  },
  {
    id: "snow-drift",
    name: "Snow drift",
    assets: stampAssets("snow-drift"),
    rotationMode: "fixed",
    width: 4,
    height: 2,
    mask: rectangleMask(4, 2),
    description: "An irregular wind-packed snow bank with a soft readable edge.",
    category: "nature",
    biomes: ["tundra"],
    renderKind: "image",
  },
];

export function seedHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function randomFromSeed(seed: string) {
  let value = seedHash(seed) || 1;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function definitionFor(id: string) {
  return STAMP_LIBRARY.find((definition) => definition.id === id) ?? STAMP_LIBRARY[0];
}

export function stampVariantFor(definition: StampDefinition, seed: string, stampId: string, requested?: number) {
  if (Number.isInteger(requested) && requested! >= 0 && requested! < definition.assets.length) return requested!;
  return seedHash(`${seed}:${stampId}:${definition.id}:art`) % definition.assets.length;
}

export function stampAssetFor(definition: StampDefinition, seed: string, stampId: string, requested?: number) {
  return definition.assets[stampVariantFor(definition, seed, stampId, requested)];
}

export function effectiveStampRotation(definition: StampDefinition, rotation: MapRotation): MapRotation {
  return definition.rotationMode === "fixed" ? 0 : rotation;
}

export function rotatedMask(definition: StampDefinition, rotation: MapRotation) {
  rotation = effectiveStampRotation(definition, rotation);
  if (rotation === 0) return { width: definition.width, height: definition.height, cells: definition.mask };
  if (rotation === 90) return {
    width: definition.height,
    height: definition.width,
    cells: definition.mask.map((cell) => ({ x: definition.height - 1 - cell.y, y: cell.x })),
  };
  if (rotation === 180) return {
    width: definition.width,
    height: definition.height,
    cells: definition.mask.map((cell) => ({ x: definition.width - 1 - cell.x, y: definition.height - 1 - cell.y })),
  };
  return {
    width: definition.height,
    height: definition.width,
    cells: definition.mask.map((cell) => ({ x: cell.y, y: definition.width - 1 - cell.x })),
  };
}

export function terrainIndex(map: Pick<MapPackage, "width">, x: number, y: number) {
  return y * map.width + x;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function paintEllipse(map: MapPackage, kind: TerrainKind, centerX: number, centerY: number, radiusX: number, radiusY: number, roughness = 0) {
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const distance = ((x - centerX) ** 2) / Math.max(1, radiusX ** 2) + ((y - centerY) ** 2) / Math.max(1, radiusY ** 2);
      const wobble = roughness ? (seedHash(`${map.seed}:ellipse:${x}:${y}`) / 4294967295 - 0.5) * roughness : 0;
      if (distance + wobble < 1) map.terrain[terrainIndex(map, x, y)] = kind;
    }
  }
}

function paintPath(map: MapPackage, kind: TerrainKind, style: Exclude<PathStyle, "none">, random: () => number, width = 1) {
  let y = clamp(Math.floor(map.height * (0.3 + random() * 0.4)), 1, map.height - 2);
  for (let x = 0; x < map.width; x += 1) {
    if (style === "winding" && x > 1 && x < map.width - 2 && random() < 0.36) y = clamp(y + (random() < 0.5 ? -1 : 1), 1, map.height - 2);
    for (let offset = 0; offset < width; offset += 1) {
      const targetY = clamp(y + offset, 0, map.height - 1);
      map.terrain[terrainIndex(map, x, targetY)] = kind;
    }
  }
}

function paintStream(map: MapPackage, random: () => number) {
  let x = clamp(Math.floor(map.width * (0.25 + random() * 0.5)), 1, map.width - 2);
  for (let y = 0; y < map.height; y += 1) {
    if (y > 0 && y < map.height - 1 && random() < 0.48) x = clamp(x + (random() < 0.5 ? -1 : 1), 1, map.width - 2);
    map.terrain[terrainIndex(map, x, y)] = "water";
    if (random() < 0.54) map.terrain[terrainIndex(map, clamp(x + (random() < 0.5 ? -1 : 1), 0, map.width - 1), y)] = "water";
  }
}

function addWall(map: MapPackage, x1: number, y1: number, x2: number, y2: number, style: WallSegment["style"]) {
  map.walls.push({ id: `wall-${map.walls.length}-${seedHash(`${map.seed}:${x1}:${y1}:${x2}:${y2}`)}`, x1, y1, x2, y2, style });
}

function addRoom(map: MapPackage, x: number, y: number, width: number, height: number, style: WallSegment["style"], ruined = false) {
  addWall(map, x, y, x + width, y, style);
  addWall(map, x + width, y, x + width, y + height, style);
  addWall(map, x + width, y + height, x, y + height, style);
  if (!ruined) addWall(map, x, y + height, x, y, style);
  else {
    addWall(map, x, y + height, x, y + Math.ceil(height * 0.62), style);
    addWall(map, x, y + Math.floor(height * 0.28), x, y, style);
  }
}

function placeStamp(map: MapPackage, definitionId: string, random: () => number, occupied: Set<string>, attempts = 180) {
  const definition = definitionFor(definitionId);
  const rotations: MapRotation[] = definition.rotationMode === "fixed" ? [0] : [0, 90, 180, 270];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const rotation = rotations[Math.floor(random() * rotations.length)];
    const mask = rotatedMask(definition, rotation);
    const x = Math.floor(random() * Math.max(1, map.width - mask.width + 1));
    const y = Math.floor(random() * Math.max(1, map.height - mask.height + 1));
    if (!mask.cells.every((cell) => !occupied.has(`${x + cell.x}:${y + cell.y}`))) continue;
    mask.cells.forEach((cell) => occupied.add(`${x + cell.x}:${y + cell.y}`));
    map.stamps.push({
      id: `${definitionId}-${map.stamps.length}-${seedHash(`${map.seed}:${definitionId}:${map.stamps.length}`)}`,
      definitionId,
      x,
      y,
      rotation,
      flipX: definition.rotationMode === "orthogonal" && random() > 0.5,
      variant: Math.floor(random() * definition.assets.length),
    });
    return true;
  }
  return false;
}

function emptyMap(settings: GeneratorSettings): MapPackage {
  const dimensions = MAP_SIZES[settings.size];
  const base = baseTerrainForBiome(settings.biome);
  const title = settings.name?.trim() || `${settings.biome.charAt(0).toUpperCase()}${settings.biome.slice(1)} · ${settings.seed}`;
  return {
    format: "dnd-battle-map",
    version: 1,
    id: `map-${seedHash(`${settings.seed}:${settings.biome}:${Date.now()}`)}`,
    name: title,
    description: `Procedural ${settings.biome} map with ${settings.density} detail.`,
    biome: settings.biome,
    mood: settings.mood,
    seed: settings.seed,
    width: dimensions.width,
    height: dimensions.height,
    terrain: Array.from({ length: dimensions.width * dimensions.height }, () => base),
    stamps: [], walls: [], portals: [], labels: [], notes: [],
    source: { kind: "procedural" },
    createdAt: Date.now(),
  };
}

export function generateMap(settings: GeneratorSettings): MapPackage {
  const safeSettings = { ...settings, seed: settings.seed.trim().toUpperCase() || "WAYFINDER" };
  const map = emptyMap(safeSettings);
  const random = randomFromSeed(`${map.seed}:${map.biome}:${safeSettings.density}`);
  const occupied = new Set<string>();
  const densityCount = safeSettings.density === "open" ? 1 : safeSettings.density === "balanced" ? 3 : 5;

  if (safeSettings.biome === "forest") {
    if (safeSettings.pathStyle !== "none") paintPath(map, "earth", safeSettings.pathStyle, random, random() > 0.72 ? 2 : 1);
    if (safeSettings.water === "stream") paintStream(map, random);
    if (safeSettings.water === "pond") paintEllipse(map, "water", map.width * (0.62 + random() * 0.2), map.height * (0.62 + random() * 0.18), Math.max(2, map.width / 10), Math.max(1.5, map.height / 8), 0.22);
    const forestLandmarks = ["ancient-oak", "pine-cluster", "birch-grove"];
    const forestUnderstory = ["l-grove", "shrub-cluster", "fern-patch", "thorn-thicket"];
    const forestDebris = ["fallen-log", "tree-stump", "rock-pile", "pebble-scatter", "dead-tree"];
    for (let count = 0; count < safeSettings.landmarks; count += 1) placeStamp(map, forestLandmarks[count % forestLandmarks.length], random, occupied);
    for (let count = 0; count < densityCount + 1; count += 1) placeStamp(map, forestUnderstory[count % forestUnderstory.length], random, occupied);
    for (let count = 0; count < densityCount + 1; count += 1) placeStamp(map, forestDebris[count % forestDebris.length], random, occupied);
    if (safeSettings.pathStyle !== "none" && random() > 0.48) placeStamp(map, "abandoned-cart", random, occupied);
  } else if (safeSettings.biome === "dungeon") {
    const roomCount = safeSettings.density === "open" ? 3 : safeSettings.density === "balanced" ? 5 : 7;
    for (let index = 0; index < roomCount; index += 1) {
      const roomWidth = 3 + Math.floor(random() * Math.max(2, map.width / 5));
      const roomHeight = 3 + Math.floor(random() * Math.max(2, map.height / 4));
      const x = 1 + Math.floor(random() * Math.max(1, map.width - roomWidth - 2));
      const y = 1 + Math.floor(random() * Math.max(1, map.height - roomHeight - 2));
      addRoom(map, x, y, roomWidth, roomHeight, "stone");
      if (index > 0) map.portals.push({ id: `door-${index}`, x, y: clamp(y + Math.floor(roomHeight / 2), 0, map.height), orientation: "vertical", kind: "door", open: false });
    }
    for (let count = 0; count < densityCount; count += 1) placeStamp(map, count % 2 ? "bone-scatter" : "stone-crypt", random, occupied);
    const dungeonFurnishings = ["stone-altar", "crates-and-barrels", "wooden-table", "weapon-rack", "bookshelf", "treasure-chest"];
    for (let count = 0; count < densityCount + 1; count += 1) placeStamp(map, dungeonFurnishings[count % dungeonFurnishings.length], random, occupied);
    if (safeSettings.landmarks > 1) placeStamp(map, random() > 0.5 ? "dungeon-column" : "stone-statue", random, occupied);
    if (safeSettings.density !== "open") placeStamp(map, "prison-bars", random, occupied);
    if (safeSettings.density === "dense") placeStamp(map, "spike-pit", random, occupied);
  } else if (safeSettings.biome === "cave") {
    paintEllipse(map, "earth", map.width * 0.58, map.height * 0.5, map.width * 0.4, map.height * 0.38, 0.3);
    if (safeSettings.pathStyle !== "none") paintPath(map, "earth", "winding", random, 1);
    if (safeSettings.water === "stream") paintStream(map, random);
    if (safeSettings.water === "pond") paintEllipse(map, "water", map.width * (0.62 + random() * 0.18), map.height * (0.55 + random() * 0.2), Math.max(2, map.width / 9), Math.max(1.5, map.height / 7), 0.28);
    addWall(map, 0, map.height * 0.38, map.width * 0.14, map.height * 0.45, "cave");
    addWall(map, 0, map.height * 0.62, map.width * 0.14, map.height * 0.55, "cave");
    for (let count = 0; count < safeSettings.landmarks; count += 1) placeStamp(map, "cave-bone-lair", random, occupied);
    for (let count = 0; count < densityCount + 1; count += 1) placeStamp(map, count % 3 === 2 ? "bone-scatter" : "stalagmite-cluster", random, occupied);
    const caveDetails = ["glow-mushrooms", "boulder-outcrop", "rock-pile", "pebble-scatter"];
    for (let count = 0; count < densityCount + 1; count += 1) placeStamp(map, caveDetails[count % caveDetails.length], random, occupied);
  } else if (safeSettings.biome === "ruins") {
    paintEllipse(map, "stone", map.width * 0.5, map.height * 0.5, map.width * 0.34, map.height * 0.31, 0.25);
    for (let count = 0; count < Math.max(2, densityCount); count += 1) paintEllipse(map, "rubble", random() * map.width, random() * map.height, 1.5 + random() * 2.5, 1 + random() * 2, 0.3);
    const ruinCount = safeSettings.density === "open" ? 2 : safeSettings.density === "balanced" ? 4 : 6;
    for (let index = 0; index < ruinCount; index += 1) {
      const width = 3 + Math.floor(random() * 5);
      const height = 3 + Math.floor(random() * 4);
      addRoom(map, 1 + Math.floor(random() * Math.max(1, map.width - width - 2)), 1 + Math.floor(random() * Math.max(1, map.height - height - 2)), width, height, "ruined", true);
    }
    for (let count = 0; count < safeSettings.landmarks; count += 1) placeStamp(map, count === 0 ? "ruined-moon-shrine" : "standing-stones", random, occupied);
    const ruinStructures = ["ruined-l-wall", "ruined-arch", "rubble-heap", "grave-markers"];
    const ruinDetails = ["broken-fountain", "abandoned-cart", "crates-and-barrels", "stone-statue", "old-well"];
    for (let count = 0; count < densityCount + 1; count += 1) placeStamp(map, ruinStructures[count % ruinStructures.length], random, occupied);
    for (let count = 0; count < densityCount + 1; count += 1) placeStamp(map, ruinDetails[count % ruinDetails.length], random, occupied);
    if (safeSettings.mood === "moonlight") placeStamp(map, "warding-rune", random, occupied);
  } else if (safeSettings.biome === "swamp") {
    for (let count = 0; count < densityCount + 2; count += 1) paintEllipse(map, count % 2 ? "water" : "grass", random() * map.width, random() * map.height, 1.5 + random() * 3.5, 1 + random() * 2.5, 0.34);
    if (safeSettings.water === "stream") paintStream(map, random);
    if (safeSettings.pathStyle !== "none") paintPath(map, "earth", safeSettings.pathStyle, random, 1);
    for (let count = 0; count < safeSettings.landmarks; count += 1) placeStamp(map, "twisted-mangroves", random, occupied);
    for (let count = 0; count < densityCount + 1; count += 1) placeStamp(map, count % 2 ? "reed-bed" : "twisted-mangroves", random, occupied);
    const swampDetails = ["glow-mushrooms", "thorn-thicket", "shrub-cluster", "fern-patch", "dead-tree"];
    for (let count = 0; count < densityCount + 1; count += 1) placeStamp(map, swampDetails[count % swampDetails.length], random, occupied);
  } else if (safeSettings.biome === "desert") {
    if (safeSettings.pathStyle !== "none") paintPath(map, "earth", safeSettings.pathStyle, random, random() > 0.65 ? 2 : 1);
    if (safeSettings.water === "pond") paintEllipse(map, "water", map.width * (0.58 + random() * 0.2), map.height * (0.42 + random() * 0.28), Math.max(2, map.width / 11), Math.max(1.5, map.height / 9), 0.22);
    for (let count = 0; count < densityCount; count += 1) paintEllipse(map, count % 2 ? "stone" : "earth", random() * map.width, random() * map.height, 1.4 + random() * 2.8, 1 + random() * 2, 0.28);
    const desertNature = ["boulder-outcrop", "wind-carved-dunes", "cactus-cluster", "rock-pile", "dead-tree"];
    for (let count = 0; count < densityCount + 2; count += 1) placeStamp(map, desertNature[count % desertNature.length], random, occupied);
    for (let count = 0; count < safeSettings.landmarks; count += 1) placeStamp(map, count % 2 ? "standing-stones" : "abandoned-cart", random, occupied);
    if (safeSettings.density !== "open") placeStamp(map, "crates-and-barrels", random, occupied);
  } else if (safeSettings.biome === "tundra") {
    if (safeSettings.pathStyle !== "none") paintPath(map, "earth", safeSettings.pathStyle, random, 1);
    if (safeSettings.water === "stream") paintStream(map, random);
    if (safeSettings.water === "pond") paintEllipse(map, "water", map.width * 0.62, map.height * 0.58, Math.max(2, map.width / 9), Math.max(1.5, map.height / 7), 0.2);
    for (let count = 0; count < densityCount; count += 1) paintEllipse(map, count % 2 ? "stone" : "rubble", random() * map.width, random() * map.height, 1.5 + random() * 2.5, 1 + random() * 2, 0.24);
    const tundraNature = ["ice-spires", "boulder-outcrop", "snow-drift", "pine-cluster", "rock-pile"];
    for (let count = 0; count < densityCount + 2; count += 1) placeStamp(map, tundraNature[count % tundraNature.length], random, occupied);
    for (let count = 0; count < safeSettings.landmarks; count += 1) placeStamp(map, count % 2 ? "standing-stones" : "ruined-l-wall", random, occupied);
  } else if (safeSettings.biome === "volcanic") {
    paintStream(map, random);
    map.terrain = map.terrain.map((kind) => kind === "water" ? "lava" : kind);
    for (let count = 0; count < densityCount + 1; count += 1) paintEllipse(map, count % 2 ? "rubble" : "stone", random() * map.width, random() * map.height, 1.5 + random() * 3, 1 + random() * 2.2, 0.34);
    if (safeSettings.pathStyle !== "none") paintPath(map, "stone", safeSettings.pathStyle, random, 1);
    const volcanicNature = ["lava-vent", "boulder-outcrop", "rock-pile", "dead-tree"];
    for (let count = 0; count < densityCount + 2; count += 1) placeStamp(map, volcanicNature[count % volcanicNature.length], random, occupied);
    for (let count = 0; count < safeSettings.landmarks; count += 1) placeStamp(map, count % 2 ? "stone-altar" : "standing-stones", random, occupied);
    if (safeSettings.density === "dense") placeStamp(map, "spike-pit", random, occupied);
  } else {
    paintEllipse(map, "water", map.width * (0.9 + random() * 0.08), map.height * 0.5, map.width * 0.46, map.height * 0.74, 0.26);
    for (let count = 0; count < densityCount; count += 1) paintEllipse(map, count % 2 ? "rubble" : "grass", random() * map.width * 0.66, random() * map.height, 1.5 + random() * 3, 1 + random() * 2.2, 0.28);
    if (safeSettings.pathStyle !== "none") paintPath(map, "earth", safeSettings.pathStyle, random, 1);
    for (let count = 0; count < safeSettings.landmarks; count += 1) placeStamp(map, "coastal-wreck", random, occupied);
    const coastNature = ["reed-bed", "boulder-outcrop", "wind-carved-dunes", "pebble-scatter", "shrub-cluster"];
    for (let count = 0; count < densityCount + 1; count += 1) placeStamp(map, coastNature[count % coastNature.length], random, occupied);
    if (safeSettings.density !== "open") placeStamp(map, "crates-and-barrels", random, occupied);
  }

  if (safeSettings.mood === "torchlight") placeStamp(map, "campfire", random, occupied);
  if (safeSettings.water === "stream" && safeSettings.density !== "dense") placeStamp(map, "rope-bridge", random, occupied);
  return map;
}

function hasAny(source: string, terms: string[]) {
  return terms.some((term) => source.includes(term));
}

export function composeMapFromPrompt(prompt: string, requestedSeed?: string): PromptComposition {
  const normalized = prompt.trim().toLowerCase();
  const seed = (requestedSeed?.trim() || `PROMPT-${seedHash(normalized).toString(36)}`).toUpperCase();
  const biome: MapBiome = hasAny(normalized, ["swamp", "bog", "marsh", "fen", "wetland"])
    ? "swamp"
    : hasAny(normalized, ["coast", "beach", " cove ", "tidal", "lighthouse", "shipwreck", "shore"])
      ? "coast"
      : hasAny(normalized, ["desert", "dune", "oasis", "salt flat", "badlands"])
        ? "desert"
        : hasAny(normalized, ["tundra", "glacier", "glacial", "frozen", "snowbound", "ice field", "aurora"])
          ? "tundra"
          : hasAny(normalized, ["volcanic", "volcano", "caldera", "lava", "obsidian", "ash-choked"])
            ? "volcanic"
            : hasAny(normalized, ["cave", "cavern", "lair", "underground", "mine"])
              ? "cave"
              : hasAny(normalized, ["ruin", "haunted", "broken temple", "abandoned shrine", "battlefield"])
                ? "ruins"
                : hasAny(normalized, ["dungeon", "crypt", "tomb", "keep", "prison", "ossuary"])
                  ? "dungeon"
                  : "forest";
  const detectedFeatures: string[] = [biome];
  const water: WaterFeature = hasAny(normalized, ["stream", "river", "creek"]) ? "stream" : hasAny(normalized, ["pond", "pool", "water", "flooded"]) ? "pond" : "none";
  if (water !== "none") detectedFeatures.push(water);
  const mood: MapMood = hasAny(normalized, ["moon", "night", "haunted", "ghost", "eerie"])
    ? "moonlight"
    : hasAny(normalized, ["rain", "mist", "gloom", "overcast"])
      ? "overcast"
      : hasAny(normalized, ["daylight", "daylit", "sunlit", "bright day"])
        ? "daylight"
        : hasAny(normalized, ["torch", "fire", "warm glow"])
          ? "torchlight"
          : "daylight";
  detectedFeatures.push(mood);
  const density: MapDensity = hasAny(normalized, ["dense", "cluttered", "scattered", "maze", "many"])
    ? "dense"
    : hasAny(normalized, ["open", "clearing", "sparse", "wide chamber"])
      ? "open"
      : "balanced";
  const pathStyle: PathStyle = hasAny(normalized, ["narrow entrance", "winding", "twisting", "trail", "path"]) ? "winding" : biome === "dungeon" ? "none" : "direct";
  const size: MapSize = hasAny(normalized, ["vast", "large", "sprawling", "expansive"])
    ? "expansive"
    : hasAny(normalized, ["small", "compact", "tiny"])
      ? "scouting"
      : "standard";
  if (hasAny(normalized, ["bone", "skeleton", "skull"])) detectedFeatures.push("bones");
  if (hasAny(normalized, ["altar", "shrine", "ritual"])) detectedFeatures.push("ritual site");
  if (hasAny(normalized, ["bridge", "crossing"])) detectedFeatures.push("bridge");
  if (hasAny(normalized, ["camp", "campfire", "firepit"])) detectedFeatures.push("camp");
  if (hasAny(normalized, ["mushroom", "fungus", "bioluminescent", "glowing caps"])) detectedFeatures.push("mushrooms");
  if (hasAny(normalized, ["fountain", "basin", "cistern"])) detectedFeatures.push("fountain");
  if (hasAny(normalized, ["prison", "cell", "bars", "jail"])) detectedFeatures.push("prison bars");
  if (hasAny(normalized, ["crate", "barrel", "supplies", "store room", "storeroom"])) detectedFeatures.push("supplies");
  if (hasAny(normalized, ["wagon", "cart", "roadblock"])) detectedFeatures.push("cart");
  if (hasAny(normalized, ["thorn", "thicket", "bramble", "hedge"])) detectedFeatures.push("thicket");
  if (hasAny(normalized, ["pit", "spikes", "sinkhole", "chasm"])) detectedFeatures.push("pit trap");
  if (hasAny(normalized, ["rune", "ward", "glyph", "magical trap"])) detectedFeatures.push("warding rune");
  if (hasAny(normalized, ["mangrove", "gnarled roots", "twisted trees"])) detectedFeatures.push("mangroves");
  if (hasAny(normalized, ["reed", "rushes", "cattail"])) detectedFeatures.push("reeds");
  if (hasAny(normalized, ["dune", "sand ridge", "wind-carved sand"])) detectedFeatures.push("dunes");
  if (hasAny(normalized, ["ice spire", "glacier", "crevasse", "frozen", "aurora"])) detectedFeatures.push("ice spires");
  if (hasAny(normalized, ["lava", "caldera", "magma", "volcanic vent"])) detectedFeatures.push("lava vents");
  if (hasAny(normalized, ["shipwreck", "wrecked ship", "broken vessel", "beached vessel"])) detectedFeatures.push("shipwreck");
  if (hasAny(normalized, ["watchtower", "lighthouse", "collapsed tower"])) detectedFeatures.push("ruined tower");
  if (hasAny(normalized, ["battlefield", "mass grave", "old battle"])) detectedFeatures.push("battlefield");

  const settings: GeneratorSettings = {
    biome, size, density, pathStyle, water, mood, seed,
    landmarks: hasAny(normalized, ["grand", "ancient", "massive", "landmark"]) ? 2 : 1,
    name: prompt.trim().split(/[.!?]/)[0].slice(0, 54) || `Prompted ${biome}`,
  };
  const map = generateMap(settings);
  map.source = { kind: "prompt", prompt: prompt.trim().slice(0, 600) };
  map.description = `Prompt-composed ${biome} map. Detected: ${detectedFeatures.join(", ")}.`;
  if (detectedFeatures.includes("bones") && !map.stamps.some((stamp) => stamp.definitionId.includes("bone"))) {
    const definitionId = biome === "cave" ? "cave-bone-lair" : "bone-scatter";
    map.stamps.push({ id: `bone-prompt-${seedHash(seed)}`, definitionId, x: Math.floor(map.width * 0.62), y: Math.floor(map.height * 0.55), rotation: 0 });
  }
  if (detectedFeatures.includes("ritual site") && !map.stamps.some((stamp) => stamp.definitionId === "standing-stones")) {
    const definitionId = biome === "ruins" ? "ruined-moon-shrine" : "standing-stones";
    map.stamps.push({ id: `ritual-prompt-${seedHash(seed)}`, definitionId, x: Math.floor(map.width * 0.44), y: Math.floor(map.height * 0.38), rotation: 0 });
  }
  if (detectedFeatures.includes("camp") && !map.stamps.some((stamp) => stamp.definitionId === "campfire")) {
    map.stamps.push({ id: `camp-prompt-${seedHash(seed)}`, definitionId: "campfire", x: Math.floor(map.width * 0.5), y: Math.floor(map.height * 0.5), rotation: 0 });
  }
  const promptStamps: Array<[string, string, number, number]> = [
    ["mushrooms", "glow-mushrooms", 0.26, 0.7],
    ["fountain", "broken-fountain", 0.48, 0.42],
    ["prison bars", "prison-bars", 0.35, 0.32],
    ["supplies", "crates-and-barrels", 0.68, 0.32],
    ["cart", "abandoned-cart", 0.3, 0.52],
    ["thicket", "thorn-thicket", 0.7, 0.62],
    ["pit trap", "spike-pit", 0.56, 0.6],
    ["warding rune", "warding-rune", 0.42, 0.72],
    ["mangroves", "twisted-mangroves", 0.56, 0.32],
    ["reeds", "reed-bed", 0.28, 0.64],
    ["dunes", "wind-carved-dunes", 0.52, 0.64],
    ["ice spires", "ice-spires", 0.58, 0.38],
    ["lava vents", "lava-vent", 0.62, 0.6],
    ["shipwreck", "coastal-wreck", 0.46, 0.52],
    ["ruined tower", "ruined-l-wall", 0.3, 0.28],
    ["battlefield", "bone-scatter", 0.54, 0.48],
    ["battlefield", "abandoned-cart", 0.24, 0.64],
  ];
  for (const [feature, definitionId, xRatio, yRatio] of promptStamps) {
    if (!detectedFeatures.includes(feature)) continue;
    const definition = definitionFor(definitionId);
    map.stamps.push({
      id: `${definitionId}-prompt-${seedHash(`${seed}:${feature}`)}`,
      definitionId,
      x: clamp(Math.floor(map.width * xRatio), 0, Math.max(0, map.width - definition.width)),
      y: clamp(Math.floor(map.height * yRatio), 0, Math.max(0, map.height - definition.height)),
      rotation: 0,
    });
  }
  return { settings, detectedFeatures, map };
}

export function parseMapPackage(value: unknown): MapPackage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MapPackage>;
  if (candidate.format !== "dnd-battle-map" || candidate.version !== 1) return null;
  if (!Number.isInteger(candidate.width) || !Number.isInteger(candidate.height) || !candidate.width || !candidate.height || candidate.width > 48 || candidate.height > 36) return null;
  if (!Array.isArray(candidate.terrain) || candidate.terrain.length !== candidate.width * candidate.height) return null;
  const validTerrain = new Set<TerrainKind>(["grass", "earth", "water", "stone", "cave", "rubble", "mud", "sand", "snow", "ash", "lava"]);
  if (!candidate.terrain.every((kind) => validTerrain.has(kind))) return null;
  if (!Array.isArray(candidate.stamps) || !Array.isArray(candidate.walls) || !Array.isArray(candidate.portals) || !Array.isArray(candidate.labels) || !Array.isArray(candidate.notes)) return null;
  const serialized = JSON.stringify(candidate);
  if (serialized.length > 180_000) return null;
  const text = (input: unknown, maximum: number) => typeof input === "string" ? input.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
  const number = (input: unknown, minimum: number, maximum: number) => {
    const numeric = Number(input);
    return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : minimum;
  };
  const biomes = new Set<MapBiome>(["forest", "dungeon", "cave", "ruins", "swamp", "desert", "tundra", "volcanic", "coast"]);
  const moods = new Set<MapMood>(["daylight", "overcast", "moonlight", "torchlight"]);
  if (!candidate.biome || !biomes.has(candidate.biome) || !candidate.mood || !moods.has(candidate.mood)) return null;
  if (candidate.stamps.length > 500 || candidate.walls.length > 500 || candidate.portals.length > 200 || candidate.labels.length > 200 || candidate.notes.length > 300 || (candidate.sceneObjects?.length ?? 0) > 100) return null;

  const safeAssetUrl = (input: unknown) => {
    const url = text(input, 180);
    return /^\/map-assets\/[a-z0-9][a-z0-9/-]*\.(?:jpg|png)$/.test(url) ? url : "";
  };
  const visual = candidate.visual && typeof candidate.visual === "object" && candidate.visual.kind === "generated-scene"
    ? (() => {
        const assetUrl = safeAssetUrl(candidate.visual?.assetUrl);
        const sceneKitId = text(candidate.visual?.sceneKitId, 80);
        if (!assetUrl || !sceneKitId) return undefined;
        return {
          kind: "generated-scene" as const,
          assetUrl,
          pixelWidth: Math.round(number(candidate.visual?.pixelWidth, 1024, 8192)),
          pixelHeight: Math.round(number(candidate.visual?.pixelHeight, 768, 8192)),
          sceneKitId,
        };
      })()
    : undefined;
  const sceneObjects = Array.isArray(candidate.sceneObjects) ? candidate.sceneObjects.flatMap((object, index): PlacedSceneObject[] => {
    if (!object || typeof object !== "object") return [];
    const assetUrl = safeAssetUrl(object.assetUrl);
    const definitionId = text(object.definitionId, 80);
    if (!assetUrl || !definitionId || ![0, 90, 180, 270].includes(Number(object.rotation))) return [];
    const width = number(object.width, 0.5, candidate.width!);
    const height = number(object.height, 0.5, candidate.height!);
    return [{
      id: text(object.id, 80) || `scene-object-${index}`,
      definitionId,
      assetUrl,
      x: number(object.x, 0, Math.max(0, candidate.width! - width)),
      y: number(object.y, 0, Math.max(0, candidate.height! - height)),
      width,
      height,
      rotation: Number(object.rotation) as MapRotation,
    }];
  }) : [];

  const stamps = candidate.stamps.flatMap((stamp, index): PlacedStamp[] => {
    if (!stamp || typeof stamp !== "object") return [];
    const definition = STAMP_LIBRARY.find((item) => item.id === stamp.definitionId);
    if (!definition || ![0, 90, 180, 270].includes(Number(stamp.rotation))) return [];
    const rotation = effectiveStampRotation(definition, Number(stamp.rotation) as MapRotation);
    const mask = rotatedMask(definition, rotation);
    const id = text(stamp.id, 80) || `stamp-${index}`;
    return [{
      id,
      definitionId: definition.id,
      x: Math.round(number(stamp.x, 0, Math.max(0, candidate.width! - mask.width))),
      y: Math.round(number(stamp.y, 0, Math.max(0, candidate.height! - mask.height))),
      rotation,
      flipX: definition.rotationMode === "orthogonal" && Boolean(stamp.flipX),
      variant: stampVariantFor(definition, text(candidate.seed, 80), id, Number(stamp.variant)),
    }];
  });
  const walls = candidate.walls.flatMap((wall, index): WallSegment[] => {
    if (!wall || typeof wall !== "object" || !["stone", "cave", "ruined"].includes(String(wall.style))) return [];
    const x1 = number(wall.x1, 0, candidate.width!);
    const y1 = number(wall.y1, 0, candidate.height!);
    const x2 = number(wall.x2, 0, candidate.width!);
    const y2 = number(wall.y2, 0, candidate.height!);
    if (x1 === x2 && y1 === y2) return [];
    return [{ id: text(wall.id, 80) || `wall-${index}`, x1, y1, x2, y2, style: wall.style }];
  });
  const portals = candidate.portals.flatMap((portal, index): Portal[] => {
    if (!portal || typeof portal !== "object" || !["horizontal", "vertical"].includes(String(portal.orientation)) || !["door", "window"].includes(String(portal.kind))) return [];
    return [{
      id: text(portal.id, 80) || `portal-${index}`,
      x: number(portal.x, 0, candidate.width!),
      y: number(portal.y, 0, candidate.height!),
      orientation: portal.orientation,
      kind: portal.kind,
      open: Boolean(portal.open),
    }];
  });
  const labels = candidate.labels.flatMap((label, index): MapLabel[] => {
    if (!label || typeof label !== "object" || !["dm", "everyone"].includes(String(label.visibility))) return [];
    const labelText = text(label.text, 80);
    return labelText ? [{ id: text(label.id, 80) || `label-${index}`, x: number(label.x, 0, candidate.width!), y: number(label.y, 0, candidate.height!), text: labelText, visibility: label.visibility }] : [];
  });
  const notes = candidate.notes.flatMap((note, index): MapNote[] => {
    if (!note || typeof note !== "object") return [];
    const noteText = text(note.text, 240);
    return noteText ? [{ id: text(note.id, 80) || `note-${index}`, x: number(note.x, 0, candidate.width!), y: number(note.y, 0, candidate.height!), text: noteText }] : [];
  });
  const sourceKind = candidate.source?.kind;
  const source: MapPackage["source"] = {
    kind: sourceKind === "prompt" || sourceKind === "imported" || sourceKind === "generated-scene" ? sourceKind : "procedural",
    ...(candidate.source?.prompt ? { prompt: text(candidate.source.prompt, 600) } : {}),
  };
  return {
    format: "dnd-battle-map",
    version: 1,
    id: text(candidate.id, 100) || `map-${seedHash(serialized)}`,
    name: text(candidate.name, 72) || "Untitled map",
    description: text(candidate.description, 240),
    biome: candidate.biome,
    mood: candidate.mood,
    seed: text(candidate.seed, 80).toUpperCase() || "WAYFINDER",
    width: candidate.width,
    height: candidate.height,
    terrain: [...candidate.terrain] as TerrainKind[],
    stamps,
    walls,
    portals,
    labels,
    notes,
    ...(visual ? { visual } : {}),
    ...(sceneObjects.length ? { sceneObjects } : {}),
    source,
    createdAt: Math.max(0, Math.trunc(Number(candidate.createdAt)) || Date.now()),
  };
}

export function cloneMapPackage(map: MapPackage): MapPackage {
  return JSON.parse(JSON.stringify(map)) as MapPackage;
}
