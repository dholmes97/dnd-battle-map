import { deriveHistoryActionIds, isReversibleHistoryRow } from "../../shared/action-history.ts";
import { historyConflictMessage } from "../../shared/encounter-domain.ts";
import type { HistoryDirection, HistoryRepository } from "../ports/history-repository.ts";
import type { ActionRow } from "../types.ts";
import { commandError, type CommandContext, type CommandOutcome } from "./types.ts";

const REVERSIBLE_ACTION_TYPES = new Set([
  "token_moved",
  "hp_changed",
  "initiative_set",
  "initiative_group_set",
  "effect_added",
  "effect_removed",
  "annotation_added",
  "annotation_removed",
  "token_created",
  "token_updated",
]);

export type HistoryCommandContext = CommandContext & { repository: HistoryRepository };

export async function undo(context: HistoryCommandContext): Promise<CommandOutcome> {
  return applyHistory(context, "undo");
}

export async function redo(context: HistoryCommandContext): Promise<CommandOutcome> {
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
  const activeLeaderIds = initiativeAction && context.encounter.status === "active"
    ? await context.repository.activeLeaderIds(
      context.encounter.id,
      context.encounter.activeInitiativeOrder,
    )
    : [];
  const result = await context.repository.applyAction({
    direction,
    encounterId: context.encounter.id,
    participantId: context.participant.id,
    actionType: action.action_type,
    payload,
    gridWidth: context.encounter.gridWidth,
    gridHeight: context.encounter.gridHeight,
    now: context.now,
  });
  if (result.expectedChanges === 0 || result.changes !== result.expectedChanges) {
    return commandError(
      historyConflictMessage(direction === "undo" ? "undone" : "redone", action.action_type),
      409,
    );
  }
  if (initiativeAction) {
    await context.repository.rebuildInitiativeOrders(
      context.encounter.id,
      activeLeaderIds,
      context.now,
    );
  }
  await context.services.bumpEncounter();
  await context.services.recordAction(
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
