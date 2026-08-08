import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API_ROOT = "https://www.dnd5eapi.co";
const outputPath = resolve(process.argv[2] ?? "catalog/creatures.json");
const existingIds = new Set([
  "cave-bat", "ember-imp", "giant-rat", "goblin-raider", "gray-wolf",
  "skeleton-guard", "shambling-zombie", "black-bear", "mimic-chest",
  "dire-wolf", "giant-cave-spider", "ogre-brute", "owlbear",
  "shadow-dire-warg", "hungry-horror", "young-green-dragon", "ancient-treant",
]);

function feet(value) {
  const match = String(value ?? "").match(/(\d+)\s*ft/i);
  return match ? Number(match[1]) : null;
}

function challengeRating(value) {
  if (value === 0.125) return "1/8";
  if (value === 0.25) return "1/4";
  if (value === 0.5) return "1/2";
  return String(value ?? "0");
}

function armorClass(value) {
  if (typeof value === "number") return value;
  if (!Array.isArray(value)) return 10;
  return Math.max(1, ...value.map((entry) => Number(entry?.value) || 0));
}

function normalizeSrd(monster) {
  const walk = feet(monster.speed?.walk) ?? 0;
  return {
    id: `srd-${monster.index}`,
    name: monster.name,
    family: String(monster.type ?? "monstrosity").toLowerCase(),
    creatureType: String(monster.type ?? "monstrosity").toLowerCase(),
    subtype: monster.subtype || null,
    size: String(monster.size ?? "medium").toLowerCase(),
    defaultHp: Math.max(1, Number(monster.hit_points) || 1),
    hitDice: monster.hit_dice || monster.hit_points_roll || null,
    armorClass: armorClass(monster.armor_class),
    challengeRating: challengeRating(monster.challenge_rating),
    speeds: {
      walk,
      fly: feet(monster.speed?.fly),
      swim: feet(monster.speed?.swim),
      climb: feet(monster.speed?.climb),
      burrow: feet(monster.speed?.burrow),
    },
    source: { kind: "srd-5.1", index: monster.index, url: `${API_ROOT}${monster.url}` },
    artDirection: `Original tactical fantasy depiction of ${monster.name}, a ${monster.size} ${monster.type}${monster.subtype ? ` (${monster.subtype})` : ""}.`,
  };
}

const campaignCreatures = [
  ["campaign-lonely", "Lonely", "aberration", "large", 85, "10d10+30", 15, "5", 30, "A gaunt sorrow-born horror with long hooked harpoon arms and a mournful eyeless face"],
  ["campaign-sniffer", "Sniffer", "monstrosity", "medium", 27, "5d8+5", 13, "1", 40, "A low six-legged scent hunter with oversized nostrils, pale hide, and twitching sensory tendrils"],
  ["campaign-shadow-goblin", "Shadow Goblin", "humanoid", "small", 11, "3d6", 14, "1/2", 30, "A wiry goblin-like raider formed from smoke and ragged shadow"],
  ["campaign-herald", "The Herald", "aberration", "large", 136, "16d10+48", 17, "9", 40, "An elegant otherworldly emissary in broken ceremonial armor, surrounded by black ribbons of force"],
  ["campaign-mellannor", "Mellannor, Shadow Warg", "monstrosity", "large", 94, "11d10+33", 16, "6", 50, "A regal dire warg with midnight fur, ember eyes, and a mane dissolving into supernatural shadow"],
  ["campaign-bronze-griffon", "Bronze Griffon", "construct", "large", 76, "8d10+32", 17, "5", 30, "A living bronze griffon with articulated feather plates and an aged green patina"],
  ["campaign-sapphire-spirit", "Sapphire Draconic Spirit", "dragon", "large", 110, "13d10+39", 17, "7", 40, "A translucent sapphire dragon spirit made of faceted blue light and drifting runes"],
  ["campaign-amber-abomination", "Amber-Tower Abomination", "aberration", "huge", 168, "16d12+64", 18, "11", 30, "A towering asymmetrical horror fused with amber crystal, ancient masonry, and many grasping limbs"],
  ["campaign-tentacle-panther", "Tentacled Six-Legged Panther", "monstrosity", "large", 68, "8d10+24", 15, "4", 50, "A sleek six-legged black panther with two long hunting tentacles arching from its shoulders"],
  ["campaign-tree-witch", "Tree-Witch Hag", "fey", "medium", 82, "11d8+33", 16, "5", 30, "An ancient woodland witch whose crooked body blends bark, roots, moss, and tattered robes"],
].map(([id, name, creatureType, size, defaultHp, hitDice, armorClass, cr, walk, artDirection]) => ({
  id, name, family: creatureType, creatureType, subtype: null, size, defaultHp, hitDice,
  armorClass, challengeRating: cr, speeds: { walk, fly: name.includes("Griffon") || name.includes("Spirit") ? 80 : null, swim: null, climb: null, burrow: null },
  source: { kind: "campaign-original" }, artDirection,
}));

const themes = [
  ["Ashen", "volcanic soot, coal-red cracks, and scorched armor"],
  ["Briar", "thorny vines, tangled roots, and weathered forest colors"],
  ["Crystal", "natural crystal growths, refracted light, and angular anatomy"],
  ["Drowned", "waterlogged textures, sea growth, and ghostly bubbles"],
  ["Frost", "rimed fur or armor, pale blue ice, and cold vapor"],
  ["Gloam", "dusky violet shadow, moonlit edges, and subtle spectral haze"],
  ["Iron", "heavy riveted plates, dark metal, and furnace-orange seams"],
  ["Mire", "peat-dark hide, swamp plants, mud, and sickly green accents"],
  ["Moon", "silver markings, nocturnal coloring, and cool luminous eyes"],
  ["Sand", "wind-worn hide, desert ochres, and drifting grit"],
  ["Storm", "rain-dark surfaces, electric blue markings, and wind-tossed details"],
  ["Verdant", "lush leaf growth, green-gold coloring, and living wood details"],
];

const archetypes = [
  ["Burrower", "monstrosity", "large", 68, "8d10+24", 15, "4", { walk: 30, burrow: 30 }],
  ["Crawler", "monstrosity", "medium", 45, "7d8+14", 14, "2", { walk: 30, climb: 30 }],
  ["Drake", "dragon", "large", 85, "10d10+30", 16, "5", { walk: 40, fly: 60 }],
  ["Guardian", "construct", "large", 95, "10d10+40", 18, "6", { walk: 30 }],
  ["Hound", "beast", "medium", 37, "5d8+15", 14, "2", { walk: 50 }],
  ["Leviathan", "monstrosity", "huge", 152, "16d12+48", 17, "9", { walk: 10, swim: 60 }],
  ["Marauder", "humanoid", "medium", 52, "8d8+16", 15, "3", { walk: 30 }],
  ["Moth", "beast", "large", 60, "8d10+16", 14, "3", { walk: 20, fly: 50 }],
  ["Seer", "aberration", "medium", 58, "9d8+18", 15, "4", { walk: 30 }],
  ["Serpent", "monstrosity", "large", 76, "9d10+27", 15, "4", { walk: 30, swim: 30 }],
  ["Stalker", "monstrosity", "medium", 49, "9d8+9", 15, "3", { walk: 40, climb: 20 }],
  ["Titan", "giant", "huge", 168, "16d12+64", 17, "10", { walk: 40 }],
];

const originals = [];
for (const [theme, texture] of themes) {
  for (const [archetype, creatureType, size, defaultHp, hitDice, ac, cr, partialSpeeds] of archetypes) {
    const id = `original-${theme.toLowerCase()}-${archetype.toLowerCase()}`;
    const speeds = { walk: 0, fly: null, swim: null, climb: null, burrow: null, ...partialSpeeds };
    originals.push({ id, name: `${theme} ${archetype}`, family: creatureType, creatureType, subtype: null,
      size, defaultHp, hitDice, armorClass: ac, challengeRating: cr, speeds,
      source: { kind: "original" },
      artDirection: `An original ${creatureType} known as the ${theme} ${archetype}, characterized by ${texture}; distinct readable fantasy creature anatomy.`,
    });
  }
}

const extraOriginals = [
  ["original-lantern-jelly", "Lantern Jelly", "ooze", "medium", 32, "5d8+10", 12, "2", { walk: 10, swim: 40 }, "A translucent aquatic ooze with warm lantern-like organs and long trailing filaments"],
  ["original-ruin-beak", "Ruin Beak", "monstrosity", "large", 72, "8d10+28", 15, "4", { walk: 40 }, "A massive flightless predatory bird armored in broken stone-like scales"],
  ["original-candle-wight", "Candle Wight", "undead", "medium", 45, "7d8+14", 14, "3", { walk: 30 }, "A wax-draped undead sentinel with many guttering candles growing from its shoulders"],
  ["original-river-knuckle", "River Knuckle", "elemental", "large", 90, "12d10+24", 16, "5", { walk: 30, swim: 50 }, "A broad freshwater elemental shaped from stones, roots, foam, and powerful grasping hands"],
  ["original-bell-tower-fiend", "Bell-Tower Fiend", "fiend", "huge", 157, "15d12+60", 18, "10", { walk: 40 }, "A tall iron-skinned fiend with a hollow bell-like torso and long clapper tail"],
  ["original-starved-oracle", "Starved Oracle", "aberration", "medium", 66, "12d8+12", 16, "5", { walk: 30 }, "An emaciated many-eyed oracle wrapped in parchment strips and orbiting stone tablets"],
  ["original-moss-crown-stag", "Moss-Crown Stag", "fey", "large", 75, "10d10+20", 15, "4", { walk: 60 }, "A supernatural stag crowned with branching mossy antlers, flowers, and tiny lights"],
  ["original-coffin-crab", "Coffin Crab", "monstrosity", "large", 88, "8d10+44", 18, "5", { walk: 30, burrow: 10 }, "A giant plated crab whose dark rectangular shell resembles an ancient stone coffin"],
  ["original-sky-ray", "Sky Ray", "beast", "huge", 120, "16d12+16", 15, "7", { walk: 0, fly: 80 }, "A colossal manta-like aerial creature with cloud-patterned wings and a long ribbon tail"],
  ["original-inkcap-giant", "Inkcap Giant", "plant", "large", 102, "12d10+36", 15, "6", { walk: 30 }, "A hulking fungal giant with a dripping black mushroom cap and rootlike fists"],
].map(([id, name, creatureType, size, defaultHp, hitDice, armorClass, cr, partialSpeeds, artDirection]) => ({
  id, name, family: creatureType, creatureType, subtype: null, size, defaultHp, hitDice, armorClass,
  challengeRating: cr, speeds: { walk: 0, fly: null, swim: null, climb: null, burrow: null, ...partialSpeeds },
  source: { kind: "original" }, artDirection,
}));

const indexResponse = await fetch(`${API_ROOT}/api/2014/monsters`);
if (!indexResponse.ok) throw new Error(`SRD index request failed: ${indexResponse.status}`);
const index = await indexResponse.json();
const srd = [];
for (let offset = 0; offset < index.results.length; offset += 12) {
  const group = index.results.slice(offset, offset + 12);
  const monsters = await Promise.all(group.map(async (entry) => {
    const response = await fetch(`${API_ROOT}${entry.url}`);
    if (!response.ok) throw new Error(`SRD request failed for ${entry.index}: ${response.status}`);
    return response.json();
  }));
  srd.push(...monsters.map(normalizeSrd));
}

const additions = [
  ...srd.filter((creature) => !existingIds.has(creature.id.replace(/^srd-/, ""))),
  ...campaignCreatures,
  ...originals.slice(0, 134),
  ...extraOriginals,
];
if (additions.length !== 483) throw new Error(`Expected 483 additions, got ${additions.length}.`);
const ids = new Set(additions.map((creature) => creature.id));
if (ids.size !== additions.length) throw new Error("Catalog additions contain duplicate IDs.");

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  targetProductionTotal: 500,
  existingProductionCount: 17,
  additions,
  attribution: "D&D SRD 5.1/5.2 by Wizards of the Coast LLC, CC BY 4.0; original art only.",
}, null, 2)}\n`);
console.log(`Wrote ${additions.length} additions (${srd.length} SRD records researched) to ${outputPath}`);
