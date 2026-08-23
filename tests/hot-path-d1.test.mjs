import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

import { createD1ChatHandoutRepository } from "../worker/adapters/d1-chat-handout-repository.ts";
import { createD1HistoryRepository } from "../worker/adapters/d1-history-repository.ts";
import { createD1TokenEffectRepository } from "../worker/adapters/d1-token-effect-repository.ts";

test("hot-path D1 adapters preserve encounter scope and participant ordering", async () => {
  await withDatabase(async (db) => {
    const encounter = await db.prepare("SELECT id FROM encounters ORDER BY id LIMIT 1").first();
    const token = await db.prepare("SELECT id FROM tokens WHERE encounter_id = ? ORDER BY id LIMIT 1")
      .bind(encounter.id).first();
    assert.ok(encounter?.id);
    assert.ok(token?.id);

    await db.prepare(
      `INSERT INTO effects
       (id, encounter_id, token_id, name, effect_type, duration_rounds, expires_round,
        reminder_timing, created_by, created_at)
       VALUES ('hot-concentration', ?, ?, 'Concentration', 'concentration', NULL, NULL,
               'end', 'participant-hot', 10)`,
    ).bind(encounter.id, token.id).run();
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
    await tokenEffects.updateHp(encounter.id, tokenWrite.id, 15, 14);
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
