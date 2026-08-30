import {
  adjudicatedDamage,
  damageDiceCount,
  resolveAttackRoll,
  transitionDamageWithTemporaryHp,
  validateCombatActionValues,
  type CombatActionValues,
  type DamageAdjudication,
  type DiceFormula,
} from "../../shared/combat-rolling.ts";
import { MAX_COMBAT_ACTIONS_PER_OWNER } from "../../shared/resource-limits.ts";
import type { CombatActionProfileRow, CombatRollRepository } from "../ports/combat-roll-repository.ts";
import type { TokenRow } from "../types.ts";
import { commandError, requireDm, type CommandContextFor, type CommandOutcome } from "./types.ts";

type CombatCommandName = "save-combat-action" | "delete-combat-action" | "roll-attack" | "release-attack-outcome" | "roll-damage" | "adjudicate-damage";
type CombatDependencies = {
  repository: CombatRollRepository;
  canControl(token: TokenRow): Promise<boolean>;
  rollDie(sides: number): number;
};
export type CombatRollCommandContext<Name extends CombatCommandName = CombatCommandName> =
  CommandContextFor<Name, CombatDependencies>;

export async function saveCombatAction(context: CombatRollCommandContext<"save-combat-action">): Promise<CommandOutcome> {
  const values = validateCombatActionValues(context.payload.values);
  if (!values) return commandError("Combat action values are invalid.", 400);
  const ownerAllowed = await canMaintainOwner(context, context.payload.ownerType, context.payload.ownerId);
  if (!ownerAllowed) return commandError("You cannot maintain combat actions for that owner.", 403);
  const actionId = cleanId(context.payload.actionId) || context.services.createId();
  const existing = context.payload.actionId ? await context.repository.findAction(actionId) : null;
  if (context.payload.actionId && !existing) return commandError("Combat action not found.", 404);
  if (existing && !actionMatchesOwner(existing, context.payload.ownerType, context.payload.ownerId)) {
    return commandError("Combat action belongs to a different owner.", 409);
  }
  if (!existing && await context.repository.countActions(context.payload.ownerType, context.payload.ownerId) >= MAX_COMBAT_ACTIONS_PER_OWNER) {
    return commandError("This character or creature has reached its combat action limit.", 409);
  }
  const saved = await context.repository.saveAction({
    id: actionId,
    ownerType: context.payload.ownerType,
    ownerId: context.payload.ownerId,
    values,
    sourceKind: context.payload.ownerType === "creature" ? "catalog-maintained" : "manual-character",
    sourceRef: null,
    now: context.now,
  });
  if (!saved) return commandError("This character or creature has reached its combat action limit.", 409);
  await context.services.commit(null);
  return success(context, { saved: true, actionId });
}

export async function deleteCombatAction(context: CombatRollCommandContext<"delete-combat-action">): Promise<CommandOutcome> {
  const actionId = cleanId(context.payload.actionId);
  const action = await context.repository.findAction(actionId);
  if (!action) return commandError("Combat action not found.", 404);
  const ownerType = action.campaign_character_id ? "character" : "creature";
  const ownerId = action.campaign_character_id ?? action.creature_catalog_id!;
  if (!await canMaintainOwner(context, ownerType, ownerId)) {
    return commandError("You cannot delete that combat action.", 403);
  }
  await context.repository.deleteAction(actionId);
  await context.services.commit(null);
  return success(context, { deleted: true });
}

export async function rollAttack(context: CombatRollCommandContext<"roll-attack">): Promise<CommandOutcome> {
  const operationId = cleanOperationId(context.payload.operationId);
  if (!operationId) return commandError("A valid operation ID is required.", 400);
  const prior = await context.repository.findRollByOperation(context.encounter.id, operationId);
  if (prior) {
    const proposal = await context.repository.findProposalByRoll(context.encounter.id, prior.id);
    return success(context, { rolled: true, rollId: prior.id, proposalId: proposal?.id ?? null, recovered: true });
  }
  const attacker = await context.repository.findToken(context.encounter.id, cleanId(context.payload.attackerTokenId));
  const target = await context.repository.findToken(context.encounter.id, cleanId(context.payload.targetTokenId));
  if (!attacker || !target) return commandError("Attacker or target not found.", 404);
  if (!await context.canControl(attacker)) return commandError("You cannot attack from that token.", 403);
  if (attacker.id === target.id) return commandError("Choose a different target.", 400);

  const selected = await selectedAction(context, attacker);
  if (!("values" in selected)) return selected;
  const { values, profileId, source } = selected;
  const formula = context.payload.alternateDamage && values.alternateDamage
    ? values.alternateDamage.formula
    : values.damage;
  const automaticDamage = values.resolutionMode === "automatic-damage";
  const bless = automaticDamage ? false : await context.repository.hasBless(context.encounter.id, attacker.id);
  const attackDice = automaticDamage
    ? []
    : Array.from({ length: context.payload.rollMode === "normal" ? 1 : 2 }, () => context.rollDie(20));
  const resolution = automaticDamage
    ? { attackDice: [], keptD20: 0, attackBonus: 0, blessDie: null, attackTotal: 0, outcome: "hit" as const }
    : resolveAttackRoll({
        rollMode: context.payload.rollMode,
        attackDice,
        attackBonus: values.attackBonus,
        blessDie: bless ? context.rollDie(4) : null,
        targetArmorClass: target.armor_class,
      });
  if (!resolution) return commandError("Unable to resolve that attack.", 400);
  const rollId = context.services.createId();
  const snapshot = {
    ...values,
    damage: formula,
    alternateDamageUsed: Boolean(context.payload.alternateDamage && values.alternateDamage),
    attackerName: attacker.name,
    targetName: target.name,
    blessApplied: bless,
  };
  await context.repository.createRoll({
    id: rollId,
    encounterId: context.encounter.id,
    operationId,
    participantId: context.participant.id,
    authenticatedActorIdentityId: context.participant.authenticatedActorIdentityId ?? context.participant.identityId ?? null,
    attackerTokenId: attacker.id,
    targetTokenId: target.id,
    actionProfileId: profileId,
    actionSource: source,
    actionSnapshotJson: JSON.stringify(snapshot),
    rollMode: context.payload.rollMode,
    attackDiceJson: JSON.stringify(resolution.attackDice),
    keptD20: resolution.keptD20,
    blessDie: resolution.blessDie,
    attackTotal: resolution.attackTotal,
    outcome: resolution.outcome,
    dmPrivate: context.participant.role === "dm" && !automaticDamage,
    damageDiceJson: "[]",
    damageTotal: 0,
    inTurn: context.encounter.status === "active" && attacker.initiative_order !== null &&
      attacker.initiative_order === context.encounter.activeInitiativeOrder,
    now: context.now,
  });
  await context.services.commit(null);
  return success(context, {
    rolled: true,
    rollId,
    proposalId: null,
    result: {
      attackDice: resolution.attackDice,
      keptD20: resolution.keptD20,
      blessDie: resolution.blessDie,
      attackTotal: resolution.attackTotal,
      outcome: resolution.outcome,
      damageDice: [],
      damageTotal: null,
    },
  });
}

export async function releaseAttackOutcome(context: CombatRollCommandContext<"release-attack-outcome">): Promise<CommandOutcome> {
  const dmError = requireDm(context);
  if (dmError) return dmError;
  const roll = await context.repository.findRoll(context.encounter.id, cleanId(context.payload.rollId));
  if (!roll) return commandError("Combat roll not found.", 404);
  if (!roll.dm_private) return commandError("Only private DM attacks have a releasable verdict.", 409);
  if (context.payload.outcome !== "miss" && context.payload.outcome !== "hit" && context.payload.outcome !== "critical") {
    return commandError("Choose a valid attack verdict.", 400);
  }
  if (context.payload.outcome === "critical" && roll.outcome !== "critical") {
    return commandError("Only a calculated critical hit can be released as critical.", 400);
  }
  if (roll.released_outcome === context.payload.outcome) {
    return success(context, { released: true, rollId: roll.id, outcome: context.payload.outcome, recovered: true });
  }
  if (roll.damage_rolled_at !== null) return commandError("The released verdict cannot change after damage is rolled.", 409);
  await context.repository.releaseAttackOutcome({
    encounterId: context.encounter.id,
    rollId: roll.id,
    outcome: context.payload.outcome,
    now: context.now,
  });
  await context.services.commit(null);
  return success(context, { released: true, rollId: roll.id, outcome: context.payload.outcome });
}

export async function rollDamage(context: CombatRollCommandContext<"roll-damage">): Promise<CommandOutcome> {
  const operationId = cleanOperationId(context.payload.operationId);
  if (!operationId) return commandError("A valid operation ID is required.", 400);
  const roll = await context.repository.findRoll(context.encounter.id, cleanId(context.payload.rollId));
  if (!roll) return commandError("Combat roll not found.", 404);
  if (roll.participant_id !== context.participant.id && context.participant.role !== "dm") {
    return commandError("Only the original roller or the DM can roll this damage.", 403);
  }
  const damageOutcome = roll.dm_private ? roll.released_outcome : roll.outcome;
  if (roll.dm_private && damageOutcome === null) {
    return commandError("Release the attack verdict before rolling damage.", 409);
  }
  if (damageOutcome !== "hit" && damageOutcome !== "critical") {
    return commandError("That attack did not produce damage to roll.", 409);
  }
  const existingProposal = await context.repository.findProposalByRoll(context.encounter.id, roll.id);
  if (roll.damage_rolled_at !== null || existingProposal) {
    return success(context, {
      damageRolled: true,
      rollId: roll.id,
      proposalId: existingProposal?.id ?? null,
      recovered: true,
    });
  }

  let snapshot: unknown;
  try { snapshot = JSON.parse(roll.action_snapshot_json); } catch { return commandError("The attack snapshot is invalid.", 409); }
  const action = validateCombatActionValues(snapshot);
  if (!action) return commandError("The attack snapshot is invalid.", 409);
  const damageDice = rollFormulaDice(action.damage, damageOutcome === "critical", context.rollDie);
  const damageTotal = Math.max(0, damageDice.reduce((sum, die) => sum + die, 0) + action.damage.modifier);
  const proposalId = context.services.createId();
  await context.repository.recordDamage({
    encounterId: context.encounter.id,
    rollId: roll.id,
    proposalId,
    targetTokenId: roll.target_token_id,
    damageDiceJson: JSON.stringify(damageDice),
    damageTotal,
    now: context.now,
  });
  await context.services.commit(null);
  return success(context, { damageRolled: true, rollId: roll.id, proposalId, damageDice, damageTotal });
}

export async function adjudicateDamage(context: CombatRollCommandContext<"adjudicate-damage">): Promise<CommandOutcome> {
  const dmError = requireDm(context);
  if (dmError) return dmError;
  const proposal = await context.repository.findProposal(context.encounter.id, cleanId(context.payload.proposalId));
  if (!proposal) return commandError("Damage proposal not found.", 404);
  if (proposal.status !== "pending") {
    return success(context, { adjudicated: true, proposalId: proposal.id, recovered: true });
  }
  const finalDamage = adjudicatedDamage({
    rolledDamage: proposal.rolled_damage,
    method: context.payload.method,
    adjustedDamage: context.payload.adjustedDamage,
  });
  if (finalDamage === null) return commandError("The adjusted damage amount is invalid.", 400);
  const target = await context.repository.findToken(context.encounter.id, proposal.target_token_id);
  if (!target || target.max_hp === null) return commandError("Configure the target's maximum HP before applying damage.", 409);
  const transition = transitionDamageWithTemporaryHp({
    hp: target.hp,
    maxHp: target.max_hp,
    temporaryHp: target.temporary_hp,
    damage: finalDamage,
  });
  if (!transition) return commandError("Unable to apply that damage amount.", 400);
  const status = proposalStatus(context.payload.method);
  const historyActionId = finalDamage > 0 ? context.services.createId() : null;
  const note = cleanNote(context.payload.note);
  await context.repository.resolveProposal({
    encounterId: context.encounter.id,
    proposalId: proposal.id,
    expectedStatus: "pending",
    status,
    finalDamage,
    method: context.payload.method,
    participantId: context.participant.id,
    note,
    historyActionId,
    now: context.now,
  });
  if (finalDamage > 0) {
    await context.repository.updateHp(context.encounter.id, target.id, transition.hp, transition.temporaryHp, context.now);
  }
  const concentrationCheckRequired = finalDamage > 0 &&
    await context.repository.hasConcentration(context.encounter.id, target.id);
  await context.services.commit(
    finalDamage > 0 ? "hp_changed" : null,
    finalDamage > 0 ? {
      tokenId: target.id,
      from: target.hp ?? target.max_hp,
      to: transition.hp,
      fromTemporaryHp: target.temporary_hp,
      toTemporaryHp: transition.temporaryHp,
      concentrationCheckRequired,
      damageProposalId: proposal.id,
    } : {},
    historyActionId,
  );
  return success(context, { adjudicated: true, proposalId: proposal.id, finalDamage, concentrationCheckRequired });
}

async function selectedAction(
  context: CombatRollCommandContext<"roll-attack">,
  attacker: TokenRow,
): Promise<{ values: CombatActionValues; profileId: string | null; source: string } | CommandOutcome> {
  if (context.payload.actionProfileId) {
    const profile = await context.repository.findActionForToken(cleanId(context.payload.actionProfileId), attacker);
    if (!profile) return commandError("That combat action is not available to the attacker.", 404);
    const values = actionValues(profile);
    if (!values) return commandError("That combat action needs maintenance before it can be rolled.", 409);
    return { values, profileId: profile.id, source: profile.source_kind };
  }
  if (context.participant.role !== "dm" || !context.payload.adHocAction) {
    return commandError("Choose a configured combat action.", 400);
  }
  if (await context.repository.countActionsForToken(attacker) > 0) {
    return commandError("Use one of this creature's configured combat actions.", 409);
  }
  const values = validateCombatActionValues(context.payload.adHocAction);
  if (!values) return commandError("Generic Attack values are invalid.", 400);
  return { values, profileId: null, source: "dm-ad-hoc" };
}

function actionValues(row: CombatActionProfileRow): CombatActionValues | null {
  let alternateDamage: unknown = null;
  try { alternateDamage = row.alternate_damage_json ? JSON.parse(row.alternate_damage_json) : null; } catch { return null; }
  return validateCombatActionValues({
    name: row.name,
    resolutionMode: row.resolution_mode,
    attackBonus: row.attack_bonus,
    attackKind: row.attack_kind,
    damage: { count: row.damage_dice_count, sides: row.damage_die_size, modifier: row.damage_modifier },
    damageType: row.damage_type,
    reachFeet: row.reach_feet,
    rangeFeet: row.range_feet,
    manualRider: Boolean(row.manual_rider),
    manualRiderText: row.manual_rider_text,
    alternateDamage,
  });
}

async function canMaintainOwner(
  context: CombatRollCommandContext<"save-combat-action" | "delete-combat-action">,
  ownerType: "character" | "creature",
  ownerId: string,
): Promise<boolean> {
  if (ownerType === "creature") {
    return context.participant.role === "dm" && await context.repository.creatureExists(ownerId);
  }
  if (!await context.repository.characterBelongsToCampaign(ownerId, context.encounter.campaignId)) return false;
  if (context.participant.role === "dm") return true;
  return Boolean(context.participant.identityId &&
    context.participant.identityId === await context.repository.characterControllerIdentity(ownerId));
}

function actionMatchesOwner(row: CombatActionProfileRow, ownerType: "character" | "creature", ownerId: string) {
  return ownerType === "character" ? row.campaign_character_id === ownerId : row.creature_catalog_id === ownerId;
}

function rollFormulaDice(formula: DiceFormula, critical: boolean, rollDie: (sides: number) => number): number[] {
  return Array.from({ length: damageDiceCount(formula, critical) }, () => rollDie(formula.sides));
}

function proposalStatus(method: DamageAdjudication): "applied" | "adjusted" | "immune" | "rejected" | "cancelled" {
  if (method === "adjust") return "adjusted";
  if (method === "immune") return "immune";
  if (method === "reject") return "rejected";
  if (method === "cancel") return "cancelled";
  return "applied";
}

function cleanNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().replace(/\s+/g, " ").slice(0, 160) || null;
}

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96) : "";
}

function cleanOperationId(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,96}$/.test(value) ? value : "";
}

async function success(context: CombatRollCommandContext, payload: Record<string, unknown>): Promise<CommandOutcome> {
  return { payload: { ...payload, state: await context.services.loadState() } };
}
