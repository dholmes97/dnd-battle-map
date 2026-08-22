import type {
  CommandName,
  CommandPayload,
  EncounterState,
  Role,
} from "../../shared/contracts.ts";

export type CommandEncounter = {
  id: string;
  code: string;
  name: string;
  version: number;
  status: "setup" | "active" | "paused";
  mapAsset: string;
  mapPackageJson: string | null;
  activeMapPresetId: string | null;
  gridWidth: number;
  gridHeight: number;
  currentRound: number;
  activeInitiativeOrder: number | null;
  strictMovement: boolean;
  updatedAt: number;
};

export type CommandParticipant = {
  id: string;
  name: string;
  role: Role;
};

export type CommandOutcome = {
  status?: number;
  payload: Record<string, unknown>;
};

export type CommandServices = {
  createId(): string;
  loadState(): Promise<EncounterState | null>;
  commit(actionType: string | null, payload?: Record<string, unknown>): Promise<void>;
  commitFor(input: {
    encounterId: string;
    expectedVersion?: number | null;
    participantId: string | null;
    actionType: string | null;
    payload?: Record<string, unknown>;
    bumpVersion?: boolean;
  }): Promise<void>;
};

export type CommandContext<Name extends CommandName = CommandName> = {
  encounter: CommandEncounter;
  participant: CommandParticipant;
  payload: CommandPayload<Name>;
  now: number;
  services: CommandServices;
};

export type CommandContextFor<Name extends CommandName, Extra extends object = object> =
  CommandContext<Name> & Extra;

export function commandError(error: string, status: number): CommandOutcome {
  return { status, payload: { error } };
}

export function requireDm(context: { participant: CommandParticipant }): CommandOutcome | null {
  return context.participant.role === "dm"
    ? null
    : commandError("This action requires the DM role.", 403);
}
