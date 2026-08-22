import type { ActionRow } from "../types.ts";

export type HistoryDirection = "undo" | "redo";

export type HistoryReplayInput = {
  direction: HistoryDirection;
  encounterId: string;
  participantId: string;
  actionType: string;
  payload: Record<string, unknown>;
  gridWidth: number;
  gridHeight: number;
  now: number;
  activeLeaderIds?: string[];
};

export interface HistoryRepository {
  listParticipantActions(encounterId: string, participantId: string): Promise<ActionRow[]>;
}
