import { defaultFogConfig } from "./fog-of-war.ts";
import { cleanHandoutTitle } from "./handout-domain.ts";
import { parseMapPackage, type MapBiome, type MapMood, type MapPackage } from "./map-package.ts";
import { isCreatureSize, type CreatureSize } from "./creature-library.ts";

export const SCENARIO_PROVISIONING_MANIFEST_VERSION = 1;
export const SCENARIO_PROVISIONING_MAX_MANIFEST_BYTES = 200_000;
export const SCENARIO_PROVISIONING_MAX_HANDOUTS = 12;
export const SCENARIO_PROVISIONING_MAX_CREATURES = 10;
export const SCENARIO_PROVISIONING_MAX_PLACEMENTS = 80;
export const SCENARIO_PROVISIONING_MAX_JOBS_PER_HOUR = 12;
export const SCENARIO_PROVISIONING_MAP_MAX_BYTES = 16 * 1024 * 1024;
export const SCENARIO_PROVISIONING_CREATURE_MAX_BYTES = 2 * 1024 * 1024;
export const SCENARIO_PROVISIONING_SOURCE_PIXELS_PER_CELL = 128;

export const SCENARIO_PROVISIONING_JOB_STATUSES = [
  "received",
  "parsing",
  "needs_clarification",
  "generating",
  "researching_creatures",
  "validating",
  "staging",
  "finalizing",
  "ready",
  "failed",
] as const;

export type ScenarioProvisioningJobStatus = typeof SCENARIO_PROVISIONING_JOB_STATUSES[number];
export type ScenarioProvisioningAssetKind =
  | "map"
  | "handout-display"
  | "handout-thumbnail"
  | "creature-original"
  | "creature-thumbnail";

export type ScenarioProvisioningAssetSpec = {
  id: string;
  kind: ScenarioProvisioningAssetKind;
  contentTypes: readonly string[];
  maxBytes: number;
  expectedWidth?: number;
  expectedHeight?: number;
};

export type ScenarioProvisioningSource = {
  provider: "gmail";
  mailboxKey: string;
  messageId: string;
  threadId: string;
  sender: string;
};

export type ScenarioProvisioningMap = {
  id: string;
  assetId: string;
  name: string;
  description: string;
  sourcePrompt: string | null;
  biome: MapBiome;
  mood: MapMood;
  width: number;
  height: number;
  fog: MapPackage["fog"];
  labels: MapPackage["labels"];
  notes: MapPackage["notes"];
};

export type ScenarioProvisioningHandout = {
  id: string;
  title: string;
  displayAssetId: string;
  thumbnailAssetId: string;
  replaceHandoutId: string | null;
};

export type ScenarioProvisioningCreaturePlacement = {
  id: string;
  name: string | null;
  x: number;
  y: number;
  hp: number | null;
  maxHp: number | null;
  hidden: boolean;
};

export type ScenarioProvisioningNewCreature = {
  name: string;
  family: string;
  creatureType: string;
  size: CreatureSize;
  defaultHp: number;
  hitDice: string | null;
  armorClass: number;
  challengeRating: string | null;
  speeds: {
    walk: number;
    fly: number | null;
    swim: number | null;
    climb: number | null;
    burrow: number | null;
  };
  originalAssetId: string;
  thumbnailAssetId: string;
  provenance: string[];
};

export type ScenarioProvisioningCreature = {
  catalogId: string;
  create: ScenarioProvisioningNewCreature | null;
  placements: ScenarioProvisioningCreaturePlacement[];
};

export type ScenarioProvisioningManifest = {
  version: 1;
  idempotencyKey: string;
  revision: number;
  operation: "create" | "revise";
  targetScenarioCode: string | null;
  source: ScenarioProvisioningSource;
  scenario: {
    name: string;
    briefing: string;
    presetName: string;
    presetDescription: string;
  };
  settings: { strictMovement: boolean | null };
  party: {
    include: boolean;
    sourceScenarioCode: string;
    placements: Array<{ name: string; x: number; y: number }>;
  };
  map: ScenarioProvisioningMap | null;
  handouts: ScenarioProvisioningHandout[];
  creatures: ScenarioProvisioningCreature[];
  assumptions: string[];
  reviewWarnings: string[];
};

export type ScenarioProvisioningManifestResult =
  | { ok: true; manifest: ScenarioProvisioningManifest; canonicalJson: string }
  | { ok: false; errors: string[] };

const JOB_STATUS_SET: ReadonlySet<string> = new Set(SCENARIO_PROVISIONING_JOB_STATUSES);
const BIOMES: ReadonlySet<string> = new Set(["forest", "dungeon", "cave", "ruins", "swamp", "desert", "tundra", "volcanic", "coast"]);
const MOODS: ReadonlySet<string> = new Set(["daylight", "overcast", "moonlight", "torchlight"]);
const ASSET_KINDS: ReadonlySet<string> = new Set(["map", "handout-display", "handout-thumbnail", "creature-original", "creature-thumbnail"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
}

function cleanMultilineText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().replace(/\r\n?/g, "\n").slice(0, maximum) : "";
}

function cleanId(value: unknown, maximum = 96): string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) && value.length <= maximum ? value : "";
}

function cleanCode(value: unknown): string {
  return typeof value === "string"
    ? value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24)
    : "";
}

function finite(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function integer(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = finite(value, minimum, maximum);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function nullableInteger(value: unknown, minimum: number, maximum: number): number | null {
  return value === null || value === undefined || value === "" ? null : integer(value, minimum, maximum);
}

function stringList(value: unknown, maximumItems: number, maximumLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const result = value.map((item) => cleanMultilineText(item, maximumLength)).filter(Boolean);
  return result.length === value.length ? result : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  const item = record(value);
  if (!item) return value;
  return Object.fromEntries(Object.keys(item).sort().map((key) => [key, stableValue(item[key])]));
}

export function canonicalScenarioProvisioningJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function parseSource(value: unknown, errors: string[]): ScenarioProvisioningSource | null {
  const item = record(value);
  if (!item || item.provider !== "gmail") {
    errors.push("source.provider must be gmail.");
    return null;
  }
  const mailboxKey = cleanId(item.mailboxKey, 80);
  const messageId = cleanText(item.messageId, 200);
  const threadId = cleanText(item.threadId, 200);
  const sender = cleanText(item.sender, 254).toLowerCase();
  if (!mailboxKey || !messageId || !threadId || !EMAIL_PATTERN.test(sender)) {
    errors.push("source must include a valid mailbox key, Gmail message/thread IDs, and sender email.");
    return null;
  }
  return { provider: "gmail", mailboxKey, messageId, threadId, sender };
}

function parseMap(value: unknown, errors: string[]): ScenarioProvisioningMap | null {
  if (value === null || value === undefined) return null;
  const item = record(value);
  if (!item) {
    errors.push("map must be an object.");
    return null;
  }
  const id = cleanId(item.id);
  const assetId = cleanId(item.assetId);
  const name = cleanText(item.name, 100);
  const description = cleanMultilineText(item.description, 500);
  const sourcePrompt = cleanMultilineText(item.sourcePrompt, 4_000) || null;
  const width = integer(item.width, 8, 48);
  const height = integer(item.height, 8, 48);
  const biome = BIOMES.has(String(item.biome)) ? item.biome as MapBiome : null;
  const mood = MOODS.has(String(item.mood)) ? item.mood as MapMood : null;
  if (!id || !assetId || !name || width === null || height === null || !biome || !mood) {
    errors.push("map requires valid id, assetId, name, biome, mood, width, and height.");
    return null;
  }
  const fog = item.fog ?? defaultFogConfig(width, height);
  const labels = item.labels ?? [];
  const notes = item.notes ?? [];
  const testPackage = parseMapPackage({
    format: "dnd-battle-map",
    version: 1,
    id,
    name,
    description,
    biome,
    mood,
    seed: id.toUpperCase(),
    width,
    height,
    visual: {
      kind: "generated-scene",
      assetUrl: `/map-assets/provisioned/placeholder/${assetId}.jpg`,
      pixelWidth: width * SCENARIO_PROVISIONING_SOURCE_PIXELS_PER_CELL,
      pixelHeight: height * SCENARIO_PROVISIONING_SOURCE_PIXELS_PER_CELL,
    },
    walls: [],
    portals: [],
    labels,
    notes,
    fog,
    source: { kind: "generated-scene" },
    createdAt: 0,
  });
  if (!testPackage) {
    errors.push("map labels, notes, or fog geometry are invalid or exceed map limits.");
    return null;
  }
  return { id, assetId, name, description, sourcePrompt, biome, mood, width, height, fog: testPackage.fog, labels: testPackage.labels, notes: testPackage.notes };
}

function parseHandouts(value: unknown, errors: string[]): ScenarioProvisioningHandout[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > SCENARIO_PROVISIONING_MAX_HANDOUTS) {
    errors.push(`handouts must contain at most ${SCENARIO_PROVISIONING_MAX_HANDOUTS} items.`);
    return [];
  }
  const result: ScenarioProvisioningHandout[] = [];
  for (const raw of value) {
    const item = record(raw);
    const id = cleanId(item?.id);
    const title = cleanHandoutTitle(item?.title);
    const displayAssetId = cleanId(item?.displayAssetId);
    const thumbnailAssetId = cleanId(item?.thumbnailAssetId);
    const replaceHandoutId = item?.replaceHandoutId === null || item?.replaceHandoutId === undefined
      ? null
      : cleanId(item.replaceHandoutId, 64);
    if (!item || !id || !title || !displayAssetId || !thumbnailAssetId || (item.replaceHandoutId && !replaceHandoutId)) {
      errors.push("every handout requires valid id, title, displayAssetId, and thumbnailAssetId.");
      continue;
    }
    result.push({ id, title, displayAssetId, thumbnailAssetId, replaceHandoutId });
  }
  return result;
}

function parseSpeed(value: unknown): { valid: boolean; value: number | null } {
  if (value === null || value === undefined || value === "") return { valid: true, value: null };
  const parsed = integer(value, 0, 240);
  return { valid: parsed !== null, value: parsed };
}

function parseNewCreature(value: unknown, errors: string[]): ScenarioProvisioningNewCreature | null {
  if (value === null || value === undefined) return null;
  const item = record(value);
  const speeds = record(item?.speeds);
  const name = cleanText(item?.name, 80);
  const family = cleanText(item?.family, 32).toLowerCase();
  const creatureType = cleanText(item?.creatureType, 32).toLowerCase();
  const size = isCreatureSize(item?.size) ? item.size : null;
  const defaultHp = integer(item?.defaultHp, 1, 10_000);
  const armorClass = integer(item?.armorClass, 1, 40);
  const walk = parseSpeed(speeds?.walk);
  const fly = parseSpeed(speeds?.fly);
  const swim = parseSpeed(speeds?.swim);
  const climb = parseSpeed(speeds?.climb);
  const burrow = parseSpeed(speeds?.burrow);
  const hitDice = cleanText(item?.hitDice, 24) || null;
  const challengeRating = cleanText(item?.challengeRating, 12) || null;
  const originalAssetId = cleanId(item?.originalAssetId);
  const thumbnailAssetId = cleanId(item?.thumbnailAssetId);
  const provenance = stringList(item?.provenance ?? [], 12, 500);
  if (!item || !speeds || !name || !family || !creatureType || !size || defaultHp === null || armorClass === null || walk.value === null || !fly.valid || !swim.valid || !climb.valid || !burrow.valid || !originalAssetId || !thumbnailAssetId || !provenance) {
    errors.push("new creature metadata is incomplete or invalid.");
    return null;
  }
  return {
    name,
    family,
    creatureType,
    size,
    defaultHp,
    hitDice,
    armorClass,
    challengeRating,
    speeds: {
      walk: walk.value,
      fly: fly.value,
      swim: swim.value,
      climb: climb.value,
      burrow: burrow.value,
    },
    originalAssetId,
    thumbnailAssetId,
    provenance,
  };
}

function parsePlacement(value: unknown, errors: string[]): ScenarioProvisioningCreaturePlacement | null {
  const item = record(value);
  const id = cleanId(item?.id, 64);
  const x = finite(item?.x, 0, 48);
  const y = finite(item?.y, 0, 48);
  const hp = nullableInteger(item?.hp, 1, 10_000);
  const maxHp = nullableInteger(item?.maxHp, 1, 10_000);
  const name = cleanText(item?.name, 80) || null;
  const hpInvalid = item?.hp !== undefined && item.hp !== null && item.hp !== "" && hp === null;
  const maxHpInvalid = item?.maxHp !== undefined && item.maxHp !== null && item.maxHp !== "" && maxHp === null;
  if (!item || !id || x === null || y === null || hpInvalid || maxHpInvalid || (hp !== null && maxHp !== null && hp > maxHp)) {
    errors.push("creature placements require valid id, coordinates, and optional HP values.");
    return null;
  }
  return { id, name, x, y, hp, maxHp, hidden: item.hidden === true };
}

function parseCreatures(value: unknown, errors: string[]): ScenarioProvisioningCreature[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > SCENARIO_PROVISIONING_MAX_CREATURES) {
    errors.push(`creatures must contain at most ${SCENARIO_PROVISIONING_MAX_CREATURES} catalog entries.`);
    return [];
  }
  const result: ScenarioProvisioningCreature[] = [];
  let placementCount = 0;
  for (const raw of value) {
    const item = record(raw);
    const catalogId = cleanId(item?.catalogId, 64).toLowerCase();
    const create = parseNewCreature(item?.create, errors);
    const rawPlacements = item?.placements;
    if (!item || !catalogId || !Array.isArray(rawPlacements) || rawPlacements.length < 1) {
      errors.push("every creature entry requires catalogId and at least one placement.");
      continue;
    }
    const placements = rawPlacements.map((placement) => parsePlacement(placement, errors)).filter((placement): placement is ScenarioProvisioningCreaturePlacement => Boolean(placement));
    placementCount += placements.length;
    result.push({ catalogId, create, placements });
  }
  if (placementCount > SCENARIO_PROVISIONING_MAX_PLACEMENTS) errors.push(`creatures may contain at most ${SCENARIO_PROVISIONING_MAX_PLACEMENTS} placements.`);
  return result;
}

function parseParty(value: unknown, errors: string[]): ScenarioProvisioningManifest["party"] {
  const item = record(value) ?? {};
  const include = item.include !== false;
  const sourceScenarioCode = cleanCode(item.sourceScenarioCode) || "EMBER-KEEP";
  const rawPlacements = item.placements ?? [];
  if (!Array.isArray(rawPlacements) || rawPlacements.length > 4) {
    errors.push("party.placements must contain at most four items.");
    return { include, sourceScenarioCode, placements: [] };
  }
  const placements = rawPlacements.map((raw) => {
    const placement = record(raw);
    const name = cleanText(placement?.name, 80);
    const x = finite(placement?.x, 0, 48);
    const y = finite(placement?.y, 0, 48);
    return name && x !== null && y !== null ? { name, x, y } : null;
  });
  if (placements.some((placement) => !placement)) errors.push("party placements require name, x, and y.");
  return { include, sourceScenarioCode, placements: placements.filter((placement): placement is { name: string; x: number; y: number } => Boolean(placement)) };
}

export function parseScenarioProvisioningManifest(value: unknown): ScenarioProvisioningManifestResult {
  const errors: string[] = [];
  let serialized = "";
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { ok: false, errors: ["manifest must be JSON serializable."] };
  }
  if (serialized.length > SCENARIO_PROVISIONING_MAX_MANIFEST_BYTES) return { ok: false, errors: ["manifest is too large."] };
  const item = record(value);
  if (!item || item.version !== SCENARIO_PROVISIONING_MANIFEST_VERSION) return { ok: false, errors: ["manifest version must be 1."] };
  const idempotencyKey = cleanId(item.idempotencyKey, 160);
  const revision = integer(item.revision, 1, 10_000);
  const operation = item.operation === "revise" ? "revise" : item.operation === "create" ? "create" : null;
  const targetScenarioCode = item.targetScenarioCode === null || item.targetScenarioCode === undefined ? null : cleanCode(item.targetScenarioCode);
  const source = parseSource(item.source, errors);
  const scenarioValue = record(item.scenario);
  const scenarioName = cleanText(scenarioValue?.name, 64);
  const scenario = {
    name: scenarioName,
    briefing: cleanMultilineText(scenarioValue?.briefing, 8_000),
    presetName: cleanText(scenarioValue?.presetName, 72) || scenarioName,
    presetDescription: cleanMultilineText(scenarioValue?.presetDescription, 500),
  };
  const settingsValue = record(item.settings) ?? {};
  const strictMovement = typeof settingsValue.strictMovement === "boolean" ? settingsValue.strictMovement : null;
  const party = parseParty(item.party, errors);
  const map = parseMap(item.map, errors);
  const handouts = parseHandouts(item.handouts, errors);
  const creatures = parseCreatures(item.creatures, errors);
  const assumptions = stringList(item.assumptions ?? [], 30, 500);
  const reviewWarnings = stringList(item.reviewWarnings ?? [], 30, 500);
  if (!idempotencyKey || revision === null || !operation || !source || !scenarioName || !assumptions || !reviewWarnings) errors.push("manifest identity, operation, source, scenario name, assumptions, or warnings are invalid.");
  if (operation === "create" && !map) errors.push("a new scenario requires a map.");
  if (operation === "create" && handouts.some((handout) => handout.replaceHandoutId)) errors.push("a new scenario cannot replace an existing handout.");
  if (operation === "revise" && !targetScenarioCode) errors.push("a revision requires targetScenarioCode.");
  if (operation === "create" && targetScenarioCode) errors.push("a new scenario cannot specify targetScenarioCode.");
  if (operation === "revise" && party.include) errors.push("a revision cannot recopy the player party.");
  if (operation === "create" && !party.include && creatures.every((creature) => creature.placements.length === 0)) errors.push("a new scenario must include the established party or at least one creature token.");
  const ids = requiredScenarioProvisioningAssets({ map, handouts, creatures });
  if (new Set(ids.map((asset) => asset.id)).size !== ids.length) errors.push("every referenced asset ID must be unique.");
  const catalogIds = creatures.map((creature) => creature.catalogId);
  if (new Set(catalogIds).size !== catalogIds.length) errors.push("every catalogId may appear only once per manifest.");
  const placementIds = creatures.flatMap((creature) => creature.placements.map((placement) => placement.id));
  if (new Set(placementIds).size !== placementIds.length) errors.push("every creature placement ID must be unique.");
  const handoutIds = handouts.map((handout) => handout.id);
  if (new Set(handoutIds).size !== handoutIds.length) errors.push("every handout ID must be unique.");
  if (errors.length || !idempotencyKey || revision === null || !operation || !source || !assumptions || !reviewWarnings) return { ok: false, errors: [...new Set(errors)] };
  const manifest: ScenarioProvisioningManifest = {
    version: 1,
    idempotencyKey,
    revision,
    operation,
    targetScenarioCode,
    source,
    scenario,
    settings: { strictMovement },
    party,
    map,
    handouts,
    creatures,
    assumptions,
    reviewWarnings,
  };
  return { ok: true, manifest, canonicalJson: canonicalScenarioProvisioningJson(manifest) };
}

export function requiredScenarioProvisioningAssets(input: Pick<ScenarioProvisioningManifest, "map" | "handouts" | "creatures">): ScenarioProvisioningAssetSpec[] {
  const result: ScenarioProvisioningAssetSpec[] = [];
  if (input.map) result.push({
    id: input.map.assetId,
    kind: "map",
    contentTypes: ["image/jpeg"],
    maxBytes: SCENARIO_PROVISIONING_MAP_MAX_BYTES,
    expectedWidth: input.map.width * SCENARIO_PROVISIONING_SOURCE_PIXELS_PER_CELL,
    expectedHeight: input.map.height * SCENARIO_PROVISIONING_SOURCE_PIXELS_PER_CELL,
  });
  for (const handout of input.handouts) {
    result.push({ id: handout.displayAssetId, kind: "handout-display", contentTypes: ["image/webp", "image/jpeg"], maxBytes: 1_500_000 });
    result.push({ id: handout.thumbnailAssetId, kind: "handout-thumbnail", contentTypes: ["image/webp", "image/jpeg"], maxBytes: 120_000 });
  }
  for (const creature of input.creatures) if (creature.create) {
    result.push({ id: creature.create.originalAssetId, kind: "creature-original", contentTypes: ["image/png"], maxBytes: SCENARIO_PROVISIONING_CREATURE_MAX_BYTES });
    result.push({ id: creature.create.thumbnailAssetId, kind: "creature-thumbnail", contentTypes: ["image/png"], maxBytes: SCENARIO_PROVISIONING_CREATURE_MAX_BYTES });
  }
  return result;
}

export function buildProvisionedMapPackage(map: ScenarioProvisioningMap, jobId: string, now: number): MapPackage {
  const parsed = parseMapPackage({
    format: "dnd-battle-map",
    version: 1,
    id: map.id,
    name: map.name,
    description: map.description,
    biome: map.biome,
    mood: map.mood,
    seed: map.id.toUpperCase(),
    width: map.width,
    height: map.height,
    visual: {
      kind: "generated-scene",
      assetUrl: `/map-assets/provisioned/${jobId}/${map.assetId}.jpg`,
      pixelWidth: map.width * SCENARIO_PROVISIONING_SOURCE_PIXELS_PER_CELL,
      pixelHeight: map.height * SCENARIO_PROVISIONING_SOURCE_PIXELS_PER_CELL,
    },
    walls: [],
    portals: [],
    labels: map.labels,
    notes: map.notes,
    fog: map.fog,
    source: { kind: "generated-scene" },
    createdAt: now,
  });
  if (!parsed) throw new Error("Provisioned map package failed validated construction.");
  return parsed;
}

const ALLOWED_TRANSITIONS: Record<ScenarioProvisioningJobStatus, ReadonlySet<ScenarioProvisioningJobStatus>> = {
  received: new Set(["parsing", "needs_clarification", "generating", "researching_creatures", "validating", "staging", "failed"]),
  parsing: new Set(["needs_clarification", "generating", "researching_creatures", "validating", "staging", "failed"]),
  needs_clarification: new Set(["parsing", "failed"]),
  generating: new Set(["researching_creatures", "validating", "staging", "failed"]),
  researching_creatures: new Set(["generating", "validating", "staging", "failed"]),
  validating: new Set(["needs_clarification", "staging", "finalizing", "failed"]),
  staging: new Set(["validating", "finalizing", "failed"]),
  finalizing: new Set(["ready", "failed"]),
  ready: new Set(),
  failed: new Set(["parsing", "validating", "staging", "finalizing"]),
};

export function isScenarioProvisioningJobStatus(value: unknown): value is ScenarioProvisioningJobStatus {
  return typeof value === "string" && JOB_STATUS_SET.has(value);
}

export function scenarioProvisioningTransitionError(from: ScenarioProvisioningJobStatus, to: ScenarioProvisioningJobStatus): string | null {
  if (from === to) return null;
  return ALLOWED_TRANSITIONS[from].has(to) ? null : `A provisioning job cannot move from ${from} to ${to}.`;
}

export function isScenarioProvisioningAssetKind(value: unknown): value is ScenarioProvisioningAssetKind {
  return typeof value === "string" && ASSET_KINDS.has(value);
}

export function inspectPng(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) return null;
  const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
  const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
  return width > 0 && height > 0 ? { width, height } : null;
}
