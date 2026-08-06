export const CREATURE_SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;

export type CreatureSize = (typeof CREATURE_SIZES)[number];

export const TOKEN_SIZE_CELLS: Record<CreatureSize, number> = {
  tiny: 0.5,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
};

export type CreatureTemplate = {
  id: string;
  name: string;
  artAsset: string;
  family: "beast" | "humanoid" | "undead" | "fiend" | "monstrosity" | "giant" | "dragon" | "plant";
  size: CreatureSize;
  defaultSpeed: number;
};

export const CREATURE_LIBRARY: CreatureTemplate[] = [
  { id: "cave-bat", name: "Cave Bat", artAsset: "/assets/tokens/creatures/cave-bat-01.png", family: "beast", size: "tiny", defaultSpeed: 30 },
  { id: "ember-imp", name: "Ember Imp", artAsset: "/assets/tokens/creatures/imp-01.png", family: "fiend", size: "tiny", defaultSpeed: 40 },
  { id: "giant-rat", name: "Giant Rat", artAsset: "/assets/tokens/creatures/giant-rat-01.png", family: "beast", size: "small", defaultSpeed: 30 },
  { id: "goblin-raider", name: "Goblin Raider", artAsset: "/assets/tokens/creatures/goblin-raider-01.png", family: "humanoid", size: "small", defaultSpeed: 30 },
  { id: "gray-wolf", name: "Gray Wolf", artAsset: "/assets/tokens/creatures/gray-wolf-01.png", family: "beast", size: "medium", defaultSpeed: 40 },
  { id: "skeleton-guard", name: "Skeleton Guard", artAsset: "/assets/tokens/creatures/skeleton-guard-01.png", family: "undead", size: "medium", defaultSpeed: 30 },
  { id: "shambling-zombie", name: "Shambling Zombie", artAsset: "/assets/tokens/creatures/shambling-zombie-01.png", family: "undead", size: "medium", defaultSpeed: 20 },
  { id: "black-bear", name: "Black Bear", artAsset: "/assets/tokens/creatures/black-bear-01.png", family: "beast", size: "medium", defaultSpeed: 30 },
  { id: "mimic-chest", name: "Mimic Chest", artAsset: "/assets/tokens/creatures/mimic-chest-01.png", family: "monstrosity", size: "medium", defaultSpeed: 20 },
  { id: "dire-wolf", name: "Dire Wolf", artAsset: "/assets/tokens/creatures/dire-wolf-01.png", family: "beast", size: "large", defaultSpeed: 50 },
  { id: "giant-cave-spider", name: "Giant Cave Spider", artAsset: "/assets/tokens/creatures/giant-cave-spider-01.png", family: "beast", size: "large", defaultSpeed: 30 },
  { id: "ogre-brute", name: "Ogre Brute", artAsset: "/assets/tokens/creatures/ogre-brute-01.png", family: "giant", size: "large", defaultSpeed: 40 },
  { id: "owlbear", name: "Owlbear", artAsset: "/assets/tokens/creatures/owlbear-01.png", family: "monstrosity", size: "large", defaultSpeed: 40 },
  { id: "shadow-dire-warg", name: "Shadow Dire Warg", artAsset: "/assets/tokens/monsters/shadow-dire-warg-01.png", family: "monstrosity", size: "large", defaultSpeed: 50 },
  { id: "hungry-horror", name: "Hungry Horror", artAsset: "/assets/tokens/monsters/hungry-01.png", family: "monstrosity", size: "large", defaultSpeed: 40 },
  { id: "young-green-dragon", name: "Young Green Dragon", artAsset: "/assets/tokens/monsters/young-green-dragon-01.png", family: "dragon", size: "large", defaultSpeed: 40 },
  { id: "ancient-treant", name: "Ancient Treant", artAsset: "/assets/tokens/creatures/ancient-treant-01.png", family: "plant", size: "huge", defaultSpeed: 30 },
];

export const CHARACTER_ART_ASSETS = [
  "/assets/tokens/characters/dareleth-paladin-01.png",
  "/assets/tokens/characters/malichar-rogue-01.png",
  "/assets/tokens/characters/jelton-druid-01.png",
];

export const TOKEN_ART_ASSETS = [
  ...CHARACTER_ART_ASSETS,
  ...CREATURE_LIBRARY.map((creature) => creature.artAsset),
];

export function isCreatureSize(value: unknown): value is CreatureSize {
  return typeof value === "string" && CREATURE_SIZES.includes(value as CreatureSize);
}

export function tokenRadiusCells(size: CreatureSize): number {
  return Math.max(0.23, TOKEN_SIZE_CELLS[size] * 0.43);
}
