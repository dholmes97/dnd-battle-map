import type { CreatureSize } from "./creature-library";

export const SPELL_EFFECT_KIND = "spell-effect";
export const SPELL_AREA_SIZES = ["medium", "large", "huge", "gargantuan"] as const;
export type SpellAreaSize = (typeof SPELL_AREA_SIZES)[number];

export type SpellEffectDefinition = {
  id: "moonbeam" | "flaming-sphere" | "magic-circle" | "generic-circle" | "generic-square";
  name: string;
  description: string;
  areaLabel: string;
  size: SpellAreaSize;
  artAsset: string;
  accent: string;
  shape: "circle" | "square" | null;
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
] as const;

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
