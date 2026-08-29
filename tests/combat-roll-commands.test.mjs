import assert from "node:assert/strict";
import test from "node:test";

import { adjudicateDamage, rollAttack } from "../worker/commands/combat-roll-commands.ts";

function token(id, overrides = {}) {
  return {
    id, name: id, x: 1, y: 1, art_asset: null, kind: "monster", size: "medium",
    speed: 30, fly_speed: null, swim_speed: null, climb_speed: null, burrow_speed: null,
    armor_class: 15, hp: 20, max_hp: 20, temporary_hp: 0, catalog_creature_id: null,
    is_hidden: 0, summoner_token_id: null, campaign_character_id: null,
    initiative: 10, initiative_group_id: null, initiative_order: 0, turn_complete: 0,
    movement_used: 0, altitude: 0, movement_origin_x: null, movement_origin_y: null,
    owner_participant_id: null, owner_name: null, ...overrides,
  };
}

function action(overrides = {}) {
  return {
    id: "action", campaign_character_id: "character", creature_catalog_id: null,
    name: "Longsword", attack_bonus: 7, attack_kind: "melee", damage_dice_count: 1,
    damage_die_size: 8, damage_modifier: 4, damage_type: "slashing", reach_feet: 5,
    range_feet: null, manual_rider: 0, alternate_damage_json: null,
    source_kind: "manual-character", source_ref: null, sort_order: 0, is_enabled: 1,
    created_at: 1, updated_at: 1, ...overrides,
  };
}

function context(overrides = {}) {
  const attacker = token("attacker", { name: "Hero", kind: "character", campaign_character_id: "character" });
  const target = token("target", { name: "Goblin" });
  const calls = [];
  const repository = {
    findToken: async (_encounterId, id) => id === attacker.id ? attacker : id === target.id ? target : null,
    findAction: async () => action(),
    findActionForToken: async () => action(),
    countActionsForToken: async () => 1,
    saveAction: async () => true,
    deleteAction: async () => undefined,
    countActions: async () => 1,
    characterBelongsToCampaign: async () => true,
    characterControllerIdentity: async () => "identity-player",
    creatureExists: async () => true,
    hasBless: async () => false,
    findRollByOperation: async () => null,
    createRoll: async (value) => calls.push(["roll", value]),
    findProposal: async () => null,
    resolveProposal: async (value) => calls.push(["resolve", value]),
    updateHp: async (...args) => calls.push(["hp", ...args]),
    hasConcentration: async () => false,
    cancelPendingProposals: async () => undefined,
    ...(overrides.repository ?? {}),
  };
  let nextId = 0;
  const dice = [...(overrides.dice ?? [12, 5])];
  return {
    calls,
    repository,
    encounter: {
      id: "encounter", campaignId: "campaign", code: "CODE", name: "Encounter", version: 3,
      status: "active", activeMapImageId: null, activeMapSetupJson: null,
      activeMapPackageJson: null, draftMapImageId: null, draftMapSetupJson: null,
      gridWidth: 20, gridHeight: 20, currentRound: 1, activeInitiativeOrder: 0,
      strictMovement: true, updatedAt: 0,
    },
    participant: {
      id: "participant", name: "Player", role: "player", identityId: "identity-player",
      authenticatedActorIdentityId: "identity-real-actor", campaignMembershipId: "membership",
    },
    payload: {
      operationId: "operation-123", attackerTokenId: "attacker", targetTokenId: "target",
      actionProfileId: "action", rollMode: "normal", alternateDamage: false,
    },
    now: 100,
    feature: { enabled: true, draining: false },
    canControl: async () => true,
    canSeeToken: async () => true,
    rollDie: () => dice.shift() ?? 1,
    services: {
      createId: () => `generated-${++nextId}`,
      loadState: async () => ({ marker: "state" }),
      commit: async (...args) => calls.push(["commit", ...args]),
      commitFor: async () => undefined,
    },
    ...overrides,
    repository,
    calls,
  };
}

test("new rolls fail closed while unrelated command domains remain independent", async () => {
  const value = context({ feature: { enabled: false, draining: false } });
  const result = await rollAttack(value);
  assert.equal(result.status, 403);
  assert.equal(value.calls.length, 0);
});

test("a configured roll uses authoritative Bless, dice, action values, and actor audit identity", async () => {
  const value = context({
    dice: [14, 6, 3],
    repository: { hasBless: async () => true },
  });
  const result = await rollAttack(value);
  assert.equal(result.payload.result.attackTotal, 24);
  assert.equal(result.payload.result.blessDie, 3);
  const written = value.calls.find(([kind]) => kind === "roll")[1];
  assert.equal(written.authenticatedActorIdentityId, "identity-real-actor");
  assert.equal(written.actionSnapshotJson.includes('"blessApplied":true'), true);
  assert.equal(written.attackDiceJson, "[14]");
  assert.equal(written.blessDie, 3);
});

test("a target without armor class records the roll without creating a damage proposal", async () => {
  const value = context({
    repository: {
      findToken: async (_encounterId, id) => id === "attacker"
        ? token("attacker", { name: "Hero", kind: "character", campaign_character_id: "character" })
        : id === "target" ? token("target", { name: "Mystery", armor_class: null }) : null,
    },
  });
  const result = await rollAttack(value);
  const written = value.calls.find(([kind]) => kind === "roll")[1];

  assert.equal(result.payload.result.outcome, "needs-ac");
  assert.equal(result.payload.proposalId, null);
  assert.equal(written.proposalId, null);
});

test("a player cannot roll an uncontrolled attacker or an unprojected target", async () => {
  assert.equal((await rollAttack(context({ canControl: async () => false }))).status, 403);
  assert.equal((await rollAttack(context({ canSeeToken: async () => false }))).status, 404);
});

test("operation retries recover the immutable roll without generating dice again", async () => {
  let rolled = false;
  const value = context({
    repository: { findRollByOperation: async () => ({ id: "existing-roll" }) },
    rollDie: () => { rolled = true; return 20; },
  });
  const result = await rollAttack(value);
  assert.equal(result.payload.rollId, "existing-roll");
  assert.equal(result.payload.recovered, true);
  assert.equal(rolled, false);
});

test("generic Attack is DM-only and only available to an unconfigured creature", async () => {
  const generic = {
    name: "Attack", attackBonus: 4, attackKind: "melee",
    damage: { count: 1, sides: 6, modifier: 2 }, damageType: "piercing",
    reachFeet: 5, rangeFeet: null, manualRider: false, alternateDamage: null,
  };
  const player = context({ payload: {
    operationId: "generic-123", attackerTokenId: "attacker", targetTokenId: "target",
    actionProfileId: null, adHocAction: generic, rollMode: "normal", alternateDamage: false,
  } });
  assert.equal((await rollAttack(player)).status, 400);

  const configured = context({
    participant: { id: "dm", name: "DM", role: "dm", authenticatedActorIdentityId: "identity-dm" },
    payload: player.payload,
  });
  assert.equal((await rollAttack(configured)).status, 409);

  const dm = context({
    participant: { id: "dm", name: "DM", role: "dm", authenticatedActorIdentityId: "identity-dm" },
    payload: player.payload,
    repository: { countActionsForToken: async () => 0 },
  });
  assert.equal((await rollAttack(dm)).payload.rolled, true);
  assert.equal(dm.calls.find(([kind]) => kind === "roll")[1].actionSource, "dm-ad-hoc");
});

test("DM adjudication consumes temporary HP first and commits one linked HP history action", async () => {
  const proposal = {
    id: "proposal", encounter_id: "encounter", roll_id: "roll", target_token_id: "target",
    status: "pending", rolled_damage: 9, final_damage: null, adjudication_method: null,
    adjudicated_by_participant_id: null, adjudication_note: null, history_action_id: null,
    created_at: 1, resolved_at: null,
  };
  const value = context({
    participant: { id: "dm", name: "DM", role: "dm", authenticatedActorIdentityId: "identity-dm" },
    payload: { proposalId: "proposal", method: "apply" },
    repository: {
      findProposal: async () => proposal,
      findToken: async () => token("target", { hp: 20, max_hp: 20, temporary_hp: 5 }),
      hasConcentration: async () => true,
    },
  });
  const result = await adjudicateDamage(value);
  assert.equal(result.payload.finalDamage, 9);
  assert.equal(result.payload.concentrationCheckRequired, true);
  assert.deepEqual(value.calls.find(([kind]) => kind === "hp").slice(3, 5), [16, 0]);
  const resolved = value.calls.find(([kind]) => kind === "resolve")[1];
  const committed = value.calls.find(([kind]) => kind === "commit");
  assert.equal(resolved.historyActionId, committed[3]);
  assert.equal(committed[1], "hp_changed");
  assert.equal(committed[2].fromTemporaryHp, 5);
  assert.equal(committed[2].toTemporaryHp, 0);
});

test("only the DM may adjudicate and terminal proposals are recovered without another HP write", async () => {
  const proposal = {
    id: "proposal", encounter_id: "encounter", roll_id: "roll", target_token_id: "target",
    status: "applied", rolled_damage: 5, final_damage: 5, adjudication_method: "apply",
    adjudicated_by_participant_id: "dm", adjudication_note: null, history_action_id: "history",
    created_at: 1, resolved_at: 2,
  };
  const player = context({ payload: { proposalId: "proposal", method: "apply" } });
  assert.equal((await adjudicateDamage(player)).status, 403);
  const dm = context({
    participant: { id: "dm", name: "DM", role: "dm" },
    payload: { proposalId: "proposal", method: "apply" },
    repository: { findProposal: async () => proposal },
  });
  const result = await adjudicateDamage(dm);
  assert.equal(result.payload.recovered, true);
  assert.equal(dm.calls.some(([kind]) => kind === "hp"), false);
});
