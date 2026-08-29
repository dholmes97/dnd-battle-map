import { isCreatureSize } from "./creature-library.ts";
import { parseMapPackage } from "./map-package.ts";
import { isSpellAreaSize, spellEffectById } from "./spell-effects.ts";
import {
  ROLL_MODES,
  validateCombatActionValues,
  type DamageAdjudication,
  type RollMode,
} from "./combat-rolling.ts";
import { MAX_INITIATIVE_GROUP_TOKENS, MAX_SHARED_FOG_INPUT_POINTS } from "./resource-limits.ts";
import {
  COMMAND_NAMES,
  isCommandName,
  type CommandName,
  type CommandPayload,
  type CommandRequest,
  type EncounterStatus,
  type MapPoint,
  type SharedAnnotation,
} from "./contracts.ts";

export type CommandParseResult =
  | { ok: true; request: CommandRequest }
  | { ok: false; error: "Unknown command." | "Invalid command payload." };

const PARSED_COMMANDS = [
  "send-chat-message", "delete-handout", "undo", "redo", "rename-scenario",
  "create-scenario", "set-initiative", "set-initiative-group", "end-turn",
  "advance-turn", "start-combat", "correct-turn", "save-map-draft",
  "discard-map-draft", "apply-map-draft", "configure-encounter",
  "set-strict-movement", "set-fog-mode", "set-vision-door-open",
  "update-shared-fog", "create-spell-effect", "create-token",
  "resize-spell-effect", "update-token", "apply-hp", "add-effect",
  "remove-effect", "add-annotation", "remove-annotation", "clear-annotations",
  "delete-token", "set-temporary-hp", "save-combat-action", "delete-combat-action",
  "roll-attack", "roll-damage", "adjudicate-damage",
] as const satisfies readonly CommandName[];

export function commandParserCoverage(): { complete: boolean; missing: CommandName[] } {
  const parsed = new Set<CommandName>(PARSED_COMMANDS);
  const missing = COMMAND_NAMES.filter((command) => !parsed.has(command));
  return { complete: missing.length === 0 && parsed.size === COMMAND_NAMES.length, missing };
}

export function commandRequest<Name extends CommandName>(
  command: Name,
  payload: CommandPayload<Name>,
): { command: Name } & CommandPayload<Name> {
  return { command, ...payload };
}

export function parseCommandRequest(value: unknown): CommandParseResult {
  if (!isRecord(value) || !isCommandName(value.command)) {
    return { ok: false, error: "Unknown command." };
  }
  const payload = value.payload === undefined ? value : value.payload;
  if (!isRecord(payload)) {
    return { ok: false, error: "Invalid command payload." };
  }
  const request = parseKnownCommand(value.command, payload);
  return request
    ? { ok: true, request }
    : { ok: false, error: "Invalid command payload." };
}

function parseKnownCommand(command: CommandName, body: Record<string, unknown>): CommandRequest | null {
  switch (command) {
    case "send-chat-message": {
      if (!optionalNullableString(body.recipientName) || !optionalString(body.message) ||
          !optionalNullableString(body.handoutId) || !optionalBoolean(body.showImmediately)) return null;
      return { command, payload: compact<"send-chat-message">({
        recipientName: body.recipientName,
        message: body.message,
        handoutId: body.handoutId,
        showImmediately: body.showImmediately,
      }) };
    }
    case "delete-handout":
      return requiredString(body.handoutId) ? { command, payload: { handoutId: body.handoutId } } : null;
    case "undo":
    case "redo":
    case "advance-turn":
    case "start-combat":
    case "clear-annotations":
    case "discard-map-draft":
      return { command, payload: {} };
    case "rename-scenario":
      return requiredString(body.name) ? { command, payload: { name: body.name } } : null;
    case "create-scenario":
      return requiredString(body.name) && (body.mode === "party" || body.mode === "duplicate")
        ? { command, payload: { name: body.name, mode: body.mode } }
        : null;
    case "set-initiative":
      return requiredString(body.tokenId) && finiteNumber(body.initiative)
        ? { command, payload: { tokenId: body.tokenId, initiative: body.initiative } }
        : null;
    case "set-initiative-group":
      return stringArray(body.tokenIds) && finiteNumber(body.initiative)
        ? { command, payload: { tokenIds: body.tokenIds, initiative: body.initiative } }
        : null;
    case "end-turn":
      return requiredString(body.tokenId) ? { command, payload: { tokenId: body.tokenId } } : null;
    case "correct-turn":
      return finiteNumber(body.round) && finiteNumber(body.activeOrder)
        ? { command, payload: { round: body.round, activeOrder: body.activeOrder } }
        : null;
    case "save-map-draft":
    case "apply-map-draft": {
      const mapPackage = parseSubmittedMap(body.mapPackage);
      return mapPackage ? { command, payload: { mapPackage } } as CommandRequest : null;
    }
    case "configure-encounter":
      return encounterStatus(body.status) ? { command, payload: { status: body.status } } : null;
    case "set-strict-movement":
      return typeof body.enabled === "boolean" ? { command, payload: { enabled: body.enabled } } : null;
    case "set-fog-mode":
      return fogMode(body.mode) ? { command, payload: { mode: body.mode } } : null;
    case "set-vision-door-open":
      return requiredString(body.doorId) && typeof body.open === "boolean"
        ? { command, payload: { doorId: body.doorId, open: body.open } }
        : null;
    case "update-shared-fog": {
      const polygon = mapPoints(body.polygon);
      return polygon ? { command, payload: { polygon } } : null;
    }
    case "create-spell-effect": {
      const spell = spellEffectById(body.spellId);
      if (!spell || !optionalString(body.summonerTokenId) || !finiteNumber(body.x) || !finiteNumber(body.y)) return null;
      return { command, payload: compact<"create-spell-effect">({
        spellId: spell.id,
        summonerTokenId: body.summonerTokenId,
        x: body.x,
        y: body.y,
      }) };
    }
    case "create-token": {
      if (!requiredString(body.name) || !tokenKind(body.kind) || !isCreatureSize(body.size) ||
          !finiteNumber(body.speed) || !optionalNumber(body.flySpeed) || !optionalNumber(body.swimSpeed) ||
          !optionalNumber(body.climbSpeed) || !optionalNumber(body.burrowSpeed) ||
          !optionalNumber(body.armorClass) || !optionalNumber(body.hp) || !optionalNumber(body.maxHp) ||
          !optionalBoolean(body.hidden) || !optionalString(body.artAsset) || !optionalString(body.catalogCreatureId) ||
          !optionalString(body.summonerTokenId) || !finiteNumber(body.x) || !finiteNumber(body.y)) return null;
      return { command, payload: compact<"create-token">({
        name: body.name,
        kind: body.kind,
        size: body.size,
        speed: body.speed,
        flySpeed: body.flySpeed,
        swimSpeed: body.swimSpeed,
        climbSpeed: body.climbSpeed,
        burrowSpeed: body.burrowSpeed,
        armorClass: body.armorClass,
        hp: body.hp,
        maxHp: body.maxHp,
        hidden: body.hidden,
        artAsset: body.artAsset,
        catalogCreatureId: body.catalogCreatureId,
        summonerTokenId: body.summonerTokenId,
        x: body.x,
        y: body.y,
      }) };
    }
    case "resize-spell-effect":
      return requiredString(body.tokenId) && isSpellAreaSize(body.size)
        ? { command, payload: { tokenId: body.tokenId, size: body.size } }
        : null;
    case "update-token": {
      if (!requiredString(body.tokenId) || !optionalString(body.name) ||
          (body.size !== undefined && !isCreatureSize(body.size)) || !optionalNumber(body.speed) ||
          !optionalNumber(body.altitude) || !optionalNumber(body.armorClass) || !optionalNumber(body.maxHp) || !optionalBoolean(body.hidden) || !optionalString(body.artAsset)) return null;
      return { command, payload: compact<"update-token">({
        tokenId: body.tokenId,
        name: body.name,
        size: body.size,
        speed: body.speed,
        altitude: body.altitude,
        armorClass: body.armorClass,
        maxHp: body.maxHp,
        hidden: body.hidden,
        artAsset: body.artAsset,
      }) };
    }
    case "apply-hp":
      return requiredString(body.tokenId) && finiteNumber(body.delta)
        ? { command, payload: { tokenId: body.tokenId, delta: body.delta } }
        : null;
    case "set-temporary-hp":
      return requiredString(body.tokenId) && finiteNumber(body.amount)
        ? { command, payload: { tokenId: body.tokenId, amount: body.amount } }
        : null;
    case "save-combat-action": {
      const values = validateCombatActionValues(body.values, { requireManualRiderText: true });
      return optionalString(body.actionId) && (body.ownerType === "character" || body.ownerType === "creature") &&
        requiredString(body.ownerId) && values
        ? { command, payload: compact<"save-combat-action">({
          actionId: body.actionId,
          ownerType: body.ownerType,
          ownerId: body.ownerId,
          values,
        }) }
        : null;
    }
    case "delete-combat-action":
      return requiredString(body.actionId) ? { command, payload: { actionId: body.actionId } } : null;
    case "roll-attack": {
      const adHocAction = body.adHocAction === undefined ? undefined : validateCombatActionValues(body.adHocAction, { requireManualRiderText: true });
      return requiredString(body.operationId) && requiredString(body.attackerTokenId) &&
        requiredString(body.targetTokenId) && optionalString(body.actionProfileId) &&
        (body.adHocAction === undefined || adHocAction) && rollMode(body.rollMode) &&
        optionalBoolean(body.alternateDamage)
        ? { command, payload: compact<"roll-attack">({
          operationId: body.operationId,
          attackerTokenId: body.attackerTokenId,
          targetTokenId: body.targetTokenId,
          actionProfileId: body.actionProfileId,
          adHocAction: adHocAction ?? undefined,
          rollMode: body.rollMode,
          alternateDamage: body.alternateDamage,
        }) }
        : null;
    }
    case "roll-damage":
      return requiredString(body.operationId) && requiredString(body.rollId)
        ? { command, payload: { operationId: body.operationId, rollId: body.rollId } }
        : null;
    case "adjudicate-damage":
      return requiredString(body.proposalId) && damageAdjudication(body.method) &&
        optionalNumber(body.adjustedDamage) && optionalString(body.note)
        ? { command, payload: compact<"adjudicate-damage">({
          proposalId: body.proposalId,
          method: body.method,
          adjustedDamage: body.adjustedDamage,
          note: body.note,
        }) }
        : null;
    case "add-effect":
      return parseAddEffect(command, body);
    case "remove-effect":
      return requiredString(body.effectId) ? { command, payload: { effectId: body.effectId } } : null;
    case "add-annotation":
      return parseAddAnnotation(command, body);
    case "remove-annotation":
      return requiredString(body.annotationId) ? { command, payload: { annotationId: body.annotationId } } : null;
    case "delete-token":
      return requiredString(body.tokenId) ? { command, payload: { tokenId: body.tokenId } } : null;
  }
}

function parseAddEffect(command: "add-effect", body: Record<string, unknown>): CommandRequest | null {
  if (!requiredString(body.tokenId) || !requiredString(body.name) || !optionalEffectType(body.effectType) ||
      !optionalNumber(body.durationRounds) || !optionalReminder(body.reminderTiming)) return null;
  return { command, payload: compact<"add-effect">({
    tokenId: body.tokenId,
    name: body.name,
    effectType: body.effectType,
    durationRounds: body.durationRounds,
    reminderTiming: body.reminderTiming,
  }) };
}

function parseAddAnnotation(command: "add-annotation", body: Record<string, unknown>): CommandRequest | null {
  if (!annotationType(body.annotationType) || !finiteNumber(body.x) || !finiteNumber(body.y) ||
      !optionalNumber(body.x2) || !optionalNumber(body.y2) ||
      !optionalString(body.color) || !optionalString(body.label)) return null;
  return { command, payload: compact<"add-annotation">({
    annotationType: body.annotationType,
    x: body.x,
    y: body.y,
    x2: body.x2,
    y2: body.y2,
    color: body.color,
    label: body.label,
  }) };
}

function compact<Name extends CommandName>(payload: { [Key in keyof CommandPayload<Name>]: CommandPayload<Name>[Key] | undefined }): CommandPayload<Name> {
  return Object.fromEntries(Object.entries(payload).filter(([, entry]) => entry !== undefined)) as CommandPayload<Name>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown): value is string {
  return typeof value === "string";
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function optionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalNumber(value: unknown): value is number | undefined {
  return value === undefined || finiteNumber(value);
}

function optionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_INITIATIVE_GROUP_TOKENS && value.every((entry) => typeof entry === "string");
}

function encounterStatus(value: unknown): value is EncounterStatus {
  return value === "setup" || value === "active" || value === "paused";
}

function fogMode(value: unknown): value is "off" | "shared" | "dynamic" {
  return value === "off" || value === "shared" || value === "dynamic";
}

function tokenKind(value: unknown): value is "character" | "monster" | "summon" | "familiar" {
  return value === "character" || value === "monster" || value === "summon" || value === "familiar";
}

function optionalEffectType(value: unknown): value is "condition" | "effect" | "concentration" | undefined {
  return value === undefined || value === "condition" || value === "effect" || value === "concentration";
}

function optionalReminder(value: unknown): value is "start" | "end" | undefined {
  return value === undefined || value === "start" || value === "end";
}

function rollMode(value: unknown): value is RollMode {
  return ROLL_MODES.includes(value as RollMode);
}

function damageAdjudication(value: unknown): value is DamageAdjudication {
  return value === "apply" || value === "resistant" || value === "vulnerable" ||
    value === "immune" || value === "adjust" || value === "reject" || value === "cancel";
}

function annotationType(value: unknown): value is SharedAnnotation["type"] {
  return value === "ping" || value === "drawing" || value === "spotlight" || value === "neon-spotlight";
}

function mapPoints(value: unknown): MapPoint[] | null {
  if (!Array.isArray(value) || value.length > MAX_SHARED_FOG_INPUT_POINTS) return null;
  const points: MapPoint[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !finiteNumber(entry.x) || !finiteNumber(entry.y)) return null;
    points.push({ x: entry.x, y: entry.y });
  }
  return points;
}

function parseSubmittedMap(value: unknown) {
  try {
    return parseMapPackage(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return null;
  }
}
