export const CREATURE_SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;

export type CreatureSize = (typeof CREATURE_SIZES)[number];
export type CreatureFamily = string;

export type CreatureSpeeds = {
  walk: number;
  fly: number | null;
  swim: number | null;
  climb: number | null;
  burrow: number | null;
};

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
  thumbnailAsset: string;
  family: CreatureFamily;
  creatureType: string;
  size: CreatureSize;
  defaultHp: number;
  hitDice: string | null;
  armorClass: number;
  challengeRating: string | null;
  defaultSpeed: number;
  speeds: CreatureSpeeds;
};

export type CreatureCatalogSeed = CreatureTemplate & { sourceAsset: string; sortOrder: number };

function creatureSeed(
  sortOrder: number,
  id: string,
  name: string,
  sourceAsset: string,
  family: CreatureFamily,
  size: CreatureSize,
  defaultSpeed: number,
  defaultHp: number,
  hitDice: string,
  armorClass: number,
  challengeRating: string,
): CreatureCatalogSeed {
  const assetKey = sourceAsset.replace(/^\/assets\//, "");
  const artAsset = `/creature-assets/${assetKey}`;
  return {
    id, name, sourceAsset, artAsset,
    thumbnailAsset: `${artAsset}?variant=thumbnail&v=3`,
    family, creatureType: family, size, defaultHp, hitDice, armorClass,
    challengeRating, defaultSpeed,
    speeds: { walk: defaultSpeed, fly: null, swim: null, climb: null, burrow: null },
    sortOrder,
  };
}

// These records seed D1. The browser reads the catalog from the API, never this array.
export const CREATURE_CATALOG_SEED: CreatureCatalogSeed[] = [
  creatureSeed(10, "cave-bat", "Cave Bat", "/assets/tokens/creatures/cave-bat-01.png", "beast", "tiny", 30, 1, "1d4-1", 12, "0"),
  creatureSeed(20, "ember-imp", "Ember Imp", "/assets/tokens/creatures/imp-01.png", "fiend", "tiny", 40, 10, "3d4+3", 13, "1"),
  creatureSeed(30, "giant-rat", "Giant Rat", "/assets/tokens/creatures/giant-rat-01.png", "beast", "small", 30, 7, "2d6", 12, "1/8"),
  creatureSeed(40, "goblin-raider", "Goblin Raider", "/assets/tokens/creatures/goblin-raider-01.png", "humanoid", "small", 30, 7, "2d6", 15, "1/4"),
  creatureSeed(50, "gray-wolf", "Gray Wolf", "/assets/tokens/creatures/gray-wolf-01.png", "beast", "medium", 40, 11, "2d8+2", 13, "1/4"),
  creatureSeed(60, "skeleton-guard", "Skeleton Guard", "/assets/tokens/creatures/skeleton-guard-01.png", "undead", "medium", 30, 13, "2d8+4", 13, "1/4"),
  creatureSeed(70, "shambling-zombie", "Shambling Zombie", "/assets/tokens/creatures/shambling-zombie-01.png", "undead", "medium", 20, 22, "3d8+9", 8, "1/4"),
  creatureSeed(80, "black-bear", "Black Bear", "/assets/tokens/creatures/black-bear-01.png", "beast", "medium", 30, 19, "3d8+6", 11, "1/2"),
  creatureSeed(90, "mimic-chest", "Mimic Chest", "/assets/tokens/creatures/mimic-chest-01.png", "monstrosity", "medium", 15, 58, "9d8+18", 12, "2"),
  creatureSeed(100, "dire-wolf", "Dire Wolf", "/assets/tokens/creatures/dire-wolf-01.png", "beast", "large", 50, 37, "5d10+10", 14, "1"),
  creatureSeed(110, "giant-cave-spider", "Giant Cave Spider", "/assets/tokens/creatures/giant-cave-spider-01.png", "beast", "large", 30, 26, "4d10+4", 14, "1"),
  creatureSeed(120, "ogre-brute", "Ogre Brute", "/assets/tokens/creatures/ogre-brute-01.png", "giant", "large", 40, 59, "7d10+21", 11, "2"),
  creatureSeed(130, "owlbear", "Owlbear", "/assets/tokens/creatures/owlbear-01.png", "monstrosity", "large", 40, 59, "7d10+21", 13, "3"),
  creatureSeed(140, "shadow-dire-warg", "Shadow Dire Warg", "/assets/tokens/monsters/shadow-dire-warg-01.png", "monstrosity", "large", 50, 67, "9d10+18", 14, "3"),
  creatureSeed(150, "hungry-horror", "Hungry Horror", "/assets/tokens/monsters/hungry-01.png", "monstrosity", "large", 40, 76, "9d10+27", 14, "4"),
  creatureSeed(160, "young-green-dragon", "Young Green Dragon", "/assets/tokens/monsters/young-green-dragon-01.png", "dragon", "large", 40, 136, "16d10+48", 18, "8"),
  creatureSeed(170, "ancient-treant", "Ancient Treant", "/assets/tokens/creatures/ancient-treant-01.png", "plant", "huge", 30, 138, "12d12+60", 16, "9"),
];

export const CHARACTER_ART_ASSETS = [
  "/assets/tokens/characters/dareleth-paladin-01.png",
  "/assets/tokens/characters/malichar-rogue-01.png",
  "/assets/tokens/characters/jelton-druid-01.png",
];

export function isCreatureSize(value: unknown): value is CreatureSize {
  return typeof value === "string" && CREATURE_SIZES.includes(value as CreatureSize);
}

export function tokenRadiusCells(size: CreatureSize): number {
  return Math.max(0.23, TOKEN_SIZE_CELLS[size] * 0.43);
}
