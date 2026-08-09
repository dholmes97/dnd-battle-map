import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API_URL = "https://api.open5e.com/v2/creatures/";
const outputPath = resolve(process.argv[2] ?? "catalog/creatures-expansion-1000.json");
const existingCatalogPath = resolve("catalog/creatures.json");
const targetCount = 500;

// These are the packaged D1 seeds that predate catalog/creatures.json.
const packagedCreatureNames = [
  "Cave Bat", "Ember Imp", "Giant Rat", "Goblin Raider", "Gray Wolf",
  "Skeleton Guard", "Shambling Zombie", "Black Bear", "Mimic Chest",
  "Dire Wolf", "Giant Cave Spider", "Ogre Brute", "Owlbear",
  "Shadow Dire Warg", "Hungry Horror", "Young Green Dragon", "Ancient Treant",
];

const preferredDocuments = ["tob-2023", "ccdx", "tob2", "tob3"];
const allowedSizes = new Set(["tiny", "small", "medium", "large", "huge", "gargantuan"]);

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function slug(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/-+/g, "-");
}

function stableId(creature) {
  const base = `open5e-${slug(creature.key)}`;
  if (base.length <= 64) return base;
  const digest = createHash("sha256").update(creature.key).digest("hex").slice(0, 10);
  return `${base.slice(0, 53).replace(/-+$/g, "")}-${digest}`;
}

function speed(value, allowZero = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0)) return null;
  return Math.trunc(parsed);
}

function challengeRating(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if (parsed === 0.125) return "1/8";
  if (parsed === 0.25) return "1/4";
  if (parsed === 0.5) return "1/2";
  return Number.isInteger(parsed) ? String(parsed) : String(parsed);
}

function validCreature(creature) {
  return creature
    && creature.key
    && creature.name
    && creature.document?.key
    && creature.type?.key
    && allowedSizes.has(creature.size?.key)
    && Number.isInteger(creature.hit_points)
    && creature.hit_points > 0
    && Number.isInteger(creature.armor_class)
    && creature.armor_class > 0
    && creature.armor_class <= 40
    && typeof creature.hit_dice === "string"
    && creature.hit_dice.length > 0
    && challengeRating(creature.challenge_rating) !== null;
}

function normalizeCreature(creature) {
  const creatureType = slug(creature.type.key || creature.type.name);
  const walk = speed(creature.speed_all?.walk, true) ?? 0;
  return {
    id: stableId(creature),
    name: creature.name.trim(),
    family: creatureType,
    creatureType,
    subtype: null,
    size: creature.size.key,
    defaultHp: creature.hit_points,
    hitDice: creature.hit_dice,
    armorClass: creature.armor_class,
    challengeRating: challengeRating(creature.challenge_rating),
    speeds: {
      walk,
      fly: speed(creature.speed_all?.fly),
      swim: speed(creature.speed_all?.swim),
      climb: speed(creature.speed_all?.climb),
      burrow: speed(creature.speed_all?.burrow),
    },
    source: {
      kind: "open5e-v2",
      key: creature.key,
      documentKey: creature.document.key,
      documentName: creature.document.name,
      publisher: creature.document.publisher?.name ?? null,
      gameSystem: creature.document.gamesystem?.name ?? null,
      url: `${API_URL}${encodeURIComponent(creature.key)}/`,
    },
    artDirection: `Original top-down tactical fantasy depiction of ${creature.name}, a ${creature.size.name} ${creature.type.name}; transparent background, readable silhouette, no text or border.`,
    artStatus: "not-started",
  };
}

function diversify(creatures) {
  const buckets = new Map();
  for (const creature of creatures) {
    const key = creature.type.key;
    const bucket = buckets.get(key) ?? [];
    bucket.push(creature);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) =>
      Number(left.challenge_rating) - Number(right.challenge_rating)
      || left.name.localeCompare(right.name));
  }
  const types = [...buckets.keys()].sort();
  const diversified = [];
  while (types.length > 0) {
    for (let index = types.length - 1; index >= 0; index -= 1) {
      const bucket = buckets.get(types[index]);
      const creature = bucket.shift();
      if (creature) diversified.push(creature);
      if (bucket.length === 0) types.splice(index, 1);
    }
  }
  return diversified;
}

const existingCatalog = JSON.parse(await readFile(existingCatalogPath, "utf8"));
const usedNames = new Set([
  ...packagedCreatureNames,
  ...existingCatalog.additions.map((creature) => creature.name),
].map(normalizeName));
const usedIds = new Set(existingCatalog.additions.map((creature) => creature.id));

const fields = [
  "key", "name", "document", "type", "size", "challenge_rating",
  "armor_class", "hit_points", "hit_dice", "speed_all",
].join(",");
const response = await fetch(`${API_URL}?limit=5000&fields=${fields}`);
if (!response.ok) throw new Error(`Open5e request failed: ${response.status}`);
const payload = await response.json();
const researched = Array.isArray(payload.results) ? payload.results : [];

const eligible = researched.filter(validCreature);
const byDocument = new Map();
for (const creature of eligible) {
  const bucket = byDocument.get(creature.document.key) ?? [];
  bucket.push(creature);
  byDocument.set(creature.document.key, bucket);
}

const selected = [];
function take(creature) {
  const normalizedName = normalizeName(creature.name);
  const id = stableId(creature);
  if (!normalizedName || usedNames.has(normalizedName) || usedIds.has(id)) return false;
  usedNames.add(normalizedName);
  usedIds.add(id);
  selected.push(creature);
  return true;
}

// First retain every valid, genuinely new creature from the official 2024 SRD.
for (const creature of diversify(byDocument.get("srd-2024") ?? [])) take(creature);

// Fill the remaining slots evenly from four open-license 5e bestiaries. Round-robin
// source selection prevents the expansion from being dominated by one publisher or alphabet range.
const queues = new Map(preferredDocuments.map((key) => [key, diversify(byDocument.get(key) ?? [])]));
while (selected.length < targetCount) {
  let madeProgress = false;
  for (const documentKey of preferredDocuments) {
    const queue = queues.get(documentKey);
    while (queue.length > 0) {
      const creature = queue.shift();
      if (take(creature)) {
        madeProgress = true;
        break;
      }
    }
    if (selected.length === targetCount) break;
  }
  if (!madeProgress) break;
}

if (selected.length !== targetCount) {
  throw new Error(`Expected ${targetCount} non-duplicate creatures, selected ${selected.length}.`);
}

const creatures = selected.map(normalizeCreature);
const documentCounts = Object.fromEntries(
  [...Map.groupBy(creatures, (creature) => creature.source.documentKey)]
    .map(([key, values]) => [key, values.length])
    .sort(([left], [right]) => left.localeCompare(right)),
);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  phase: "metadata-only",
  existingProductionTotal: 500,
  targetProductionTotal: 1000,
  count: creatures.length,
  sourceSnapshot: {
    researchedOn: "2026-08-09",
    api: API_URL,
    apiVersion: "v2",
    availableCreatureCount: payload.count,
    selectedDocumentCounts: documentCounts,
    selection: "All non-duplicate SRD 5.2 creatures, then a source- and type-diverse round-robin from four open-license 5e bestiaries.",
  },
  attribution: "Metadata sourced through Open5e, a library of 5e material published under open licenses. Preserve the source document attribution for each record.",
  creatures,
}, null, 2)}\n`);

console.log(`Wrote ${creatures.length} metadata-only creatures to ${outputPath}`);
console.log(documentCounts);
