import { MAX_COMBAT_ACTIONS_PER_OWNER } from "../../shared/resource-limits.ts";
import type {
  CombatActionProfileRow,
  CombatRollRepository,
  CombatRollRow,
  DamageProposalRow,
} from "../ports/combat-roll-repository.ts";
import type { TokenRow } from "../types.ts";

const TOKEN_COLUMNS = `id, name, x, y, art_asset, kind, size, speed, fly_speed, swim_speed,
  climb_speed, burrow_speed, armor_class, hp, max_hp, temporary_hp, catalog_creature_id, is_hidden,
  summoner_token_id, campaign_character_id, initiative, initiative_group_id, initiative_order, turn_complete,
  movement_used, altitude, movement_origin_x, movement_origin_y, owner_participant_id, owner_name`;

const ACTION_COLUMNS = `id, campaign_character_id, creature_catalog_id, name, attack_bonus, attack_kind,
  damage_dice_count, damage_die_size, damage_modifier, damage_type, reach_feet, range_feet,
  manual_rider, manual_rider_text, alternate_damage_json, source_kind, source_ref, sort_order, is_enabled, created_at, updated_at`;

export function createD1CombatRollRepository(db: D1Database): CombatRollRepository {
  return {
    async findToken(encounterId, tokenId) {
      return await db.prepare(`SELECT ${TOKEN_COLUMNS} FROM tokens WHERE encounter_id = ? AND id = ?`)
        .bind(encounterId, tokenId).first<TokenRow>() ?? null;
    },
    async findAction(actionId) {
      return await db.prepare(`SELECT ${ACTION_COLUMNS} FROM combat_action_profiles WHERE id = ?`)
        .bind(actionId).first<CombatActionProfileRow>() ?? null;
    },
    async findActionForToken(actionId, token) {
      const row = await db.prepare(
        `SELECT ${ACTION_COLUMNS} FROM combat_action_profiles
         WHERE id = ? AND is_enabled = 1
           AND ((campaign_character_id IS NOT NULL AND campaign_character_id = ?)
             OR (creature_catalog_id IS NOT NULL AND creature_catalog_id = ?))`,
      ).bind(actionId, token.campaign_character_id, token.catalog_creature_id ?? null)
        .first<CombatActionProfileRow>();
      return row ?? null;
    },
    async countActionsForToken(token) {
      const row = await db.prepare(
        `SELECT COUNT(*) AS value FROM combat_action_profiles
         WHERE is_enabled = 1 AND (
           (campaign_character_id IS NOT NULL AND campaign_character_id = ?)
           OR (creature_catalog_id IS NOT NULL AND creature_catalog_id = ?)
         )`,
      ).bind(token.campaign_character_id, token.catalog_creature_id ?? null).first<{ value: number }>();
      return Number(row?.value) || 0;
    },
    async countActions(ownerType, ownerId) {
      const column = ownerType === "character" ? "campaign_character_id" : "creature_catalog_id";
      const row = await db.prepare(`SELECT COUNT(*) AS value FROM combat_action_profiles WHERE ${column} = ?`)
        .bind(ownerId).first<{ value: number }>();
      return Number(row?.value) || 0;
    },
    async saveAction(input) {
      const characterId = input.ownerType === "character" ? input.ownerId : null;
      const creatureId = input.ownerType === "creature" ? input.ownerId : null;
      const existing = await db.prepare("SELECT id FROM combat_action_profiles WHERE id = ?")
        .bind(input.id).first<{ id: string }>();
      if (!existing) {
        const column = input.ownerType === "character" ? "campaign_character_id" : "creature_catalog_id";
        const count = await db.prepare(`SELECT COUNT(*) AS value FROM combat_action_profiles WHERE ${column} = ?`)
          .bind(input.ownerId).first<{ value: number }>();
        if ((Number(count?.value) || 0) >= MAX_COMBAT_ACTIONS_PER_OWNER) return false;
      }
      const alternateDamageJson = input.values.alternateDamage ? JSON.stringify(input.values.alternateDamage) : null;
      await db.prepare(
        `INSERT INTO combat_action_profiles
         (id, campaign_character_id, creature_catalog_id, name, resolution_mode, attack_bonus, attack_kind,
          damage_dice_count, damage_die_size, damage_modifier, damage_type, reach_feet, range_feet,
          manual_rider, manual_rider_text, alternate_damage_json, source_kind, source_ref, sort_order, is_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'attack-vs-ac', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, attack_bonus = excluded.attack_bonus, attack_kind = excluded.attack_kind,
          damage_dice_count = excluded.damage_dice_count, damage_die_size = excluded.damage_die_size,
          damage_modifier = excluded.damage_modifier, damage_type = excluded.damage_type,
          reach_feet = excluded.reach_feet, range_feet = excluded.range_feet,
          manual_rider = excluded.manual_rider, manual_rider_text = excluded.manual_rider_text,
          alternate_damage_json = excluded.alternate_damage_json,
          source_kind = excluded.source_kind, source_ref = excluded.source_ref, updated_at = excluded.updated_at
         WHERE combat_action_profiles.campaign_character_id IS excluded.campaign_character_id
           AND combat_action_profiles.creature_catalog_id IS excluded.creature_catalog_id`,
      ).bind(
        input.id, characterId, creatureId, input.values.name, input.values.attackBonus,
        input.values.attackKind, input.values.damage.count, input.values.damage.sides,
        input.values.damage.modifier, input.values.damageType, input.values.reachFeet,
        input.values.rangeFeet, input.values.manualRider ? 1 : 0, input.values.manualRiderText, alternateDamageJson,
        input.sourceKind, input.sourceRef, input.now, input.now,
      ).run();
      return true;
    },
    async deleteAction(actionId) {
      await db.prepare("DELETE FROM combat_action_profiles WHERE id = ?").bind(actionId).run();
    },
    async characterBelongsToCampaign(characterId, campaignId) {
      return Boolean(await db.prepare(
        "SELECT 1 AS found FROM campaign_characters WHERE id = ? AND campaign_id = ?",
      ).bind(characterId, campaignId).first());
    },
    async characterControllerIdentity(characterId) {
      const row = await db.prepare(
        `SELECT cm.identity_id FROM campaign_characters cc
         JOIN campaign_memberships cm ON cm.id = cc.controller_membership_id WHERE cc.id = ?`,
      ).bind(characterId).first<{ identity_id: string }>();
      return row?.identity_id ?? null;
    },
    async creatureExists(creatureId) {
      return Boolean(await db.prepare("SELECT 1 AS found FROM creature_catalog WHERE id = ?")
        .bind(creatureId).first());
    },
    async hasBless(encounterId, tokenId) {
      return Boolean(await db.prepare(
        "SELECT 1 AS found FROM effects WHERE encounter_id = ? AND token_id = ? AND lower(trim(name)) = 'bless' LIMIT 1",
      ).bind(encounterId, tokenId).first());
    },
    async findRollByOperation(encounterId, operationId) {
      return await db.prepare(
        "SELECT * FROM combat_rolls WHERE encounter_id = ? AND operation_id = ?",
      ).bind(encounterId, operationId).first<CombatRollRow>() ?? null;
    },
    async findRoll(encounterId, rollId) {
      return await db.prepare(
        "SELECT * FROM combat_rolls WHERE encounter_id = ? AND id = ?",
      ).bind(encounterId, rollId).first<CombatRollRow>() ?? null;
    },
    async createRoll(input) {
      await db.prepare(
        `INSERT INTO combat_rolls
         (id, encounter_id, operation_id, participant_id, authenticated_actor_identity_id,
          attacker_token_id, target_token_id, action_profile_id, action_source, action_snapshot_json,
          roll_mode, attack_dice_json, kept_d20, bless_die, attack_total, outcome, dm_private,
          damage_dice_json, damage_total, in_turn, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.id, input.encounterId, input.operationId, input.participantId,
        input.authenticatedActorIdentityId, input.attackerTokenId, input.targetTokenId,
        input.actionProfileId, input.actionSource, input.actionSnapshotJson, input.rollMode,
        input.attackDiceJson, input.keptD20, input.blessDie, input.attackTotal, input.outcome,
        input.dmPrivate ? 1 : 0, input.damageDiceJson, input.damageTotal, input.inTurn ? 1 : 0, input.now,
      ).run();
    },
    async releaseAttackOutcome(input) {
      await db.prepare(
        `UPDATE combat_rolls SET released_outcome = ?, outcome_released_at = ?
         WHERE encounter_id = ? AND id = ? AND dm_private = 1 AND damage_rolled_at IS NULL`,
      ).bind(input.outcome, input.now, input.encounterId, input.rollId).run();
    },
    async findProposalByRoll(encounterId, rollId) {
      return await db.prepare(
        "SELECT * FROM damage_proposals WHERE encounter_id = ? AND roll_id = ?",
      ).bind(encounterId, rollId).first<DamageProposalRow>() ?? null;
    },
    async recordDamage(input) {
      await db.batch([
        db.prepare(
          `UPDATE combat_rolls SET damage_dice_json = ?, damage_total = ?, damage_rolled_at = ?
           WHERE encounter_id = ? AND id = ? AND damage_rolled_at IS NULL`,
        ).bind(input.damageDiceJson, input.damageTotal, input.now, input.encounterId, input.rollId),
        db.prepare(
          `INSERT INTO damage_proposals
           (id, encounter_id, roll_id, target_token_id, status, rolled_damage, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
        ).bind(input.proposalId, input.encounterId, input.rollId, input.targetTokenId, input.damageTotal, input.now),
      ]);
    },
    async findProposal(encounterId, proposalId) {
      return await db.prepare(
        "SELECT * FROM damage_proposals WHERE encounter_id = ? AND id = ?",
      ).bind(encounterId, proposalId).first<DamageProposalRow>() ?? null;
    },
    async resolveProposal(input) {
      await db.prepare(
        `UPDATE damage_proposals SET status = ?, final_damage = ?, adjudication_method = ?,
         adjudicated_by_participant_id = ?, adjudication_note = ?, history_action_id = ?, resolved_at = ?
         WHERE encounter_id = ? AND id = ? AND status = ?`,
      ).bind(
        input.status, input.finalDamage, input.method, input.participantId, input.note,
        input.historyActionId, input.now, input.encounterId, input.proposalId, input.expectedStatus,
      ).run();
    },
    async updateHp(encounterId, tokenId, hp, temporaryHp, now) {
      await db.prepare(
        "UPDATE tokens SET hp = ?, temporary_hp = ?, updated_at = ? WHERE encounter_id = ? AND id = ?",
      ).bind(hp, temporaryHp, now, encounterId, tokenId).run();
    },
    async hasConcentration(encounterId, tokenId) {
      return Boolean(await db.prepare(
        "SELECT 1 AS found FROM effects WHERE encounter_id = ? AND token_id = ? AND effect_type = 'concentration' LIMIT 1",
      ).bind(encounterId, tokenId).first());
    },
    async cancelPendingProposals(encounterId, participantId, now) {
      await db.prepare(
        `UPDATE damage_proposals SET status = 'cancelled', final_damage = 0,
         adjudication_method = 'cancel', adjudicated_by_participant_id = ?, resolved_at = ?
         WHERE encounter_id = ? AND status = 'pending'`,
      ).bind(participantId, now, encounterId).run();
    },
  };
}
