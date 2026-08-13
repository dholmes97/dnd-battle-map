export const FIXED_CHARACTER_CONTROLLERS = Object.freeze({
  "token-bronze-warden": "Dan",
  "token-ash-mystic": "Barry",
  "token-ember-scout": "Scott",
});

export type ControllableToken = { id: string; name: string; summonerTokenId?: string | null; summoner_token_id?: string | null };

export function baseTokenControllerName(token: ControllableToken): string {
  const normalizedName = String(token.name ?? "").toLocaleLowerCase();
  return FIXED_CHARACTER_CONTROLLERS[token.id as keyof typeof FIXED_CHARACTER_CONTROLLERS]
    ?? (normalizedName === "dar'eleth" ? "Dan" : null)
    ?? (normalizedName === "jelton" ? "Barry" : null)
    ?? (["malichar", "malichar jarom"].includes(normalizedName) ? "Scott" : null)
    ?? "Kevin";
}

export function resolveTokenControllerName(token: ControllableToken, tokenById: ReadonlyMap<string, ControllableToken>, visited = new Set<string>()): string {
  if (visited.has(token.id)) return "Kevin";
  visited.add(token.id);
  const summonerId = token.summonerTokenId ?? token.summoner_token_id ?? null;
  const summoner = summonerId ? tokenById.get(summonerId) : null;
  return summoner
    ? resolveTokenControllerName(summoner, tokenById, visited)
    : baseTokenControllerName(token);
}

export function identityControlsToken(participant: { name: string; role: Role }, controllerName: string): boolean {
  return participant.role === "dm"
    || participant.name.toLocaleLowerCase() === controllerName.toLocaleLowerCase();
}
import type { Role } from "./contracts";
