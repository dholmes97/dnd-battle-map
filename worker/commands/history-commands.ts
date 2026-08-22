import { deriveHistoryActionIds, isReversibleHistoryRow } from "../../shared/action-history.ts";
import { historyConflictMessage } from "../../shared/encounter-domain.ts";
import type { HistoryDirection, HistoryRepository, HistoryReplayInput } from "../ports/history-repository.ts";
import type { TokenEffectRepository } from "../ports/token-effect-repository.ts";
import type { AnnotationFogRepository } from "../ports/annotation-fog-repository.ts";
import type { InitiativeCombatRepository } from "../ports/initiative-combat-repository.ts";
import type { TokenRow } from "../types.ts";
import type { ActionRow } from "../types.ts";
import { commandError, type CommandContextFor, type CommandOutcome } from "./types.ts";

const REVERSIBLE_ACTION_TYPES = new Set([
  "token_moved",
  "hp_changed",
  "initiative_set",
  "initiative_group_set",
  "effect_added",
  "effect_removed",
  "annotation_added",
  "annotation_removed",
  "annotations_cleared",
  "token_created",
  "spell_effect_dismissed",
  "token_updated",
]);

export type HistoryCommandContext<Name extends "undo" | "redo" = "undo" | "redo"> =
  CommandContextFor<Name, {
    repository: HistoryRepository;
    tokenRepository: TokenEffectRepository;
    annotationRepository: AnnotationFogRepository;
    initiativeRepository: InitiativeCombatRepository;
    canControl(token: TokenRow): Promise<boolean>;
  }>;

export async function undo(context: HistoryCommandContext<"undo">): Promise<CommandOutcome> {
  return applyHistory(context, "undo");
}

export async function redo(context: HistoryCommandContext<"redo">): Promise<CommandOutcome> {
  return applyHistory(context, "redo");
}

async function applyHistory(
  context: HistoryCommandContext,
  direction: HistoryDirection,
): Promise<CommandOutcome> {
  const stacks = historyStacks(await context.repository.listParticipantActions(
    context.encounter.id,
    context.participant.id,
  ));
  const action = stacks[direction][0];
  if (!action) {
    return commandError(
      direction === "undo"
        ? "There is no reversible action in your ten-step history."
        : "There is no action available to redo.",
      409,
    );
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(action.payload_json) as Record<string, unknown>;
  } catch {
    return commandError("That historical action cannot be read safely.", 409);
  }
  const initiativeAction = action.action_type === "initiative_set" ||
    action.action_type === "initiative_group_set";
  if (!await replayIsAuthorized(context, action.action_type, payload)) {
    return commandError("That historical action is no longer authorized.", 403);
  }
  const activeLeaderIds = initiativeAction && context.encounter.status === "active"
    ? await context.initiativeRepository.activeLeaderIds(
      context.encounter.id,
      context.encounter.activeInitiativeOrder,
    )
    : [];
  const replayInput: HistoryReplayInput = {
    direction,
    encounterId: context.encounter.id,
    participantId: context.participant.id,
    actionType: action.action_type,
    payload,
    gridWidth: context.encounter.gridWidth,
    gridHeight: context.encounter.gridHeight,
    now: context.now,
    activeLeaderIds,
  };
  const changes = initiativeAction
    ? await context.initiativeRepository.replayHistoryAction(replayInput)
    : isAnnotationAction(action.action_type)
      ? await context.annotationRepository.replayHistoryAction(replayInput)
      : await context.tokenRepository.replayHistoryAction(replayInput);
  const expectedChanges = action.action_type === "initiative_group_set"
    ? members(payload).length
    : action.action_type === "annotations_cleared"
      ? annotations(payload).length
    : 1;
  if (expectedChanges === 0 || changes !== expectedChanges) {
    return commandError(
      historyConflictMessage(direction === "undo" ? "undone" : "redone", action.action_type),
      409,
    );
  }
  await context.services.commit(
    direction === "undo" ? "action_undone" : "action_redone",
    { actionId: action.id, actionType: action.action_type },
  );
  return {
    payload: {
      [direction === "undo" ? "undone" : "redone"]: true,
      actionType: action.action_type,
      state: await context.services.loadState(),
    },
  };
}

async function replayIsAuthorized(
  context: HistoryCommandContext,
  actionType: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (context.participant.role === "dm") return true;
  if (actionType === "initiative_group_set") return false;
  if (actionType === "initiative_set" && context.encounter.status !== "setup") return false;
  if (isAnnotationAction(actionType)) {
    const annotation = (payload.annotation ?? payload) as Record<string, unknown>;
    return annotation.createdBy === context.participant.id;
  }
  const snapshot = (payload.token ?? {}) as Record<string, unknown>;
  const effect = (payload.effect ?? payload) as Record<string, unknown>;
  const tokenId = cleanId(payload.tokenId) || cleanId(effect.tokenId);
  let token = tokenId
    ? await context.tokenRepository.findToken(context.encounter.id, tokenId)
    : null;
  if (!token) {
    const summonerTokenId = cleanId(snapshot.summonerTokenId);
    token = summonerTokenId
      ? await context.tokenRepository.findToken(context.encounter.id, summonerTokenId)
      : null;
  }
  return Boolean(token && await context.canControl(token));
}

function members(payload: Record<string, unknown>) {
  return Array.isArray(payload.members) ? payload.members as Array<Record<string, unknown>> : [];
}

function annotations(payload: Record<string, unknown>) {
  return Array.isArray(payload.annotations) ? payload.annotations as Array<Record<string, unknown>> : [];
}

function isAnnotationAction(actionType: string) {
  return actionType.startsWith("annotation_") || actionType === "annotations_cleared";
}

function cleanId(value: unknown) {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) : "";
}

function historyStacks(rows: ActionRow[]) {
  const eligible = rows.filter((row) => isReversibleHistoryRow(row, REVERSIBLE_ACTION_TYPES));
  const actions = new Map(
    eligible.filter((row) => REVERSIBLE_ACTION_TYPES.has(row.action_type)).map((row) => [row.id, row]),
  );
  const { undoIds, redoIds } = deriveHistoryActionIds([...eligible].reverse(), REVERSIBLE_ACTION_TYPES);
  return {
    undo: undoIds.slice(0, 10).map((id) => actions.get(id)!).filter(Boolean),
    redo: redoIds.slice(0, 10).map((id) => actions.get(id)!).filter(Boolean),
  };
}
