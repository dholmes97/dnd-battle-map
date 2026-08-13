import type { CreatureSize } from "./creature-library";
import type { MapPackage } from "./map-package";
import type { HealthBand } from "./health";

export type Role = "player" | "dm";
export type EncounterStatus = "setup" | "active" | "paused";
export type MapPoint = { x: number; y: number };

export type SharedEffect = {
  id: string;
  name: string;
  type: string;
  durationRounds: number | null;
  expiresRound: number | null;
  reminderTiming: string;
  due: boolean;
};

export type SharedToken = MapPoint & {
  id: string;
  name: string;
  artAsset: string | null;
  kind: string;
  size: CreatureSize;
  speed: number;
  hp: number | null;
  maxHp: number | null;
  healthState: HealthBand | null;
  hidden: boolean;
  summonerTokenId: string | null;
  initiative: number | null;
  initiativeGroupId: string | null;
  initiativeOrder: number | null;
  turnComplete: boolean;
  movementUsed: number;
  movementOrigin: MapPoint | null;
  effects: SharedEffect[];
  controller: { name: string };
  controlledByViewer: boolean;
};

export type SharedAnnotation = {
  id: string;
  type: "ping" | "drawing" | "spotlight" | "neon-spotlight";
  x: number;
  y: number;
  x2: number | null;
  y2: number | null;
  color: string;
  label: string | null;
  createdBy: string;
  expiresAt: number | null;
};

export type SharedHandoutReference = {
  id: string;
  title: string;
  width: number | null;
  height: number | null;
  updatedAt: number | null;
  available: boolean;
};

export type SharedChatMessage = {
  id: string;
  senderName: string;
  senderRole: Role;
  recipientName: string | null;
  body: string;
  showImmediately: boolean;
  handout: SharedHandoutReference | null;
  createdAt: number;
};

export type SharedHandout = {
  id: string;
  title: string;
  width: number;
  height: number;
  displayBytes: number;
  thumbnailBytes: number;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
};

export type SavedMapPreset = {
  id: string;
  name: string;
  description: string;
  sourcePrompt: string | null;
  mapPackage: MapPackage;
  createdAt: number;
  updatedAt: number;
};

export type FogVisibility = {
  mode: "off" | "shared" | "dynamic";
  polygons: MapPoint[][];
  hiddenPolygon?: MapPoint[];
  revealedCircles?: MapPackage["fog"]["circles"];
  geometry?: Pick<MapPackage["fog"], "walls" | "doors" | "circles">;
};

export type EncounterState = {
  encounter: {
    code: string;
    name: string;
    version: number;
    status: EncounterStatus;
    mapPackage: MapPackage | null;
    activeMapPresetId: string | null;
    currentRound: number;
    activeInitiativeOrder: number | null;
    strictMovement: boolean;
    fogVisibility: FogVisibility;
    updatedAt: number;
  };
  grid: { width: number; height: number; feetPerCell: number };
  viewer: null | { id: string; role: Role };
  undo: { available: number; redoAvailable: number; lastAction: string | null; nextRedoAction: string | null };
  tokens: SharedToken[];
  annotations: SharedAnnotation[];
  chatMessages: SharedChatMessage[];
  handouts: SharedHandout[];
  savedMapPresets: SavedMapPreset[];
  availableArt: string[];
};

export type ParticipantSession = { id: string; name: string; role: Role; sessionSecret: string };

export const COMMAND_NAMES = [
  "send-chat-message", "delete-handout", "undo", "redo", "rename-scenario",
  "create-scenario", "set-initiative", "set-initiative-group", "end-turn",
  "advance-turn", "start-combat", "correct-turn", "save-map-preset",
  "delete-map-preset", "apply-map-package", "configure-encounter",
  "set-strict-movement", "set-fog-mode", "set-vision-door-open",
  "update-shared-fog", "create-spell-effect", "create-token",
  "resize-spell-effect", "update-token", "apply-hp", "add-effect",
  "remove-effect", "add-annotation", "remove-annotation", "clear-annotations",
  "delete-token",
] as const;

export type CommandName = typeof COMMAND_NAMES[number];
export type CommandRequest = { [Name in CommandName]: { command: Name } & Record<string, unknown> }[CommandName];
export type CommandPayload<Name extends CommandName> = Omit<Extract<CommandRequest, { command: Name }>, "command">;
export type CommandResponse = { state: EncounterState } & Record<string, unknown>;

const COMMAND_NAME_SET: ReadonlySet<string> = new Set(COMMAND_NAMES);
export function isCommandName(value: unknown): value is CommandName {
  return typeof value === "string" && COMMAND_NAME_SET.has(value);
}
