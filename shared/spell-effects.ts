import type { CreatureSize } from "./creature-library";

export const SPELL_EFFECT_KIND = "spell-effect";
export const SPELL_CONE_ART = "shape:spell-cone";
export const MAX_SPELL_CONE_RANGE_FEET = 300;
export const MAX_SPELL_CONE_ANGLE_DEGREES = 180;
export const SPELL_CONE_HANDLE_RADIUS_PX = 6;
export const SPELL_CONE_HINT_FEET = 10;
export type SpellCone = { rangeFeet: number; angleDegrees: number; directionDegrees: number };
export const DEFAULT_SPELL_CONE: Readonly<SpellCone> = { rangeFeet: 30, angleDegrees: 90, directionDegrees: 90 };
export const SPELL_AREA_SIZES = ["medium", "large", "huge", "gargantuan"] as const;
export type SpellAreaSize = (typeof SPELL_AREA_SIZES)[number];

export type SpellEffectDefinition = {
  id: "moonbeam" | "flaming-sphere" | "magic-circle" | "generic-circle" | "generic-square" | "spell-cone";
  name: string;
  description: string;
  areaLabel: string;
  size: SpellAreaSize;
  artAsset: string;
  accent: string;
  shape: "circle" | "square" | "cone" | null;
};

export const SPELL_EFFECTS: readonly SpellEffectDefinition[] = [
  {
    id: "moonbeam",
    name: "Moonbeam",
    description: "A rotating column of cold lunar radiance, celestial rings, and drifting star motes.",
    areaLabel: "10-ft diameter",
    size: "large",
    artAsset: "/assets/spells/moonbeam-vfx-source.png",
    accent: "#cdd9ff",
    shape: null,
  },
  {
    id: "flaming-sphere",
    name: "Flaming Sphere",
    description: "A searing vortex of living flame with a molten core, heat pulse, sparks, and embers.",
    areaLabel: "5-ft diameter",
    size: "medium",
    artAsset: "/assets/spells/flaming-sphere-vfx-source.png",
    accent: "#ff8a24",
    shape: null,
  },
  {
    id: "magic-circle",
    name: "Magic Circle",
    description: "A stationary ring of protective celestial runes, slowly turning with sacred light.",
    areaLabel: "10-ft radius",
    size: "gargantuan",
    artAsset: "/assets/spells/magic-circle-vfx.png",
    accent: "#ffe58f",
    shape: null,
  },
  {
    id: "generic-circle",
    name: "Spell Circle",
    description: "A flexible circular spell area for effects that do not yet have dedicated artwork.",
    areaLabel: "10-ft diameter by default",
    size: "large",
    artAsset: "shape:generic-circle",
    accent: "#76d7ff",
    shape: "circle",
  },
  {
    id: "generic-square",
    name: "Spell Square",
    description: "A flexible square spell area for effects that do not yet have dedicated artwork.",
    areaLabel: "10-ft square by default",
    size: "large",
    artAsset: "shape:generic-square",
    accent: "#c29aff",
    shape: "square",
  },
  {
    id: "spell-cone",
    name: "Spell Cone",
    description: "Place the tip at the source of a breath weapon or other cone attack.",
    areaLabel: "30-ft range · 90° spread by default",
    size: "medium",
    artAsset: SPELL_CONE_ART,
    accent: "#ffb77e",
    shape: "cone",
  },
] as const;

export function parseSpellCone(value: unknown): SpellCone | null {
  if (!value || typeof value !== "object") return null;
  const { rangeFeet, angleDegrees, directionDegrees } = value as Record<string, unknown>;
  if (!wholeNumberInRange(rangeFeet, 5, MAX_SPELL_CONE_RANGE_FEET) ||
      !wholeNumberInRange(angleDegrees, 1, MAX_SPELL_CONE_ANGLE_DEGREES) ||
      !isSpellConeDirection(directionDegrees)) return null;
  return { rangeFeet, angleDegrees, directionDegrees };
}

export function isSpellConeDirection(value: unknown): value is number {
  return wholeNumberInRange(value, 0, 359);
}

export function readSpellCone(serialized: string | null | undefined): SpellCone & { directionHint?: true } {
  try {
    const stored = serialized ? JSON.parse(serialized) : null;
    const cone = parseSpellCone(stored);
    if (!cone) return DEFAULT_SPELL_CONE;
    return stored.directionHint === true ? { ...cone, directionHint: true } : cone;
  } catch {
    return DEFAULT_SPELL_CONE;
  }
}

export function spellConeHintOffset(directionDegrees: number, feetPerCell: number) {
  const direction = (directionDegrees - 90) * Math.PI / 180;
  const length = SPELL_CONE_HINT_FEET / feetPerCell;
  return { x: Math.cos(direction) * length, y: Math.sin(direction) * length };
}

function wholeNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function spellConeGeometry(cone: SpellCone, feetPerCell: number, directionDegrees = cone.directionDegrees) {
  const direction = (directionDegrees - 90) * Math.PI / 180;
  const halfAngle = cone.angleDegrees * Math.PI / 360;
  return { radius: cone.rangeFeet / feetPerCell, direction, start: direction - halfAngle, end: direction + halfAngle };
}

export function spellConeCornerOffsets({ radius, start, end }: ReturnType<typeof spellConeGeometry>) {
  return [start, end].map((angle) => ({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) }));
}

export function rotateSpellConeDirection(directionDegrees: number, start: { x: number; y: number }, current: { x: number; y: number }) {
  const turn = Math.atan2(current.y, current.x) - Math.atan2(start.y, start.x);
  return ((Math.round(directionDegrees + turn * 180 / Math.PI) % 360) + 360) % 360;
}

export function pointInSpellCone(cone: SpellCone, feetPerCell: number, dx: number, dy: number): boolean {
  const { radius, direction, end } = spellConeGeometry(cone, feetPerCell);
  if (Math.hypot(dx, dy) > radius) return false;
  if (dx === 0 && dy === 0) return true;
  const offset = Math.atan2(dy, dx) - direction;
  return Math.abs(Math.atan2(Math.sin(offset), Math.cos(offset))) <= end - direction + 1e-9;
}

const SPELL_AREA_DIAMETERS: Record<SpellAreaSize, number> = {
  medium: 5,
  large: 10,
  huge: 15,
  gargantuan: 20,
};

export function isSpellAreaSize(value: unknown): value is SpellAreaSize {
  return typeof value === "string" && SPELL_AREA_SIZES.includes(value as SpellAreaSize);
}

export function spellAreaDiameter(size: CreatureSize): number {
  return SPELL_AREA_DIAMETERS[size as SpellAreaSize] ?? 5;
}

export function isSpellShapeArt(value: string | null): boolean {
  return Boolean(value?.startsWith("shape:"));
}

export function spellEffectById(value: unknown): SpellEffectDefinition | null {
  return SPELL_EFFECTS.find((spell) => spell.id === value) ?? null;
}

export function spellEffectByArt(value: string | null): SpellEffectDefinition | null {
  return SPELL_EFFECTS.find((spell) => spell.artAsset === value) ?? null;
}
