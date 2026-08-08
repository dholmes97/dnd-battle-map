export const FIXED_CHARACTER_CONTROLLERS = Object.freeze({
  "token-bronze-warden": "Dan",
  "token-ash-mystic": "Barry",
  "token-ember-scout": "Scott",
});

export function baseTokenControllerName(token) {
  const normalizedName = String(token.name ?? "").toLocaleLowerCase();
  return FIXED_CHARACTER_CONTROLLERS[token.id]
    ?? (normalizedName === "dar'eleth" ? "Dan" : null)
    ?? (normalizedName === "jelton" ? "Barry" : null)
    ?? (["malichar", "malichar jarom"].includes(normalizedName) ? "Scott" : null)
    ?? "Kevin";
}

export function resolveTokenControllerName(token, tokenById, visited = new Set()) {
  if (visited.has(token.id)) return "Kevin";
  visited.add(token.id);
  const summonerId = token.summonerTokenId ?? token.summoner_token_id ?? null;
  const summoner = summonerId ? tokenById.get(summonerId) : null;
  return summoner
    ? resolveTokenControllerName(summoner, tokenById, visited)
    : baseTokenControllerName(token);
}

export function identityControlsToken(participant, controllerName) {
  return participant.role === "dm"
    || participant.name.toLocaleLowerCase() === controllerName.toLocaleLowerCase();
}
