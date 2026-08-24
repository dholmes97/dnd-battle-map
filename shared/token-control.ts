import type { Role } from "./contracts";

export type ControllerIdentity = { identityId: string | null; name: string };
export type ControllableToken = {
  id: string;
  summonerTokenId?: string | null;
  summoner_token_id?: string | null;
  campaignCharacterId?: string | null;
  campaign_character_id?: string | null;
};

export function resolveTokenController(
  token: ControllableToken,
  tokenById: ReadonlyMap<string, ControllableToken>,
  controllerByCharacterId: ReadonlyMap<string, ControllerIdentity>,
  dungeonMaster: ControllerIdentity,
  visited = new Set<string>(),
): ControllerIdentity {
  if (visited.has(token.id)) return dungeonMaster;
  visited.add(token.id);
  const summonerId = token.summonerTokenId ?? token.summoner_token_id ?? null;
  const summoner = summonerId ? tokenById.get(summonerId) : null;
  if (summoner) return resolveTokenController(summoner, tokenById, controllerByCharacterId, dungeonMaster, visited);
  const characterId = token.campaignCharacterId ?? token.campaign_character_id ?? null;
  return characterId ? controllerByCharacterId.get(characterId) ?? dungeonMaster : dungeonMaster;
}

export function identityControlsToken(
  participant: { name: string; role: Role; identityId?: string | null; identity_id?: string | null },
  controller: ControllerIdentity,
): boolean {
  if (participant.role === "dm") return true;
  const identityId = participant.identityId ?? participant.identity_id ?? null;
  return identityId && controller.identityId
    ? identityId === controller.identityId
    : participant.name.toLocaleLowerCase() === controller.name.toLocaleLowerCase();
}
