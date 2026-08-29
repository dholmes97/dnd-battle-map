import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

import { createD1ChatHandoutRepository } from "../worker/adapters/d1-chat-handout-repository.ts";
import { createD1CombatRollRepository } from "../worker/adapters/d1-combat-roll-repository.ts";
import { createD1HistoryRepository } from "../worker/adapters/d1-history-repository.ts";
import { createD1TokenEffectRepository } from "../worker/adapters/d1-token-effect-repository.ts";

test("hot-path D1 adapters preserve encounter scope and participant ordering", async () => {
  await withDatabase(async (db) => {
    const encounter = await db.prepare(
      `SELECT encounters.id, encounters.campaign_id FROM encounters
       JOIN tokens ON tokens.encounter_id = encounters.id
       WHERE tokens.campaign_character_id IS NOT NULL
       ORDER BY encounters.id LIMIT 1`,
    ).first();
    const token = await db.prepare(
      "SELECT id FROM tokens WHERE encounter_id = ? AND campaign_character_id IS NOT NULL ORDER BY id LIMIT 1",
    ).bind(encounter.id).first();
    assert.ok(encounter?.id);
    assert.ok(token?.id);
    await db.prepare(
      `INSERT INTO participants
       (id, encounter_id, name, role, session_secret, joined_at, last_seen_at)
       VALUES ('participant-hot', ?, 'Hot-path player', 'player', 'hot-path-session', 1, 1)`,
    ).bind(encounter.id).run();
    const participant = await db.prepare("SELECT id FROM participants WHERE id = 'participant-hot'").first();
    assert.ok(participant?.id);

    const combat = createD1CombatRollRepository(db);
    const storedToken = await combat.findToken(encounter.id, token.id);
    assert.ok(storedToken?.campaign_character_id);
    assert.equal(await combat.findToken("another-encounter", token.id), null);
    const creature = await db.prepare("SELECT id FROM creature_catalog ORDER BY id LIMIT 1").first();
    assert.ok(creature?.id);
    assert.equal(await combat.characterBelongsToCampaign(storedToken.campaign_character_id, encounter.campaign_id), true);
    assert.ok(await combat.characterControllerIdentity(storedToken.campaign_character_id));
    assert.equal(await combat.creatureExists(creature.id), true);
    const actionValues = {
      name: "Hot-path longsword",
      attackBonus: 5,
      attackKind: "melee",
      damage: { count: 1, sides: 8, modifier: 3 },
      damageType: "slashing",
      reachFeet: 5,
      rangeFeet: null,
      manualRider: false,
      manualRiderText: null,
      alternateDamage: null,
    };
    const actionCount = await combat.countActions("character", storedToken.campaign_character_id);
    assert.equal(await combat.saveAction({
      id: "hot-action", ownerType: "character", ownerId: storedToken.campaign_character_id,
      values: actionValues, sourceKind: "custom", sourceRef: null, now: 2,
    }), true);
    assert.equal(await combat.countActions("character", storedToken.campaign_character_id), actionCount + 1);
    assert.equal(await combat.countActions("creature", creature.id), 0);
    assert.equal((await combat.findAction("hot-action"))?.name, actionValues.name);
    assert.equal((await combat.findActionForToken("hot-action", storedToken))?.name, actionValues.name);
    assert.equal(await combat.countActionsForToken(storedToken), actionCount + 1);
    await combat.createRoll({
      id: "hot-roll", encounterId: encounter.id, operationId: "hot-attack-operation",
      participantId: participant.id, authenticatedActorIdentityId: null,
      attackerTokenId: token.id, targetTokenId: token.id, actionProfileId: null,
      actionSource: "dm-ad-hoc", actionSnapshotJson: "{}", rollMode: "normal",
      attackDiceJson: "[16]", keptD20: 16, blessDie: null, attackTotal: 21,
      outcome: "hit", damageDiceJson: "[]", damageTotal: 0, inTurn: true, now: 5,
    });
    assert.equal((await combat.findRoll(encounter.id, "hot-roll"))?.damage_rolled_at, null);
    assert.equal((await combat.findRollByOperation(encounter.id, "hot-attack-operation"))?.id, "hot-roll");
    assert.equal(await combat.findProposalByRoll(encounter.id, "hot-roll"), null);
    await combat.recordDamage({
      encounterId: encounter.id, rollId: "hot-roll", proposalId: "hot-proposal",
      targetTokenId: token.id, damageDiceJson: "[6]", damageTotal: 10, now: 6,
    });
    assert.equal((await combat.findRoll(encounter.id, "hot-roll"))?.damage_total, 10);
    assert.equal((await combat.findProposalByRoll(encounter.id, "hot-roll"))?.rolled_damage, 10);
    assert.equal((await combat.findProposal(encounter.id, "hot-proposal"))?.status, "pending");
    await combat.resolveProposal({
      encounterId: encounter.id, proposalId: "hot-proposal", expectedStatus: "pending",
      status: "applied", finalDamage: 10, method: "apply", participantId: participant.id,
      note: null, historyActionId: null, now: 7,
    });
    assert.equal((await combat.findProposal(encounter.id, "hot-proposal"))?.status, "applied");
    await combat.updateHp(encounter.id, token.id, 12, 2, 8);
    assert.equal((await combat.findToken(encounter.id, token.id))?.hp, 12);

    await combat.createRoll({
      id: "hot-roll-cancelled", encounterId: encounter.id, operationId: "hot-cancelled-operation",
      participantId: participant.id, authenticatedActorIdentityId: null,
      attackerTokenId: token.id, targetTokenId: token.id, actionProfileId: null,
      actionSource: "dm-ad-hoc", actionSnapshotJson: "{}", rollMode: "normal",
      attackDiceJson: "[18]", keptD20: 18, blessDie: null, attackTotal: 23,
      outcome: "hit", damageDiceJson: "[]", damageTotal: 0, inTurn: true, now: 9,
    });
    await combat.recordDamage({
      encounterId: encounter.id, rollId: "hot-roll-cancelled", proposalId: "hot-proposal-cancelled",
      targetTokenId: token.id, damageDiceJson: "[4]", damageTotal: 7, now: 10,
    });
    await combat.cancelPendingProposals(encounter.id, participant.id, 11);
    assert.equal((await combat.findProposal(encounter.id, "hot-proposal-cancelled"))?.status, "cancelled");

    await db.prepare(
      `INSERT INTO effects
       (id, encounter_id, token_id, name, effect_type, duration_rounds, expires_round,
        reminder_timing, created_by, created_at)
       VALUES ('hot-concentration', ?, ?, 'Concentration', 'concentration', NULL, NULL,
               'end', 'participant-hot', 10)`,
    ).bind(encounter.id, token.id).run();
    await db.prepare(
      `INSERT INTO effects
       (id, encounter_id, token_id, name, effect_type, duration_rounds, expires_round,
        reminder_timing, created_by, created_at)
       VALUES ('hot-bless', ?, ?, 'Bless', 'condition', NULL, NULL,
               'end', 'participant-hot', 10)`,
    ).bind(encounter.id, token.id).run();
    assert.equal(await combat.hasConcentration(encounter.id, token.id), true);
    assert.equal(await combat.hasBless(encounter.id, token.id), true);
    await combat.deleteAction("hot-action");
    assert.equal(await combat.findAction("hot-action"), null);
    const tokenEffects = createD1TokenEffectRepository(db);
    assert.equal(await tokenEffects.hasConcentration(encounter.id, token.id), true);
    assert.equal(await tokenEffects.hasConcentration("another-encounter", token.id), false);
    const tokenWrite = {
      id: "hot-token",
      encounterId: encounter.id,
      name: "Hot-path token",
      x: 2,
      y: 3,
      artAsset: null,
      kind: "monster",
      size: "medium",
      speed: 30,
      flySpeed: null,
      swimSpeed: null,
      climbSpeed: null,
      burrowSpeed: null,
      altitude: 0,
      armorClass: 14,
      hp: 20,
      maxHp: 20,
      hidden: false,
      summonerTokenId: null,
      initiative: 12,
      initiativeOrder: 1,
      now: 11,
    };
    assert.equal(await tokenEffects.createToken(tokenWrite), true);
    assert.equal((await tokenEffects.findToken(encounter.id, tokenWrite.id))?.name, tokenWrite.name);
    await tokenEffects.resizeToken(encounter.id, tokenWrite.id, "large", 4, 5, 12);
    await tokenEffects.updateToken({ ...tokenWrite, name: "Updated hot-path token", x: 4, y: 5, size: "large", now: 13 });
    await tokenEffects.updateHp(encounter.id, tokenWrite.id, 15, 0, 14);
    assert.equal(await tokenEffects.addEffect({
      id: "hot-effect",
      encounterId: encounter.id,
      tokenId: tokenWrite.id,
      name: "Bless",
      effectType: "condition",
      durationRounds: 2,
      expiresRound: 3,
      reminderTiming: "end",
      participantId: "participant-hot",
      now: 15,
    }), true);
    const effect = await tokenEffects.findEffect(encounter.id, "hot-effect");
    assert.equal(effect?.token.name, "Updated hot-path token");
    assert.equal(effect?.token.hp, 15);
    await tokenEffects.removeEffect(encounter.id, "hot-effect");
    assert.equal(await tokenEffects.findEffect(encounter.id, "hot-effect"), null);
    await tokenEffects.deleteToken(encounter.id, tokenWrite.id);
    assert.equal(await tokenEffects.findToken(encounter.id, tokenWrite.id), null);

    await db.prepare(
      `INSERT INTO handouts
       (id, encounter_id, title, display_key, thumbnail_key, mime_type, width, height,
        display_bytes, thumbnail_bytes, created_by, created_at, updated_at, deleted_at)
       VALUES ('hot-handout', ?, 'Map', 'display', 'thumbnail', 'image/webp', 10, 10,
               100, 20, 'participant-hot', 20, 20, NULL)`,
    ).bind(encounter.id).run();
    const handouts = createD1ChatHandoutRepository(db);
    assert.equal(await handouts.handoutIsAvailable(encounter.id, "hot-handout"), true);
    for (const [id, participant, createdAt] of [
      ["hot-message-a", "participant-hot", 21],
      ["hot-message-b", "participant-other", 22],
    ]) {
      assert.equal(await handouts.writeChatMessage({
        id,
        encounterId: encounter.id,
        senderName: "Kevin",
        senderRole: "dm",
        recipientName: null,
        body: "Map",
        handoutId: "hot-handout",
        showImmediately: false,
        createdAt,
      }), true);
      await db.prepare(
        `INSERT INTO actions
         (id, encounter_id, participant_id, action_type, payload_json, created_at)
         VALUES (?, ?, ?, 'token_moved', '{}', ?)`,
      ).bind(`action-${id}`, encounter.id, participant, createdAt).run();
    }
    assert.equal(await handouts.countHandoutReferences(encounter.id, "hot-handout"), 2);
    assert.equal(await handouts.countHandoutReferences("another-encounter", "hot-handout"), 0);
    const deletable = await handouts.findDeletableHandout(encounter.id, "hot-handout");
    assert.ok(deletable);
    await handouts.markHandoutDeleted(encounter.id, deletable, 23);
    assert.equal(await handouts.handoutIsAvailable(encounter.id, "hot-handout"), false);

    const history = createD1HistoryRepository(db);
    const participantRows = await history.listParticipantActions(encounter.id, "participant-hot");
    assert.deepEqual(participantRows.map(({ id }) => id), ["action-hot-message-a"]);
  });
});

async function withDatabase(run) {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  try {
    const db = await miniflare.getD1Database("DB");
    const directory = new URL("../drizzle/", import.meta.url);
    const migrations = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
    for (const migration of migrations) {
      const sql = await readFile(new URL(migration, directory), "utf8");
      for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
        await db.prepare(statement).run();
      }
    }
    await run(db);
  } finally {
    await miniflare.dispose();
  }
}
