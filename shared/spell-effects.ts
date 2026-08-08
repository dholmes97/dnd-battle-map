import type { CreatureSize } from "./creature-library";

export const SPELL_EFFECT_KIND = "spell-effect";

export type SpellEffectDefinition = {
  id: "moonbeam" | "flaming-sphere" | "magic-circle";
  name: string;
  description: string;
  areaLabel: string;
  size: CreatureSize;
  artAsset: string;
  accent: string;
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
  },
  {
    id: "flaming-sphere",
    name: "Flaming Sphere",
    description: "A searing vortex of living flame with a molten core, heat pulse, sparks, and embers.",
    areaLabel: "5-ft diameter",
    size: "medium",
    artAsset: "/assets/spells/flaming-sphere-vfx-source.png",
    accent: "#ff8a24",
  },
  {
    id: "magic-circle",
    name: "Magic Circle",
    description: "A stationary ring of protective celestial runes, slowly turning with sacred light.",
    areaLabel: "10-ft radius",
    size: "gargantuan",
    artAsset: "/assets/spells/magic-circle-vfx.png",
    accent: "#ffe58f",
  },
] as const;

export function spellEffectById(value: unknown): SpellEffectDefinition | null {
  return SPELL_EFFECTS.find((spell) => spell.id === value) ?? null;
}

export function spellEffectByArt(value: string | null): SpellEffectDefinition | null {
  return SPELL_EFFECTS.find((spell) => spell.artAsset === value) ?? null;
}
