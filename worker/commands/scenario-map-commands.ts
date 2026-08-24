import { tokenRadiusCells } from "../../shared/creature-library.ts";
import { scenarioCodeFromName } from "../../shared/encounter-domain.ts";
import { mapSetupFromPackage, parseMapPackage, parseMapSetup, type MapImage } from "../../shared/map-package.ts";
import { MAX_SCENARIOS } from "../../shared/resource-limits.ts";
import { combatStatusTransitionError } from "../../shared/encounter-transitions.ts";
import type { ScenarioMapRepository } from "../ports/scenario-map-repository.ts";
import { commandError, requireDm, type CommandContext, type CommandContextFor, type CommandOutcome } from "./types.ts";

type ScenarioMapCommandName =
  | "rename-scenario" | "create-scenario" | "save-map-draft"
  | "discard-map-draft" | "apply-map-draft" | "configure-encounter";
type ScenarioMapDependencies = {
  repository: ScenarioMapRepository;
  loadScenarioState(code: string, participantId: string): ReturnType<CommandContext["services"]["loadState"]>;
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
    await context.services.commit("scenario_renamed", {
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
  if (await context.repository.countScenarios(context.encounter.campaignId) >= MAX_SCENARIOS) {
    return commandError("The campaign has reached its scenario limit.", 409);
  }
  const code = await uniqueScenarioCode(context.repository, name);
  const sourceTokens = await context.repository.listScenarioTokens(context.encounter.id);
  const selected = mode === "duplicate"
    ? sourceTokens
    : sourceTokens.filter((token) =>
      !token.summoner_token_id && Boolean(token.campaign_character_id)
    );
  if (!selected.length) {
    return commandError("The current encounter has no player characters to seed the new scenario.", 409);
  }
  const duplicate = mode === "duplicate";
  const scenarioId = context.services.createId();
  const participantId = context.services.createId();
  const sessionSecret = context.services.createId();
  const copiedIds = new Map(selected.map((token) => [token.id, context.services.createId()]));
  if (!context.participant.identityId || !context.participant.campaignMembershipId) {
    return commandError("Your campaign membership could not be verified.", 403);
  }
  await context.repository.createScenario({
    id: scenarioId,
    campaignId: context.encounter.campaignId,
    code,
    name,
    activeMapImageId: duplicate ? context.encounter.activeMapImageId : null,
    activeMapSetupJson: duplicate ? context.encounter.activeMapSetupJson : null,
    draftMapImageId: duplicate ? context.encounter.activeMapImageId : null,
    draftMapSetupJson: duplicate ? context.encounter.activeMapSetupJson : null,
    width: context.encounter.gridWidth,
    height: context.encounter.gridHeight,
    strictMovement: duplicate ? context.encounter.strictMovement : true,
    participantId,
    participantIdentityId: context.participant.identityId,
    participantMembershipId: context.participant.campaignMembershipId,
    participantName: context.participant.name,
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
      copiedAltitude: duplicate ? token.altitude : 0,
    })),
  });
  await context.services.commitFor({
    encounterId: scenarioId,
    expectedVersion: null,
    participantId,
    actionType: "scenario_created",
    payload: {
      sourceEncounterId: context.encounter.id,
      mode,
      tokenCount: selected.length,
    },
    bumpVersion: false,
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

export async function saveMapDraft(context: ScenarioMapCommandContext<"save-map-draft">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const prepared = await preparedMapDraft(context);
  if ("error" in prepared) return prepared.error;
  await context.repository.saveMapDraft(context.encounter.id, prepared.mapImage.id, prepared.setupJson, context.now);
  await finish(context, "map_draft_saved", { mapImageId: prepared.mapImage.id });
  return success(context, { saved: true });
}

export async function discardMapDraft(context: ScenarioMapCommandContext<"discard-map-draft">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  await context.repository.discardMapDraft(context.encounter.id, context.now);
  await finish(context, "map_draft_discarded", {});
  return success(context, { discarded: true });
}

export async function applyMapDraft(context: ScenarioMapCommandContext<"apply-map-draft">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const prepared = await preparedMapDraft(context);
  if ("error" in prepared) return prepared.error;
  const { mapImage, setupJson } = prepared;
  const tokens = await context.repository.listTokenPositions(context.encounter.id);
  await context.repository.applyMapDraft({
    encounterId: context.encounter.id,
    mapImageId: mapImage.id,
    setupJson,
    width: mapImage.gridWidth,
    height: mapImage.gridHeight,
    tokenPositions: tokens.map((token) => ({
      id: token.id,
      x: clampCoordinate(token.x, mapImage.gridWidth, token.size),
      y: clampCoordinate(token.y, mapImage.gridHeight, token.size),
    })),
    now: context.now,
  });
  await finish(context, "map_draft_applied", {
    mapImageId: mapImage.id,
    name: mapImage.name,
    previousGrid: { width: context.encounter.gridWidth, height: context.encounter.gridHeight },
    nextGrid: { width: mapImage.gridWidth, height: mapImage.gridHeight },
  });
  return success(context, { applied: true });
}

async function preparedMapDraft(
  context: ScenarioMapCommandContext<"save-map-draft" | "apply-map-draft">,
): Promise<{ error: CommandOutcome } | { mapImage: MapImage; setupJson: string }> {
  const map = cleanMapPackage(context.payload.mapPackage);
  if (!map) return { error: commandError("That map draft is invalid or too large.", 400) };
  const mapImage = await context.repository.findMapImage(map.id);
  if (!mapImage) return { error: commandError("That base map is no longer available.", 404) };
  const setup = parseMapSetup(mapSetupFromPackage(map), mapImage.gridWidth, mapImage.gridHeight);
  if (!setup) return { error: commandError("That map draft contains geometry outside the selected base map.", 400) };
  return { mapImage, setupJson: JSON.stringify(setup) };
}

export async function configureEncounter(context: ScenarioMapCommandContext<"configure-encounter">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const status = context.payload.status;
  const transitionError = combatStatusTransitionError({
    from: context.encounter.status,
    to: status,
    currentRound: context.encounter.currentRound,
    activeInitiativeOrder: context.encounter.activeInitiativeOrder,
  });
  if (transitionError) return commandError(transitionError, 409);
  if (status === context.encounter.status) return success(context, { configured: false });
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
  await context.services.commit(type, payload);
}

async function success(
  context: ScenarioMapCommandContext,
  payload: Record<string, unknown>,
): Promise<CommandOutcome> {
  return { payload: { ...payload, state: await context.services.loadState() } };
}
