import { tokenRadiusCells } from "../../shared/creature-library.ts";
import { scenarioCodeFromName } from "../../shared/encounter-domain.ts";
import { parseMapPackage } from "../../shared/map-package.ts";
import { baseTokenControllerName } from "../../shared/token-control.ts";
import type { ScenarioMapRepository } from "../ports/scenario-map-repository.ts";
import { commandError, requireDm, type CommandContext, type CommandContextFor, type CommandOutcome } from "./types.ts";

type ScenarioMapCommandName =
  | "rename-scenario" | "create-scenario" | "save-map-preset"
  | "delete-map-preset" | "apply-map-package" | "configure-encounter";
type ScenarioMapDependencies = {
  repository: ScenarioMapRepository;
  loadScenarioState(code: string, participantId: string): ReturnType<CommandContext["services"]["loadState"]>;
  recordScenarioAction(
    encounterId: string,
    participantId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
};
export type ScenarioMapCommandContext<Name extends ScenarioMapCommandName = ScenarioMapCommandName> =
  CommandContextFor<Name, ScenarioMapDependencies>;

export async function renameScenario(context: ScenarioMapCommandContext<"rename-scenario">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const name = cleanText(context.payload.name, 64);
  if (name.length < 3) return commandError("Scenario name must be at least three characters.", 400);
  const changed = name !== context.encounter.name;
  if (changed) {
    await context.repository.renameScenario(context.encounter.id, name, context.now);
    await context.services.recordAction("scenario_renamed", {
      previousName: context.encounter.name,
      name,
    });
  }
  return {
    payload: {
      renamed: changed,
      scenario: {
        code: context.encounter.code,
        name,
        status: context.encounter.status,
        updatedAt: changed ? context.now : context.encounter.updatedAt,
      },
      state: await context.services.loadState(),
    },
  };
}

export async function createScenario(context: ScenarioMapCommandContext<"create-scenario">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const name = cleanText(context.payload.name, 64);
  const mode = context.payload.mode;
  if (name.length < 3) return commandError("Scenario name must be at least three characters.", 400);
  const code = await uniqueScenarioCode(context.repository, name);
  const sourceTokens = await context.repository.listScenarioTokens(context.encounter.id);
  const selected = mode === "duplicate"
    ? sourceTokens
    : sourceTokens.filter((token) =>
      !token.summoner_token_id && baseTokenControllerName(token) !== "Kevin"
    );
  if (!selected.length) {
    return commandError("The current encounter has no player characters to seed the new scenario.", 409);
  }
  const duplicate = mode === "duplicate";
  const scenarioId = context.services.createId();
  const participantId = context.services.createId();
  const sessionSecret = context.services.createId();
  const copiedIds = new Map(selected.map((token) => [token.id, context.services.createId()]));
  await context.repository.createScenario({
    id: scenarioId,
    code,
    name,
    mapAsset: duplicate ? context.encounter.mapAsset : "",
    mapPackageJson: duplicate ? context.encounter.mapPackageJson : null,
    width: context.encounter.gridWidth,
    height: context.encounter.gridHeight,
    strictMovement: duplicate ? context.encounter.strictMovement : true,
    participantId,
    sessionSecret,
    now: context.now,
    tokens: selected.map((token) => ({
      ...token,
      copiedId: copiedIds.get(token.id)!,
      copiedSummonerId: token.summoner_token_id
        ? copiedIds.get(token.summoner_token_id) ?? null
        : null,
      copiedHp: duplicate ? token.hp : token.max_hp,
      copiedHidden: duplicate ? Boolean(token.is_hidden) : false,
    })),
  });
  await context.recordScenarioAction(scenarioId, participantId, "scenario_created", {
    sourceEncounterId: context.encounter.id,
    mode,
    tokenCount: selected.length,
  });
  return {
    payload: {
      created: true,
      participantId,
      sessionSecret,
      role: "dm",
      scenario: { code, name, status: "setup", updatedAt: context.now },
      state: await context.loadScenarioState(code, participantId),
    },
  };
}

export async function saveMapPreset(context: ScenarioMapCommandContext<"save-map-preset">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const map = cleanMapPackage(context.payload.mapPackage);
  if (!map) return commandError("That map package is invalid or too large.", 400);
  const name = cleanText(context.payload.name, 72) || cleanText(map.name, 72) || "Untitled map";
  const requestedId = cleanId(context.payload.presetId);
  const presetId = requestedId || context.services.createId();
  const saved = await context.repository.saveMapPreset({
    id: presetId,
    encounterId: context.encounter.id,
    name,
    description: cleanText(context.payload.description, 240) || cleanText(map.description, 240),
    sourcePrompt: cleanText(context.payload.sourcePrompt, 600) || null,
    packageJson: JSON.stringify(map),
    participantId: context.participant.id,
    now: context.now,
  }, Boolean(requestedId));
  if (!saved) return commandError("Saved map preset not found.", 404);
  await finish(context, requestedId ? "map_preset_updated" : "map_preset_saved", { presetId, name });
  return success(context, { saved: true, presetId });
}

export async function deleteMapPreset(context: ScenarioMapCommandContext<"delete-map-preset">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const presetId = cleanId(context.payload.presetId);
  if (!presetId) return commandError("Saved map preset is required.", 400);
  if (!await context.repository.deleteMapPreset(context.encounter.id, presetId)) {
    return commandError("Saved map preset not found.", 404);
  }
  if (context.encounter.activeMapPresetId === presetId) {
    await context.repository.clearActivePreset(context.encounter.id);
  }
  await finish(context, "map_preset_deleted", { presetId });
  return success(context, { deleted: true });
}

export async function applyMapPackage(context: ScenarioMapCommandContext<"apply-map-package">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const presetId = cleanId(context.payload.presetId) || null;
  let map = cleanMapPackage(context.payload.mapPackage);
  let appliedPresetId: string | null = null;
  if (presetId) {
    const savedText = await context.repository.loadMapPreset(context.encounter.id, presetId);
    if (!savedText) return commandError("Saved map preset not found.", 404);
    const saved = cleanMapPackage(savedText);
    if (!map) map = saved;
    if (saved && map && JSON.stringify(saved) === JSON.stringify(map)) appliedPresetId = presetId;
  }
  if (!map) return commandError("That map package is invalid or too large.", 400);
  const tokens = await context.repository.listTokenPositions(context.encounter.id);
  await context.repository.applyMapPackage({
    encounterId: context.encounter.id,
    packageJson: JSON.stringify(map),
    activePresetId: appliedPresetId,
    width: map.width,
    height: map.height,
    tokenPositions: tokens.map((token) => ({
      id: token.id,
      x: clampCoordinate(token.x, map!.width, token.size),
      y: clampCoordinate(token.y, map!.height, token.size),
    })),
    now: context.now,
  });
  await finish(context, "map_package_applied", {
    presetId: appliedPresetId,
    mapId: map.id,
    name: map.name,
    previousMapPresetId: context.encounter.activeMapPresetId,
    previousGrid: { width: context.encounter.gridWidth, height: context.encounter.gridHeight },
    nextGrid: { width: map.width, height: map.height },
  });
  return success(context, { applied: true });
}

export async function configureEncounter(context: ScenarioMapCommandContext<"configure-encounter">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const status = context.payload.status;
  await context.repository.configureEncounter(context.encounter.id, status, context.now);
  await finish(context, "encounter_configured", {
    previous: { status: context.encounter.status },
    next: { status },
  });
  return success(context, { configured: true });
}

async function uniqueScenarioCode(repository: ScenarioMapRepository, name: string) {
  const base = scenarioCodeFromName(name);
  for (let attempt = 1; attempt <= 99; attempt += 1) {
    const suffix = attempt === 1 ? "" : `-${attempt}`;
    const candidate = `${base.slice(0, 24 - suffix.length)}${suffix}`;
    if (!await repository.scenarioCodeExists(candidate)) return candidate;
  }
  throw new Error("No unique scenario code is available.");
}

function cleanMapPackage(value: unknown) {
  try {
    return parseMapPackage(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return null;
  }
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function cleanId(value: unknown) {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) : "";
}

function clampCoordinate(
  value: number,
  limit: number,
  size: Parameters<typeof tokenRadiusCells>[0],
) {
  const radius = tokenRadiusCells(size);
  return Math.round(Math.min(limit - radius, Math.max(radius, value)) * 1000) / 1000;
}

async function finish(
  context: ScenarioMapCommandContext,
  type: string,
  payload: Record<string, unknown>,
) {
  await context.services.bumpEncounter();
  await context.services.recordAction(type, payload);
}

async function success(
  context: ScenarioMapCommandContext,
  payload: Record<string, unknown>,
): Promise<CommandOutcome> {
  return { payload: { ...payload, state: await context.services.loadState() } };
}
