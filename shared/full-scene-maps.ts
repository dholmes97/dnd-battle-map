import type { MapBiome, MapPackage } from "./map-package.ts";
import { defaultFogConfig } from "./fog-of-war.mjs";

type FullSceneDefinition = {
  id: string;
  name: string;
  description: string;
  biome: MapBiome;
  mood: MapPackage["mood"];
  assetUrl: string;
  width?: number;
  height?: number;
};

export const FULL_SCENE_MAPS: FullSceneDefinition[] = [
  {
    id: "grandfather-tree-roots-v1",
    name: "Grandfather Tree Roots",
    description: "The shaded base of the Grandfather Tree, where an immense curved trunk wall and branching, overlapping roots shape the entire battlefield.",
    biome: "forest",
    mood: "daylight",
    assetUrl: "/map-assets/grandfather-tree-roots-01.jpg",
  },
  {
    id: "ancient-forest-clearing-v2",
    name: "Ancient Forest Crossing",
    description: "An old-growth woodland crossing with a mossy ruin, pond, trails, and open tactical ground.",
    biome: "forest",
    mood: "daylight",
    assetUrl: "/map-assets/ancient-forest-clearing-02.jpg",
  },
  {
    id: "ruined-underground-temple-v2",
    name: "Flooded Temple Ruin",
    description: "A torchlit underground temple with side chambers, broken masonry, and a flooded lower edge.",
    biome: "dungeon",
    mood: "torchlight",
    assetUrl: "/map-assets/ruined-underground-temple-02.jpg",
  },
  {
    id: "storm-coast-ruins-v2",
    name: "Storm Coast Ruins",
    description: "A wave-battered island ruin with tide pools, a broken causeway, and multiple approach routes.",
    biome: "coast",
    mood: "overcast",
    assetUrl: "/map-assets/storm-coast-ruins-02.jpg",
  },
  {
    id: "moonlit-fey-glade-v1",
    name: "Moonlit Fey Glade",
    description: "An enchanted woodland spring with stepping stones, luminous mushrooms, ancient roots, and several winding approaches.",
    biome: "forest",
    mood: "moonlight",
    assetUrl: "/map-assets/moonlit-fey-glade-01.jpg",
  },
  {
    id: "crystal-cavern-crossing-v1",
    name: "Crystal Cavern Crossing",
    description: "A luminous subterranean river crossing with natural bridges, a shallow ford, crystal clusters, and mining remnants.",
    biome: "cave",
    mood: "torchlight",
    assetUrl: "/map-assets/crystal-cavern-crossing-01.jpg",
  },
  {
    id: "sunken-swamp-shrine-v1",
    name: "Sunken Swamp Shrine",
    description: "A flooded cypress shrine linked by muddy islands, plank walks, twisted roots, and shallow-water routes.",
    biome: "swamp",
    mood: "overcast",
    assetUrl: "/map-assets/sunken-swamp-shrine-01.jpg",
  },
  {
    id: "desert-caravanserai-ruin-v1",
    name: "Desert Caravanserai",
    description: "A wind-scoured sandstone waystation with a dry courtyard, ruined arcades, broken rooms, and dune approaches.",
    biome: "desert",
    mood: "daylight",
    assetUrl: "/map-assets/desert-caravanserai-ruin-01.jpg",
  },
  {
    id: "frozen-mountain-pass-v1",
    name: "Frozen Mountain Pass",
    description: "A snowy alpine crossing with an icy ravine, timber bridge, frozen ford, switchbacks, and a lonely watch shelter.",
    biome: "tundra",
    mood: "overcast",
    assetUrl: "/map-assets/frozen-mountain-pass-01.jpg",
  },
  {
    id: "volcanic-forge-caldera-v1",
    name: "Volcanic Forge Caldera",
    description: "An ancient basalt forge complex divided by lava channels, heavy bridges, broad stairs, and a central smelting dais.",
    biome: "volcanic",
    mood: "torchlight",
    assetUrl: "/map-assets/volcanic-forge-caldera-01.jpg",
  },
  {
    id: "abandoned-village-square-v1",
    name: "Abandoned Village Square",
    description: "A rain-darkened village crossroads with roofless cottages, a muddy market square, narrow alleys, and four roads.",
    biome: "ruins",
    mood: "overcast",
    assetUrl: "/map-assets/abandoned-village-square-01.jpg",
  },
  {
    id: "goblin-mineworks-v1",
    name: "Goblin Mineworks",
    description: "A torchlit mine stronghold with timber-braced passages, cart rails, loading platforms, pits, and flanking tunnels.",
    biome: "cave",
    mood: "torchlight",
    assetUrl: "/map-assets/goblin-mineworks-01.jpg",
  },
  {
    id: "river-gorge-bridge-v1",
    name: "River Gorge Bridge",
    description: "A forest river crossing with an old stone bridge, fallen-tree route, rocky banks, and ruined tollhouse cover.",
    biome: "forest",
    mood: "daylight",
    assetUrl: "/map-assets/river-gorge-bridge-01.jpg",
  },
  {
    id: "haunted-graveyard-chapel-v1",
    name: "Haunted Graveyard Chapel",
    description: "A moonlit cemetery surrounding a roofless chapel, crypts, broken walls, winding paths, and an open iron gate.",
    biome: "ruins",
    mood: "moonlight",
    assetUrl: "/map-assets/haunted-graveyard-chapel-01.jpg",
  },
  {
    id: "cliffside-switchbacks-v1",
    name: "Cliffside Switchbacks",
    description: "A long mountain descent with broad switchbacks, narrow ledges, rocky cover, and staging areas at the summit and valley floor.",
    biome: "tundra",
    mood: "daylight",
    assetUrl: "/map-assets/cliffside-switchbacks-01.jpg",
    width: 45,
    height: 30,
  },
  {
    id: "underwater-ruins-v1",
    name: "Underwater Ruins",
    description: "A submerged reef basin with sandy channels, coral ridges, ancient ruins, a broken shipwreck, rock arches, and deep trenches.",
    biome: "coast",
    mood: "daylight",
    assetUrl: "/map-assets/underwater-ruins-01.jpg",
    width: 45,
    height: 30,
  },
  {
    id: "ravenloft-grand-dining-hall-v1",
    name: "Ravenloft Grand Dining Hall",
    description: "A vast gothic banquet chamber with a laden satin-draped table, crystal chandeliers, mirrored walls, and a despairing pipe organ.",
    biome: "dungeon",
    mood: "torchlight",
    assetUrl: "/map-assets/ravenloft-grand-dining-hall-01.jpg",
  },
];

export function createFullSceneMap(definition: FullSceneDefinition): MapPackage {
  const width = definition.width ?? 24;
  const height = definition.height ?? 16;
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
    fog: defaultFogConfig(width, height) as MapPackage["fog"],
    visual: {
      kind: "generated-scene",
      assetUrl: definition.assetUrl,
      pixelWidth: 3072,
      pixelHeight: 2048,
    },
    source: { kind: "generated-scene" },
    createdAt: Date.now(),
  };
}
