import { nextInitiativeTurn, orderedInitiativeGroups } from "../../shared/initiative-domain.ts";
import type { InitiativeCombatRepository } from "../ports/initiative-combat-repository.ts";
import type { TokenRow } from "../types.ts";
import { commandError, requireDm, type CommandContextFor, type CommandOutcome } from "./types.ts";

type InitiativeCombatCommandName =
  | "set-initiative" | "set-initiative-group" | "start-combat"
  | "end-turn" | "advance-turn" | "correct-turn";
type InitiativeCombatDependencies = {
  repository: InitiativeCombatRepository;
  canControl(token: TokenRow): Promise<boolean>;
};
export type InitiativeCombatCommandContext<Name extends InitiativeCombatCommandName = InitiativeCombatCommandName> =
  CommandContextFor<Name, InitiativeCombatDependencies>;

export async function setInitiative(context: InitiativeCombatCommandContext<"set-initiative">): Promise<CommandOutcome> {
  const tokenId = cleanId(context.payload.tokenId);
  const initiative = wholeInitiative(context.payload.initiative);
  const token = await context.repository.findToken(context.encounter.id, tokenId);
  if (!token) return commandError("Token not found.", 404);
  if (!await context.canControl(token)) return commandError("You cannot set initiative for this token.", 403);
  if (context.encounter.status === "active" && context.participant.role !== "dm") {
    return commandError("Only the DM can correct initiative after combat starts.", 409);
  }
  if (initiative === null) return commandError("Initiative must be a whole number from 0 to 99.", 400);
  const active = await activeLeaders(context);
  const initiativeTokens = await context.repository.listInitiativeTokens(context.encounter.id);
  await context.repository.setInitiative(context.encounter.id, tokenId, initiative, context.now);
  await rebuildOrders(context, active, initiativeTokens.map((candidate) =>
    candidate.id === tokenId
      ? { ...candidate, initiative, initiative_group_id: null }
      : candidate
  ));
  await finish(context, "initiative_set", {
    tokenId,
    from: token.initiative,
    fromGroupId: token.initiative_group_id,
    to: initiative,
  });
  return success(context, { updated: true });
}

export async function setInitiativeGroup(context: InitiativeCombatCommandContext<"set-initiative-group">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const initiative = wholeInitiative(context.payload.initiative);
  if (initiative === null) return commandError("Initiative must be a whole number from 0 to 99.", 400);
  const tokenIds = [...new Set(
    context.payload.tokenIds.map(cleanId).filter(Boolean),
  )].slice(0, 100);
  if (tokenIds.length < 2) {
    return commandError("Choose at least two creatures for a shared initiative group.", 400);
  }
  const all = await context.repository.listInitiativeTokens(context.encounter.id);
  const tokens = all.filter((token) => tokenIds.includes(token.id));
  if (tokens.length !== tokenIds.length || tokens.some((token) => token.summoner_token_id)) {
    return commandError("Every initiative-group member must be a top-level creature in this encounter.", 400);
  }
  const active = await activeLeaders(context);
  const groupId = context.services.createId();
  await context.repository.setInitiativeGroup(
    context.encounter.id,
    tokenIds,
    initiative,
    groupId,
    context.now,
  );
  await rebuildOrders(context, active, all.map((candidate) =>
    tokenIds.includes(candidate.id)
      ? { ...candidate, initiative, initiative_group_id: groupId }
      : candidate
  ));
  await finish(context, "initiative_group_set", {
    groupId,
    to: initiative,
    members: tokens.map((token) => ({
      tokenId: token.id,
      from: token.initiative,
      fromGroupId: token.initiative_group_id,
    })),
  });
  return success(context, { updated: true, groupId });
}

export async function startCombat(context: InitiativeCombatCommandContext<"start-combat">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const groups = orderedGroups(await context.repository.listInitiativeTokens(context.encounter.id));
  if (!groups.length) return commandError("Enter at least one initiative before starting combat.", 409);
  await context.repository.startCombat(context.encounter.id, groups, context.now);
  await finish(context, "combat_started", {
    groups: groups.map((tokenIds, order) => ({ tokenIds, order })),
  });
  return success(context, { started: true });
}

export async function advanceTurn<Name extends "end-turn" | "advance-turn">(
  context: InitiativeCombatCommandContext<Name>,
  forced: Name extends "advance-turn" ? true : false,
): Promise<CommandOutcome> {
  const tokenId = "tokenId" in context.payload ? cleanId(context.payload.tokenId) : "";
  if (context.encounter.status !== "active") return commandError("Combat is not active.", 409);
  if (forced && context.participant.role !== "dm") {
    return commandError("Only the DM can force the next turn.", 403);
  }
  if (!forced) {
    const token = await context.repository.findToken(context.encounter.id, tokenId);
    if (!token) return commandError("Token not found.", 404);
    if (token.initiative_order !== context.encounter.activeInitiativeOrder) {
      return commandError("That token is not in the active turn group.", 409);
    }
    if (!await context.canControl(token)) return commandError("You cannot end this token's turn.", 403);
  }
  await context.repository.completeOrder(
    context.encounter.id,
    context.encounter.activeInitiativeOrder,
    context.now,
  );
  const transition = await nextTurn(context);
  await finish(context, "initiative_advanced", {
    tokenId: tokenId || null,
    ...transition,
    forced,
  });
  return success(context, { advanced: true, ...transition });
}

export async function correctTurn(context: InitiativeCombatCommandContext<"correct-turn">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const round = Math.max(1, Math.trunc(context.payload.round) || 1);
  const activeOrder = Math.trunc(context.payload.activeOrder);
  if (!await context.repository.orderExists(context.encounter.id, activeOrder)) {
    return commandError("Initiative position not found.", 404);
  }
  await context.repository.correctTurn(context.encounter.id, round, activeOrder, context.now);
  await finish(context, "initiative_corrected", { round, activeOrder });
  return success(context, { corrected: true });
}

async function activeLeaders(context: InitiativeCombatCommandContext) {
  return context.encounter.status === "active"
    ? context.repository.activeLeaderIds(context.encounter.id, context.encounter.activeInitiativeOrder)
    : [];
}

async function rebuildOrders(
  context: InitiativeCombatCommandContext,
  activeLeaderIds: string[],
  tokens = [] as Awaited<ReturnType<InitiativeCombatRepository["listInitiativeTokens"]>>,
) {
  if (context.encounter.status !== "active") return;
  const groups = orderedGroups(tokens.length
    ? tokens
    : await context.repository.listInitiativeTokens(context.encounter.id));
  const activeOrder = Math.max(0, groups.findIndex((members) =>
    members.some((id) => activeLeaderIds.includes(id))
  ));
  await context.repository.rebuildOrders(context.encounter.id, groups, activeOrder, context.now);
}

async function nextTurn(context: InitiativeCombatCommandContext) {
  const orders = await context.repository.listOrders(context.encounter.id);
  if (!orders.length) {
    await context.repository.exitCombat(context.encounter.id, context.now);
    return { round: 0, activeOrder: null };
  }
  const transition = nextInitiativeTurn(
    orders,
    context.encounter.activeInitiativeOrder,
    context.encounter.currentRound,
  );
  await context.repository.enterTurn(
    context.encounter.id,
    transition.round,
    transition.activeOrder!,
    context.now,
  );
  return transition;
}

function orderedGroups(tokens: Awaited<ReturnType<InitiativeCombatRepository["listInitiativeTokens"]>>) {
  return orderedInitiativeGroups(tokens.map((token) => ({
    id: token.id,
    name: token.name,
    initiative: token.initiative,
    initiativeGroupId: token.initiative_group_id,
    summonerTokenId: token.summoner_token_id,
    kind: "monster",
    artAsset: null,
    initiativeOrder: null,
    controlledByViewer: false,
  }))).map((members) => members.map((member) => member.id));
}

function cleanId(value: unknown) {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) : "";
}

function wholeInitiative(value: unknown) {
  const initiative = Math.trunc(Number(value));
  return Number.isInteger(initiative) && initiative >= 0 && initiative <= 99 ? initiative : null;
}

async function finish(
  context: InitiativeCombatCommandContext,
  type: string,
  payload: Record<string, unknown>,
) {
  await context.services.commit(type, payload);
}

async function success(
  context: InitiativeCombatCommandContext,
  payload: Record<string, unknown>,
): Promise<CommandOutcome> {
  return { payload: { ...payload, state: await context.services.loadState() } };
}
