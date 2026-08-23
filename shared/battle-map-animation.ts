import type { SharedAnnotation, SharedToken } from "./contracts";
import { SPELL_EFFECT_KIND, spellEffectByArt } from "./spell-effects.ts";

const PING_PULSE_COUNT = 3;
const PING_PULSE_MS = 420;
export const PING_DURATION_MS = PING_PULSE_COUNT * PING_PULSE_MS;
export const SPOTLIGHT_DURATION_MS = 6_500;

function tokenHasEffect(token: SharedToken, effectName: string): boolean {
  const normalizedName = effectName.trim().toLocaleLowerCase();
  return token.effects.some((effect) => effect.name.trim().toLocaleLowerCase() === normalizedName);
}

export function spellArtUsesAnimation(artAsset: string | null): boolean {
  const spell = spellEffectByArt(artAsset);
  return Boolean(spell && spell.shape === null);
}

export function battleMapAnimationIsActive({
  annotations,
  tokens,
  pingStartedAt,
  spellPlacementArt,
  now,
}: {
  annotations: readonly SharedAnnotation[];
  tokens: readonly SharedToken[];
  pingStartedAt: ReadonlyMap<string, number>;
  spellPlacementArt: string | null;
  now: number;
}): boolean {
  const transientAnnotationIsActive = annotations.some((annotation) => {
    if (annotation.type === "ping") {
      const startedAt = pingStartedAt.get(annotation.id);
      return startedAt !== undefined && now >= startedAt && now - startedAt < PING_DURATION_MS;
    }
    return (annotation.type === "spotlight" || annotation.type === "neon-spotlight")
      && annotation.expiresAt !== null
      && annotation.expiresAt > now;
  });
  if (transientAnnotationIsActive || spellArtUsesAnimation(spellPlacementArt)) return true;
  return tokens.some((token) => (token.kind === SPELL_EFFECT_KIND && spellArtUsesAnimation(token.artAsset))
    || tokenHasEffect(token, "Bless")
    || tokenHasEffect(token, "Haste"));
}
