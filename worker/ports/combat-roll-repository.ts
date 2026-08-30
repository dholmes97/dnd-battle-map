import type { CombatActionValues } from "../../shared/combat-rolling.ts";
import type { TokenRow } from "../types.ts";

export type CombatActionProfileRow = {
  id: string;
  campaign_character_id: string | null;
  creature_catalog_id: string | null;
  name: string;
  attack_bonus: number;
  attack_kind: "melee" | "ranged";
  damage_dice_count: number;
  damage_die_size: number;
  damage_modifier: number;
  damage_type: string;
  reach_feet: number | null;
  range_feet: number | null;
  manual_rider: number;
  manual_rider_text: string | null;
  alternate_damage_json: string | null;
  source_kind: string;
  source_ref: string | null;
  sort_order: number;
  is_enabled: number;
  created_at: number;
  updated_at: number;
};

export type CombatRollRow = {
  id: string;
  encounter_id: string;
  operation_id: string;
  participant_id: string;
  attacker_token_id: string;
  target_token_id: string;
  action_profile_id: string | null;
  action_source: string;
  action_snapshot_json: string;
  roll_mode: string;
  attack_dice_json: string;
  kept_d20: number;
  bless_die: number | null;
  attack_total: number;
  outcome: string;
  dm_private: number;
  released_outcome: string | null;
  outcome_released_at: number | null;
  damage_dice_json: string;
  damage_total: number;
  damage_rolled_at: number | null;
  in_turn: number;
  created_at: number;
};

export type DamageProposalRow = {
  id: string;
  encounter_id: string;
  roll_id: string;
  target_token_id: string;
  status: "pending" | "applied" | "adjusted" | "immune" | "rejected" | "cancelled";
  rolled_damage: number;
  final_damage: number | null;
  adjudication_method: string | null;
  adjudicated_by_participant_id: string | null;
  adjudication_note: string | null;
  history_action_id: string | null;
  created_at: number;
  resolved_at: number | null;
};

export interface CombatRollRepository {
  findToken(encounterId: string, tokenId: string): Promise<TokenRow | null>;
  findAction(actionId: string): Promise<CombatActionProfileRow | null>;
  findActionForToken(actionId: string, token: TokenRow): Promise<CombatActionProfileRow | null>;
  countActionsForToken(token: TokenRow): Promise<number>;
  saveAction(input: {
    id: string;
    ownerType: "character" | "creature";
    ownerId: string;
    values: CombatActionValues;
    sourceKind: string;
    sourceRef: string | null;
    now: number;
  }): Promise<boolean>;
  deleteAction(actionId: string): Promise<void>;
  countActions(ownerType: "character" | "creature", ownerId: string): Promise<number>;
  characterBelongsToCampaign(characterId: string, campaignId: string): Promise<boolean>;
  characterControllerIdentity(characterId: string): Promise<string | null>;
  creatureExists(creatureId: string): Promise<boolean>;
  hasBless(encounterId: string, tokenId: string): Promise<boolean>;
  findRollByOperation(encounterId: string, operationId: string): Promise<CombatRollRow | null>;
  findRoll(encounterId: string, rollId: string): Promise<CombatRollRow | null>;
  createRoll(input: {
    id: string;
    encounterId: string;
    operationId: string;
    participantId: string;
    authenticatedActorIdentityId: string | null;
    attackerTokenId: string;
    targetTokenId: string;
    actionProfileId: string | null;
    actionSource: string;
    actionSnapshotJson: string;
    rollMode: string;
    attackDiceJson: string;
    keptD20: number;
    blessDie: number | null;
    attackTotal: number;
    outcome: string;
    dmPrivate: boolean;
    damageDiceJson: string;
    damageTotal: number;
    inTurn: boolean;
    now: number;
  }): Promise<void>;
  releaseAttackOutcome(input: {
    encounterId: string;
    rollId: string;
    outcome: "miss" | "hit" | "critical";
    now: number;
  }): Promise<void>;
  findProposalByRoll(encounterId: string, rollId: string): Promise<DamageProposalRow | null>;
  recordDamage(input: {
    encounterId: string;
    rollId: string;
    proposalId: string;
    targetTokenId: string;
    damageDiceJson: string;
    damageTotal: number;
    now: number;
  }): Promise<void>;
  findProposal(encounterId: string, proposalId: string): Promise<DamageProposalRow | null>;
  resolveProposal(input: {
    encounterId: string;
    proposalId: string;
    expectedStatus: "pending";
    status: DamageProposalRow["status"];
    finalDamage: number;
    method: string;
    participantId: string;
    note: string | null;
    historyActionId: string | null;
    now: number;
  }): Promise<void>;
  updateHp(encounterId: string, tokenId: string, hp: number, temporaryHp: number, now: number): Promise<void>;
  hasConcentration(encounterId: string, tokenId: string): Promise<boolean>;
  cancelPendingProposals(encounterId: string, participantId: string, now: number): Promise<void>;
}
