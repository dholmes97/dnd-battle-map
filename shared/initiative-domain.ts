export const ROSTER_GROUP_THRESHOLD = 3;

export function rosterBaseName(name: string): string {
  return name.replace(/\s+\d+$/, "").trim() || name;
}

export function rosterGroupKey(token: InitiativeToken): string {
  return `${rosterBaseName(token.name)}|${token.artAsset ?? ""}`;
}

export function initiativePackMembers<T extends InitiativeToken>(token: T, tokens: T[]): T[] {
  if (token.kind !== "monster" || token.summonerTokenId) return [token];
  const key = rosterGroupKey(token);
  return tokens.filter((candidate) =>
    candidate.kind === "monster" && !candidate.summonerTokenId && rosterGroupKey(candidate) === key);
}

export function compareTokenNames(a: InitiativeToken, b: InitiativeToken): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}

export function buildRosterRows<T extends InitiativeToken>(tokens: T[], inCombat: boolean, expandedGroups: ReadonlySet<string>): RosterRow<T>[] {
  const rosterTokens = tokens.filter((token) => token.kind !== "spell-effect");
  if (inCombat) {
    const rows: RosterRow<T>[] = [];
    const groups = new Map<string, T[]>();
    for (const token of [...rosterTokens].sort((a, b) => (a.initiativeOrder ?? 999) - (b.initiativeOrder ?? 999) || compareTokenNames(a, b))) {
      const key = token.initiativeOrder === null ? `untracked:${token.id}` : `initiative:${token.initiativeOrder}`;
      const members = groups.get(key);
      if (members) members.push(token); else groups.set(key, [token]);
    }
    for (const [key, members] of groups) {
      if (members.length === 1 || members[0].initiativeOrder === null) {
        rows.push({ type: "token", token: members[0], grouped: false });
        continue;
      }
      const leader = members.find((token) => !token.summonerTokenId) ?? members[0];
      const sameKind = members.every((token) => rosterBaseName(token.name) === rosterBaseName(leader.name));
      const expanded = expandedGroups.has(key);
      rows.push({ type: "group", key, label: sameKind ? rosterBaseName(leader.name) : `${leader.name}’s group`, tokens: members, expanded });
      if (expanded) for (const token of members) rows.push({ type: "token", token, grouped: true });
    }
    return rows;
  }

  const priority = (token: T): number => token.kind === "character" ? (token.controlledByViewer ? 0 : 1) : token.summonerTokenId ? 2 : 3;
  const rows: RosterRow<T>[] = rosterTokens
    .filter((token) => priority(token) < 3)
    .sort((a, b) => priority(a) - priority(b) || compareTokenNames(a, b))
    .map((token) => ({ type: "token", token, grouped: false }));
  const groups = new Map<string, T[]>();
  for (const token of rosterTokens.filter((token) => priority(token) === 3).sort(compareTokenNames)) {
    const key = rosterGroupKey(token);
    const bucket = groups.get(key);
    if (bucket) bucket.push(token); else groups.set(key, [token]);
  }
  for (const [key, members] of groups) {
    if (members.length < ROSTER_GROUP_THRESHOLD) {
      for (const token of members) rows.push({ type: "token", token, grouped: false });
      continue;
    }
    const expanded = expandedGroups.has(key);
    rows.push({ type: "group", key, label: rosterBaseName(members[0].name), tokens: members, expanded });
    if (expanded) for (const token of members) rows.push({ type: "token", token, grouped: true });
  }
  return rows;
}

export function orderedInitiativeGroups<T extends InitiativeToken>(leaders: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const leader of leaders
    .filter((token) => !token.summonerTokenId && token.initiative !== null)
    .sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0) || a.name.localeCompare(b.name))) {
    const key = leader.initiativeGroupId || leader.id;
    const members = groups.get(key);
    if (members) members.push(leader); else groups.set(key, [leader]);
  }
  return [...groups.values()].sort((a, b) =>
    (b[0].initiative ?? 0) - (a[0].initiative ?? 0) || a[0].name.localeCompare(b[0].name));
}

export function nextInitiativeTurn(orders: Array<number | null>, activeOrder: number | null, currentRound: number): { round: number; activeOrder: number | null; wrapped: boolean } {
  const sortedOrders = [...new Set(orders.filter((order): order is number => order !== null))].sort((a, b) => a - b);
  if (sortedOrders.length === 0) return { round: 0, activeOrder: null, wrapped: false };
  const currentIndex = activeOrder === null ? -1 : sortedOrders.indexOf(activeOrder);
  const wrapped = currentIndex < 0 || currentIndex === sortedOrders.length - 1;
  return {
    round: wrapped ? Math.max(1, currentRound + 1) : currentRound,
    activeOrder: wrapped ? sortedOrders[0] : sortedOrders[currentIndex + 1],
    wrapped,
  };
}

export function advanceEncounterTurn(current: EncounterState, completeCurrentGroup: boolean): EncounterState {
  const transition = nextInitiativeTurn(
    current.tokens.map((token) => token.initiativeOrder),
    current.encounter.activeInitiativeOrder,
    current.encounter.currentRound,
  );
  if (transition.activeOrder === null) return current;
  const active = current.encounter.activeInitiativeOrder ?? transition.activeOrder;
  return {
    ...current,
    encounter: { ...current.encounter, activeInitiativeOrder: transition.activeOrder, currentRound: transition.round },
    tokens: current.tokens.map((token) => token.initiativeOrder === transition.activeOrder
      ? { ...token, turnComplete: false, movementUsed: 0, movementOrigin: null }
      : completeCurrentGroup && token.initiativeOrder === active ? { ...token, turnComplete: true } : token),
  };
}
import type { EncounterState, SharedToken } from "./contracts";

type InitiativeToken = Pick<SharedToken, "id" | "name" | "kind" | "artAsset" | "summonerTokenId" | "initiative" | "initiativeGroupId" | "initiativeOrder" | "controlledByViewer">;
export type RosterRow<T extends InitiativeToken = InitiativeToken> = { type: "token"; token: T; grouped: boolean } | { type: "group"; key: string; label: string; tokens: T[]; expanded: boolean };
