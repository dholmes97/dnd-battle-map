import type { ActionRow } from "../types.ts";

export type HistoryDirection = "undo" | "redo";

export interface HistoryRepository {
  listParticipantActions(encounterId: string, participantId: string): Promise<ActionRow[]>;
  activeLeaderIds(encounterId: string, activeOrder: number | null): Promise<string[]>;
  applyAction(input: {
    direction: HistoryDirection;
    encounterId: string;
    participantId: string;
    actionType: string;
    payload: Record<string, unknown>;
    gridWidth: number;
    gridHeight: number;
    now: number;
  }): Promise<{ changes: number; expectedChanges: number }>;
  rebuildInitiativeOrders(
    encounterId: string,
    activeLeaderIds: string[],
    now: number,
  ): Promise<void>;
}
