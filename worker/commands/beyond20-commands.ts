import { beyond20HpTransition } from "../../shared/beyond20-hp.ts";
import type { Beyond20Repository } from "../ports/beyond20-repository.ts";
import type { TokenEffectRepository } from "../ports/token-effect-repository.ts";
import { commandError, requireDm, type CommandContextFor, type CommandOutcome } from "./types.ts";

export type Beyond20Context<Name extends "link-beyond20" | "sync-beyond20-hp"> = CommandContextFor<Name, {
  links: Beyond20Repository; tokens: TokenEffectRepository;
}>;

export async function linkBeyond20(context: Beyond20Context<"link-beyond20">): Promise<CommandOutcome> {
  const denied = requireDm(context);
  if (denied) return denied;
  const { tokenId, characterId: sheetId } = context.payload;
  const link = await context.links.findLink(context.encounter.campaignId, tokenId, context.encounter.id);
  if (!link) return commandError("Choose an active campaign character, not a summon.", 404);
  if (sheetId !== null && !/^\d{1,20}$/.test(sheetId)) return commandError("Enter the numeric D&D Beyond character ID.", 400);
  if (sheetId && await context.links.sheetInUse(context.encounter.campaignId, link.characterId, sheetId)) return commandError("That sheet is already linked to another character in this campaign.", 409);
  if (link.sheetId !== sheetId) {
    await context.links.setLink(context.encounter.campaignId, link.characterId, sheetId, context.encounter.id, context.now);
    await context.services.commit(null);
  }
  return { payload: { linked: true, state: await context.services.loadState() } };
}

export async function syncBeyond20Hp(context: Beyond20Context<"sync-beyond20-hp">): Promise<CommandOutcome> {
  const { tokenId, characterId, expectedHp, expectedTemporaryHp } = context.payload;
  const link = await context.links.findLink(context.encounter.campaignId, tokenId, context.encounter.id);
  // Even a DM cannot forward someone else's sheet under their own session.
  if (!link || !context.participant.identityId || link.controllerIdentityId !== context.participant.identityId) return commandError("You can sync only your own campaign character.", 403);
  if (!link.sheetId || link.sheetId !== characterId) return commandError("This sheet isn't linked to your campaign character.", 403);
  const token = await context.tokens.findToken(context.encounter.id, tokenId);
  if (!token) return commandError("Character token not found.", 404);
  const next = beyond20HpTransition({ hp: token.hp, maxHp: token.max_hp, temporaryHp: token.temporary_hp }, context.payload);
  if ("error" in next) return commandError(next.error, 409);
  if (!next.changed) return { payload: { updated: false, concentrationCheckRequired: false, state: await context.services.loadState() } };
  if (token.hp !== expectedHp || (token.temporary_hp ?? 0) !== expectedTemporaryHp) return commandError("HP changed on the map while syncing. Review both sheets and enable sync again.", 409);
  const concentrationCheckRequired = next.decreased && await context.tokens.hasConcentration(context.encounter.id, tokenId);
  await context.tokens.updateHp(context.encounter.id, tokenId, next.hp, next.temporaryHp, context.now);
  await context.services.commit("hp_changed", {
    tokenId, from: token.hp, to: next.hp, fromTemporaryHp: token.temporary_hp ?? 0, toTemporaryHp: next.temporaryHp,
    concentrationCheckRequired, source: "beyond20",
  });
  return { payload: { updated: true, concentrationCheckRequired, state: await context.services.loadState() } };
}
