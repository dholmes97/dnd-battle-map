export type Beyond20HpSnapshot = { hp: number; maximumHp: number; temporaryHp: number };

export function beyond20HpTransition(current: { hp: number | null; maxHp: number | null; temporaryHp: number | null }, incoming: Beyond20HpSnapshot): { error: string } | { changed: boolean; decreased: boolean; hp: number; temporaryHp: number } {
  if (![incoming.hp, incoming.maximumHp, incoming.temporaryHp].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 100_000) || incoming.maximumHp < 1 || incoming.hp > incoming.maximumHp) return { error: "Invalid D&D Beyond HP values." } as const;
  if (current.maxHp !== incoming.maximumHp || current.hp === null) return { error: "Maximum HP differs between D&D Beyond and the map. Correct the map's maximum HP before enabling sync." } as const;
  return {
    changed: current.hp !== incoming.hp || (current.temporaryHp ?? 0) !== incoming.temporaryHp,
    decreased: incoming.hp < current.hp || incoming.temporaryHp < (current.temporaryHp ?? 0),
    hp: incoming.hp,
    temporaryHp: incoming.temporaryHp,
  };
}
