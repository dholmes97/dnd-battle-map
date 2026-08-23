import { tokenRadiusCells, type CreatureSize } from "../../shared/creature-library.ts";
import { transitionHp } from "../../shared/encounter-transitions.ts";
import { normalizeAltitude } from "../../shared/token-altitude.ts";
import { SPELL_EFFECT_KIND, spellEffectById } from "../../shared/spell-effects.ts";
import type { TokenEffectRepository, TokenWrite } from "../ports/token-effect-repository.ts";
import type { TokenRow } from "../types.ts";
import { commandError, type CommandContextFor, type CommandOutcome } from "./types.ts";

type TokenEffectCommandName =
  | "create-spell-effect" | "create-token" | "resize-spell-effect" | "update-token"
  | "apply-hp" | "add-effect" | "remove-effect" | "delete-token";
type TokenEffectDependencies = {
  repository: TokenEffectRepository;
  canControl(token: TokenRow): Promise<boolean>;
  isAllowedArt(value: unknown): Promise<boolean>;
};
export type TokenEffectCommandContext<Name extends TokenEffectCommandName = TokenEffectCommandName> =
  CommandContextFor<Name, TokenEffectDependencies>;

export async function createSpellEffect(context: TokenEffectCommandContext<"create-spell-effect">): Promise<CommandOutcome> {
  const spell = spellEffectById(context.payload.spellId);
  if (!spell) return commandError("That spell effect is not available.", 400);
  const summonerTokenId = cleanId(context.payload.summonerTokenId) || null;
  const summoner = summonerTokenId
    ? await context.repository.findToken(context.encounter.id, summonerTokenId)
    : null;
  if (summonerTokenId && !summoner) return commandError("Caster token not found.", 404);
  if (context.participant.role === "player" && !await validPlayerSummoner(context, summoner)) {
    return commandError("Player spell effects must belong to your character.", 403);
  }
  return createTokenEntity(context, {
    name: spell.name,
    kind: SPELL_EFFECT_KIND,
    size: spell.size,
    x: clamp(context.payload.x, context.encounter.gridWidth, spell.size),
    y: clamp(context.payload.y, context.encounter.gridHeight, spell.size),
    speed: 0,
    flySpeed: null,
    swimSpeed: null,
    climbSpeed: null,
    burrowSpeed: null,
    altitude: 0,
    armorClass: null,
    hp: null,
    maxHp: null,
    hidden: false,
    summonerTokenId,
    artAsset: spell.artAsset,
    initiative: summoner?.initiative ?? null,
    initiativeOrder: summoner?.initiative_order ?? null,
  });
}

export async function createToken(context: TokenEffectCommandContext<"create-token">): Promise<CommandOutcome> {
  const name = cleanText(context.payload.name, 48);
  if (!name) return commandError("Token name is required.", 400);
  const requestedKind = context.payload.kind;
  const requestedArt = context.payload.artAsset ?? "";
  const artAsset = await context.isAllowedArt(requestedArt) ? requestedArt : null;
  const size: CreatureSize = context.payload.size;
  const maxHp = Number.isFinite(context.payload.maxHp)
    ? Math.max(1, Math.trunc(context.payload.maxHp!))
    : null;
  const hp = maxHp === null
    ? null
    : Math.min(maxHp, Math.max(0, Math.trunc(context.payload.hp ?? NaN) || maxHp));
  const summonerTokenId = cleanId(context.payload.summonerTokenId) || null;
  const summoner = summonerTokenId
    ? await context.repository.findToken(context.encounter.id, summonerTokenId)
    : null;
  if (summonerTokenId && !summoner) return commandError("Summoner token not found.", 404);
  if (context.participant.role === "player" && !await validPlayerSummoner(context, summoner)) {
    return commandError("Player-created creatures must be summons of your character.", 403);
  }
  return createTokenEntity(context, {
    name,
    kind: context.participant.role === "player" ? "summon" : requestedKind,
    size,
    x: clamp(context.payload.x, context.encounter.gridWidth, size),
    y: clamp(context.payload.y, context.encounter.gridHeight, size),
    speed: Math.min(120, Math.max(0, Math.trunc(context.payload.speed) || 30)),
    flySpeed: secondarySpeed(context.payload.flySpeed),
    swimSpeed: secondarySpeed(context.payload.swimSpeed),
    climbSpeed: secondarySpeed(context.payload.climbSpeed),
    burrowSpeed: secondarySpeed(context.payload.burrowSpeed),
    altitude: 0,
    armorClass: Number.isFinite(context.payload.armorClass)
      ? Math.min(40, Math.max(1, Math.trunc(context.payload.armorClass!)))
      : null,
    hp,
    maxHp,
    hidden: context.participant.role === "dm" && Boolean(context.payload.hidden),
    summonerTokenId,
    artAsset,
    initiative: summoner?.initiative ?? null,
    initiativeOrder: summoner?.initiative_order ?? null,
  });
}

export async function resizeSpellEffect(context: TokenEffectCommandContext<"resize-spell-effect">): Promise<CommandOutcome> {
  const tokenId = cleanId(context.payload.tokenId);
  const token = await context.repository.findToken(context.encounter.id, tokenId);
  if (!token || token.kind !== SPELL_EFFECT_KIND) return commandError("Spell effect not found.", 404);
  if (!await context.canControl(token)) return commandError("You cannot resize this spell effect.", 403);
  const size = context.payload.size;
  const x = clamp(token.x, context.encounter.gridWidth, size);
  const y = clamp(token.y, context.encounter.gridHeight, size);
  await context.repository.resizeToken(context.encounter.id, tokenId, size, x, y, context.now);
  await finish(context, "token_updated", tokenChange(token, { ...token, size, x, y }));
  return success(context, { updated: true });
}

export async function updateToken(context: TokenEffectCommandContext<"update-token">): Promise<CommandOutcome> {
  const tokenId = cleanId(context.payload.tokenId);
  const token = await context.repository.findToken(context.encounter.id, tokenId);
  if (!token) return commandError("Token not found.", 404);
  if (!await context.canControl(token)) return commandError("You cannot edit this token.", 403);
  const requestedArt = context.payload.artAsset ?? "";
  const artAsset = await context.isAllowedArt(requestedArt)
    ? requestedArt
    : context.payload.artAsset === "" ? null : token.art_asset;
  const size: CreatureSize = context.payload.size ?? token.size;
  const maxHp = Number.isFinite(context.payload.maxHp)
    ? Math.max(1, Math.trunc(context.payload.maxHp!))
    : token.max_hp;
  const next: TokenWrite = {
    id: tokenId,
    encounterId: context.encounter.id,
    name: cleanText(context.payload.name, 48) || token.name,
    size,
    speed: Number.isFinite(context.payload.speed)
      ? Math.min(120, Math.max(0, Math.trunc(context.payload.speed!)))
      : token.speed,
    flySpeed: token.fly_speed,
    swimSpeed: token.swim_speed,
    climbSpeed: token.climb_speed,
    burrowSpeed: token.burrow_speed,
    altitude: context.payload.altitude === undefined
      ? token.altitude
      : normalizeAltitude(context.payload.altitude),
    armorClass: Number.isFinite(context.payload.armorClass)
      ? Math.min(40, Math.max(1, Math.trunc(context.payload.armorClass!)))
      : token.armor_class,
    hp: maxHp === null ? null : Math.min(maxHp, token.hp ?? maxHp),
    maxHp,
    hidden: context.participant.role === "dm"
      ? context.payload.hidden ?? Boolean(token.is_hidden)
      : Boolean(token.is_hidden),
    artAsset,
    x: clamp(token.x, context.encounter.gridWidth, size),
    y: clamp(token.y, context.encounter.gridHeight, size),
    kind: token.kind,
    summonerTokenId: token.summoner_token_id,
    initiative: token.initiative,
    initiativeOrder: token.initiative_order,
    now: context.now,
  };
  await context.repository.updateToken(next);
  await finish(context, "token_updated", tokenChange(token, {
    ...token,
    name: next.name,
    size: next.size,
    speed: next.speed,
    fly_speed: next.flySpeed,
    swim_speed: next.swimSpeed,
    climb_speed: next.climbSpeed,
    burrow_speed: next.burrowSpeed,
    altitude: next.altitude,
    armor_class: next.armorClass,
    hp: next.hp,
    max_hp: next.maxHp,
    is_hidden: next.hidden ? 1 : 0,
    art_asset: next.artAsset,
    x: next.x,
    y: next.y,
  }));
  return success(context, { updated: true });
}

export async function applyHp(context: TokenEffectCommandContext<"apply-hp">): Promise<CommandOutcome> {
  const tokenId = cleanId(context.payload.tokenId);
  const token = await context.repository.findToken(context.encounter.id, tokenId);
  if (!token) return commandError("Token not found.", 404);
  if (!await context.canControl(token)) return commandError("You cannot change this token's HP.", 403);
  if (token.max_hp === null) {
    return commandError("Configure maximum HP before applying damage or healing.", 409);
  }
  const delta = Math.trunc(context.payload.delta);
  if (!Number.isFinite(delta) || delta === 0) {
    return commandError("Enter non-zero damage or healing.", 400);
  }
  const { from, hp } = transitionHp(token.hp, token.max_hp, delta);
  const concentrationCheckRequired = delta < 0 &&
    await context.repository.hasConcentration(context.encounter.id, tokenId);
  await context.repository.updateHp(context.encounter.id, tokenId, hp, context.now);
  await finish(context, "hp_changed", { tokenId, from, to: hp, concentrationCheckRequired });
  return success(context, { updated: true, concentrationCheckRequired });
}

export async function addEffect(context: TokenEffectCommandContext<"add-effect">): Promise<CommandOutcome> {
  const tokenId = cleanId(context.payload.tokenId);
  const token = await context.repository.findToken(context.encounter.id, tokenId);
  if (!token) return commandError("Token not found.", 404);
  if (!await context.canControl(token)) return commandError("You cannot add an effect to this token.", 403);
  const name = cleanText(context.payload.name, 48);
  if (!name) return commandError("Effect name is required.", 400);
  const effectType = context.payload.effectType ?? "condition";
  const durationRounds = Number.isFinite(context.payload.durationRounds)
    ? Math.max(1, Math.min(99, Math.trunc(context.payload.durationRounds!)))
    : null;
  const expiresRound = durationRounds === null
    ? null
    : Math.max(1, context.encounter.currentRound || 1) + durationRounds;
  const reminderTiming = context.payload.reminderTiming === "start" ? "start" : "end";
  const effectId = context.services.createId();
  const effect = {
    id: effectId, tokenId, name, effectType, durationRounds, expiresRound,
    reminderTiming, createdBy: context.participant.id, createdAt: context.now,
  };
  if (!await context.repository.addEffect({
    id: effectId,
    encounterId: context.encounter.id,
    tokenId,
    name,
    effectType,
    durationRounds,
    expiresRound,
    reminderTiming,
    participantId: context.participant.id,
    now: context.now,
  })) {
    return commandError("This token or scenario has reached its effect limit. Remove an old effect before adding another.", 409);
  }
  await finish(context, "effect_added", { effectId, tokenId, effect });
  return success(context, { added: true, effectId });
}

export async function removeEffect(context: TokenEffectCommandContext<"remove-effect">): Promise<CommandOutcome> {
  const effectId = cleanId(context.payload.effectId);
  const effect = await context.repository.findEffect(context.encounter.id, effectId);
  if (!effect) return commandError("Effect not found.", 404);
  if (!await context.canControl(effect.token)) return commandError("You cannot remove this effect.", 403);
  await context.repository.removeEffect(context.encounter.id, effectId);
  await finish(context, "effect_removed", {
    effectId,
    tokenId: effect.token_id,
    effect: {
      id: effect.id, tokenId: effect.token_id, name: effect.name,
      effectType: effect.effect_type, durationRounds: effect.duration_rounds,
      expiresRound: effect.expires_round, reminderTiming: effect.reminder_timing,
      createdBy: effect.created_by, createdAt: effect.created_at,
    },
  });
  return success(context, { removed: true });
}

export async function deleteToken(context: TokenEffectCommandContext<"delete-token">): Promise<CommandOutcome> {
  const tokenId = cleanId(context.payload.tokenId);
  const token = await context.repository.findToken(context.encounter.id, tokenId);
  if (!token) return commandError("Token not found.", 404);
  if (context.participant.role !== "dm" &&
      (token.kind !== SPELL_EFFECT_KIND || !await context.canControl(token))) {
    return commandError("Only the DM can delete this token.", 403);
  }
  await context.repository.deleteToken(context.encounter.id, tokenId);
  await finish(
    context,
    token.kind === SPELL_EFFECT_KIND ? "spell_effect_dismissed" : "token_deleted",
    token.kind === SPELL_EFFECT_KIND ? { tokenId, token: tokenSnapshot(token) } : { tokenId },
  );
  return success(context, { deleted: true });
}

function tokenSnapshot(token: TokenRow) {
  return {
    name: token.name,
    x: token.x,
    y: token.y,
    artAsset: token.art_asset,
    kind: token.kind,
    size: token.size,
    speed: token.speed,
    flySpeed: token.fly_speed,
    swimSpeed: token.swim_speed,
    climbSpeed: token.climb_speed,
    burrowSpeed: token.burrow_speed,
    altitude: token.altitude,
    armorClass: token.armor_class,
    hp: token.hp,
    maxHp: token.max_hp,
    hidden: Boolean(token.is_hidden),
    summonerTokenId: token.summoner_token_id,
    initiative: token.initiative,
    initiativeOrder: token.initiative_order,
  };
}

async function createTokenEntity(
  context: TokenEffectCommandContext,
  token: Omit<TokenWrite, "id" | "encounterId" | "now">,
): Promise<CommandOutcome> {
  const tokenId = context.services.createId();
  if (!await context.repository.createToken({
    ...token,
    id: tokenId,
    encounterId: context.encounter.id,
    now: context.now,
  })) {
    return commandError("This scenario has reached its token limit. Remove a token before placing another.", 409);
  }
  await finish(context, "token_created", {
    tokenId,
    token: {
      tokenId, name: token.name, kind: token.kind, size: token.size, x: token.x, y: token.y,
      speed: token.speed, armorClass: token.armorClass, hp: token.hp, maxHp: token.maxHp, hidden: token.hidden,
      flySpeed: token.flySpeed, swimSpeed: token.swimSpeed,
      climbSpeed: token.climbSpeed, burrowSpeed: token.burrowSpeed,
      altitude: token.altitude,
      summonerTokenId: token.summonerTokenId, artAsset: token.artAsset,
      initiative: token.initiative, initiativeGroupId: null,
      initiativeOrder: token.initiativeOrder,
    },
  });
  return success(context, { created: true, tokenId });
}

async function validPlayerSummoner(context: TokenEffectCommandContext, token: TokenRow | null) {
  return Boolean(token && token.kind === "character" && !token.summoner_token_id &&
    await context.canControl(token));
}

function tokenChange(previous: TokenRow, next: TokenRow) {
  const view = (token: TokenRow) => ({
    name: token.name, size: token.size, x: token.x, y: token.y, speed: token.speed,
    flySpeed: token.fly_speed, swimSpeed: token.swim_speed,
    climbSpeed: token.climb_speed, burrowSpeed: token.burrow_speed,
    altitude: token.altitude,
    armorClass: token.armor_class, hp: token.hp, maxHp: token.max_hp,
    hidden: Boolean(token.is_hidden), artAsset: token.art_asset,
  });
  return { tokenId: previous.id, previous: view(previous), next: view(next) };
}

function clamp(value: unknown, limit: number, size: CreatureSize) {
  const radius = tokenRadiusCells(size);
  const numeric = Number(value);
  const fallback = limit / 2;
  return Math.round(Math.min(limit - radius, Math.max(radius, Number.isFinite(numeric) ? numeric : fallback)) * 1_000) / 1_000;
}

function secondarySpeed(value: unknown) {
  const speed = Math.trunc(Number(value));
  return Number.isFinite(speed) && speed > 0 ? Math.min(240, speed) : null;
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function cleanId(value: unknown) {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) : "";
}

async function finish(context: TokenEffectCommandContext, type: string, payload: Record<string, unknown>) {
  await context.services.commit(type, payload);
}

async function success(context: TokenEffectCommandContext, payload: Record<string, unknown>): Promise<CommandOutcome> {
  return { payload: { ...payload, state: await context.services.loadState() } };
}
