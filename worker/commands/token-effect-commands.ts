import { isCreatureSize, tokenRadiusCells, type CreatureSize } from "../../shared/creature-library.ts";
import { isSpellAreaSize, SPELL_EFFECT_KIND, spellEffectById } from "../../shared/spell-effects.ts";
import type { TokenEffectRepository, TokenWrite } from "../ports/token-effect-repository.ts";
import type { TokenRow } from "../types.ts";
import { commandError, type CommandContext, type CommandOutcome } from "./types.ts";

export type TokenEffectCommandContext = CommandContext & {
  repository: TokenEffectRepository;
  canControl(token: TokenRow): Promise<boolean>;
  isAllowedArt(value: unknown): Promise<boolean>;
};

export async function createSpellEffect(context: TokenEffectCommandContext): Promise<CommandOutcome> {
  const spell = spellEffectById(context.body.spellId);
  if (!spell) return commandError("That spell effect is not available.", 400);
  const summonerTokenId = cleanId(context.body.summonerTokenId) || null;
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
    x: clamp(context.body.x, context.encounter.gridWidth, spell.size),
    y: clamp(context.body.y, context.encounter.gridHeight, spell.size),
    speed: 0,
    hp: null,
    maxHp: null,
    hidden: false,
    summonerTokenId,
    artAsset: spell.artAsset,
    initiative: summoner?.initiative ?? null,
    initiativeOrder: summoner?.initiative_order ?? null,
  });
}

export async function createToken(context: TokenEffectCommandContext): Promise<CommandOutcome> {
  const name = cleanText(context.body.name, 48);
  if (!name) return commandError("Token name is required.", 400);
  const requestedKind = ["character", "monster", "summon", "familiar"].includes(String(context.body.kind))
    ? String(context.body.kind)
    : "monster";
  const requestedArt = String(context.body.artAsset ?? "");
  const artAsset = await context.isAllowedArt(requestedArt) ? requestedArt : null;
  const size: CreatureSize = isCreatureSize(context.body.size) ? context.body.size : "medium";
  const maxHp = Number.isFinite(Number(context.body.maxHp))
    ? Math.max(1, Math.trunc(Number(context.body.maxHp)))
    : null;
  const hp = maxHp === null
    ? null
    : Math.min(maxHp, Math.max(0, Math.trunc(Number(context.body.hp)) || maxHp));
  const summonerTokenId = cleanId(context.body.summonerTokenId) || null;
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
    x: clamp(context.body.x, context.encounter.gridWidth, size),
    y: clamp(context.body.y, context.encounter.gridHeight, size),
    speed: Math.min(120, Math.max(0, Math.trunc(Number(context.body.speed)) || 30)),
    hp,
    maxHp,
    hidden: context.participant.role === "dm" && Boolean(context.body.hidden),
    summonerTokenId,
    artAsset,
    initiative: summoner?.initiative ?? null,
    initiativeOrder: summoner?.initiative_order ?? null,
  });
}

export async function resizeSpellEffect(context: TokenEffectCommandContext): Promise<CommandOutcome> {
  const tokenId = cleanId(context.body.tokenId);
  const token = await context.repository.findToken(context.encounter.id, tokenId);
  if (!token || token.kind !== SPELL_EFFECT_KIND) return commandError("Spell effect not found.", 404);
  if (!await context.canControl(token)) return commandError("You cannot resize this spell effect.", 403);
  if (!isSpellAreaSize(context.body.size)) {
    return commandError("Choose a spell footprint from 5 to 20 feet.", 400);
  }
  const size = context.body.size;
  const x = clamp(token.x, context.encounter.gridWidth, size);
  const y = clamp(token.y, context.encounter.gridHeight, size);
  await context.repository.resizeToken(context.encounter.id, tokenId, size, x, y, context.now);
  await finish(context, "token_updated", tokenChange(token, { ...token, size, x, y }));
  return success(context, { updated: true });
}

export async function updateToken(context: TokenEffectCommandContext): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const tokenId = cleanId(context.body.tokenId);
  const token = await context.repository.findToken(context.encounter.id, tokenId);
  if (!token) return commandError("Token not found.", 404);
  const requestedArt = String(context.body.artAsset ?? "");
  const artAsset = await context.isAllowedArt(requestedArt)
    ? requestedArt
    : context.body.artAsset === "" ? null : token.art_asset;
  const size: CreatureSize = isCreatureSize(context.body.size) ? context.body.size : token.size;
  const maxHp = Number.isFinite(Number(context.body.maxHp))
    ? Math.max(1, Math.trunc(Number(context.body.maxHp)))
    : token.max_hp;
  const next: TokenWrite = {
    id: tokenId,
    encounterId: context.encounter.id,
    name: cleanText(context.body.name, 48) || token.name,
    size,
    speed: Number.isFinite(Number(context.body.speed))
      ? Math.min(120, Math.max(0, Math.trunc(Number(context.body.speed))))
      : token.speed,
    hp: maxHp === null ? null : Math.min(maxHp, token.hp ?? maxHp),
    maxHp,
    hidden: typeof context.body.hidden === "boolean" ? context.body.hidden : Boolean(token.is_hidden),
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
    hp: next.hp,
    max_hp: next.maxHp,
    is_hidden: next.hidden ? 1 : 0,
    art_asset: next.artAsset,
    x: next.x,
    y: next.y,
  }));
  return success(context, { updated: true });
}

export async function applyHp(context: TokenEffectCommandContext): Promise<CommandOutcome> {
  const tokenId = cleanId(context.body.tokenId);
  const token = await context.repository.findToken(context.encounter.id, tokenId);
  if (!token) return commandError("Token not found.", 404);
  if (!await context.canControl(token)) return commandError("You cannot change this token's HP.", 403);
  if (token.max_hp === null) {
    return commandError("Configure maximum HP before applying damage or healing.", 409);
  }
  const delta = Math.trunc(Number(context.body.delta));
  if (!Number.isFinite(delta) || delta === 0) {
    return commandError("Enter non-zero damage or healing.", 400);
  }
  const from = token.hp ?? token.max_hp;
  const hp = Math.min(token.max_hp, Math.max(0, from + delta));
  const concentrationCheckRequired = delta < 0 && await context.repository.hasConcentration(tokenId);
  await context.repository.updateHp(context.encounter.id, tokenId, hp, context.now);
  await finish(context, "hp_changed", { tokenId, from, to: hp, concentrationCheckRequired });
  return success(context, { updated: true, concentrationCheckRequired });
}

export async function addEffect(context: TokenEffectCommandContext): Promise<CommandOutcome> {
  const tokenId = cleanId(context.body.tokenId);
  const token = await context.repository.findToken(context.encounter.id, tokenId);
  if (!token) return commandError("Token not found.", 404);
  if (!await context.canControl(token)) return commandError("You cannot add an effect to this token.", 403);
  const name = cleanText(context.body.name, 48);
  if (!name) return commandError("Effect name is required.", 400);
  const effectType = ["condition", "effect", "concentration"].includes(String(context.body.effectType))
    ? String(context.body.effectType)
    : "condition";
  const durationRounds = Number.isFinite(Number(context.body.durationRounds))
    ? Math.max(1, Math.min(99, Math.trunc(Number(context.body.durationRounds))))
    : null;
  const expiresRound = durationRounds === null
    ? null
    : Math.max(1, context.encounter.currentRound || 1) + durationRounds;
  const reminderTiming = context.body.reminderTiming === "start" ? "start" : "end";
  const effectId = context.services.createId();
  const effect = {
    id: effectId, tokenId, name, effectType, durationRounds, expiresRound,
    reminderTiming, createdBy: context.participant.id, createdAt: context.now,
  };
  await context.repository.addEffect({
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
  });
  await finish(context, "effect_added", { effectId, tokenId, effect });
  return success(context, { added: true, effectId });
}

export async function removeEffect(context: TokenEffectCommandContext): Promise<CommandOutcome> {
  const effectId = cleanId(context.body.effectId);
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

export async function deleteToken(context: TokenEffectCommandContext): Promise<CommandOutcome> {
  const tokenId = cleanId(context.body.tokenId);
  const token = await context.repository.findToken(context.encounter.id, tokenId);
  if (!token) return commandError("Token not found.", 404);
  if (context.participant.role !== "dm" &&
      (token.kind !== SPELL_EFFECT_KIND || !await context.canControl(token))) {
    return commandError("Only the DM can delete this token.", 403);
  }
  await context.repository.deleteToken(context.encounter.id, tokenId);
  await finish(context, "token_deleted", { tokenId });
  return success(context, { deleted: true });
}

async function createTokenEntity(
  context: TokenEffectCommandContext,
  token: Omit<TokenWrite, "id" | "encounterId" | "now">,
): Promise<CommandOutcome> {
  const tokenId = context.services.createId();
  await context.repository.createToken({
    ...token,
    id: tokenId,
    encounterId: context.encounter.id,
    now: context.now,
  });
  await finish(context, "token_created", {
    tokenId,
    token: {
      tokenId, name: token.name, kind: token.kind, size: token.size, x: token.x, y: token.y,
      speed: token.speed, hp: token.hp, maxHp: token.maxHp, hidden: token.hidden,
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
    hp: token.hp, maxHp: token.max_hp, hidden: Boolean(token.is_hidden), artAsset: token.art_asset,
  });
  return { tokenId: previous.id, previous: view(previous), next: view(next) };
}

function clamp(value: unknown, limit: number, size: CreatureSize) {
  const radius = tokenRadiusCells(size);
  const numeric = Number(value);
  const fallback = limit / 2;
  return Math.round(Math.min(limit - radius, Math.max(radius, Number.isFinite(numeric) ? numeric : fallback)) * 1_000) / 1_000;
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function cleanId(value: unknown) {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) : "";
}

function requireDm(context: TokenEffectCommandContext) {
  return context.participant.role === "dm" ? null : commandError("This action requires the DM role.", 403);
}

async function finish(context: TokenEffectCommandContext, type: string, payload: Record<string, unknown>) {
  await context.services.bumpEncounter();
  await context.services.recordAction(type, payload);
}

async function success(context: TokenEffectCommandContext, payload: Record<string, unknown>): Promise<CommandOutcome> {
  return { payload: { ...payload, state: await context.services.loadState() } };
}
