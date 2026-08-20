import type { CreatureSize } from "./creature-library";
import type { MapPackage } from "./map-package";
import type { HealthBand } from "./health";
import type { SpellAreaSize, SpellEffectDefinition } from "./spell-effects";

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
  flySpeed: number | null;
  swimSpeed: number | null;
  climbSpeed: number | null;
  burrowSpeed: number | null;
  armorClass: number | null;
  hp: number | null;
  maxHp: number | null;
  healthState: HealthBand | null;
  hidden: boolean;
  summonerTokenId: string | null;
  initiative: number | null;
  initiativeGroupId: string | null;
  initiativeOrder: number | null;
  turnComplete: boolean;
  altitude: number;
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
    dmBriefing: string | null;
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
type EmptyCommandPayload = Record<string, never>;
type MapApplicationPayload =
  | { presetId: string; mapPackage?: MapPackage }
  | { presetId?: string; mapPackage: MapPackage };

export type CommandPayloadMap = {
  "send-chat-message": {
    recipientName?: string | null;
    message?: string;
    handoutId?: string | null;
    showImmediately?: boolean;
  };
  "delete-handout": { handoutId: string };
  undo: EmptyCommandPayload;
  redo: EmptyCommandPayload;
  "rename-scenario": { name: string };
  "create-scenario": { name: string; mode: "party" | "duplicate" };
  "set-initiative": { tokenId: string; initiative: number };
  "set-initiative-group": { tokenIds: string[]; initiative: number };
  "end-turn": { tokenId: string };
  "advance-turn": EmptyCommandPayload;
  "start-combat": EmptyCommandPayload;
  "correct-turn": { round: number; activeOrder: number };
  "save-map-preset": {
    presetId?: string;
    name?: string;
    description?: string;
    sourcePrompt?: string;
    mapPackage: MapPackage;
  };
  "delete-map-preset": { presetId: string };
  "apply-map-package": MapApplicationPayload;
  "configure-encounter": { status: EncounterStatus };
  "set-strict-movement": { enabled: boolean };
  "set-fog-mode": { mode: MapPackage["fog"]["mode"] };
  "set-vision-door-open": { doorId: string; open: boolean };
  "update-shared-fog": { polygon: MapPoint[] };
  "create-spell-effect": {
    spellId: SpellEffectDefinition["id"];
    summonerTokenId?: string;
    x: number;
    y: number;
  };
  "create-token": {
    name: string;
    kind: "character" | "monster" | "summon" | "familiar";
    size: CreatureSize;
    speed: number;
    flySpeed?: number;
    swimSpeed?: number;
    climbSpeed?: number;
    burrowSpeed?: number;
    armorClass?: number;
    hp?: number;
    maxHp?: number;
    hidden?: boolean;
    artAsset?: string;
    summonerTokenId?: string;
    x: number;
    y: number;
  };
  "resize-spell-effect": { tokenId: string; size: SpellAreaSize };
  "update-token": {
    tokenId: string;
    name?: string;
    size?: CreatureSize;
    speed?: number;
    altitude?: number;
    armorClass?: number;
    maxHp?: number;
    hidden?: boolean;
    artAsset?: string;
  };
  "apply-hp": { tokenId: string; delta: number };
  "add-effect": {
    tokenId: string;
    name: string;
    effectType?: "condition" | "effect" | "concentration";
    durationRounds?: number;
    reminderTiming?: "start" | "end";
  };
  "remove-effect": { effectId: string };
  "add-annotation": {
    annotationType: SharedAnnotation["type"];
    x: number;
    y: number;
    x2?: number;
    y2?: number;
    color?: string;
    label?: string;
  };
  "remove-annotation": { annotationId: string };
  "clear-annotations": EmptyCommandPayload;
  "delete-token": { tokenId: string };
};

export type CommandPayload<Name extends CommandName> = CommandPayloadMap[Name];
export type CommandRequest = {
  [Name in CommandName]: { command: Name; payload: CommandPayload<Name> }
}[CommandName];
export type CommandResponse = { state: EncounterState } & Record<string, unknown>;

const COMMAND_NAME_SET: ReadonlySet<string> = new Set(COMMAND_NAMES);
export function isCommandName(value: unknown): value is CommandName {
  return typeof value === "string" && COMMAND_NAME_SET.has(value);
}
