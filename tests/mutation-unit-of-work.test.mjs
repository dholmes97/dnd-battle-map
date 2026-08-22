import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

import { createD1MutationUnitOfWork } from "../worker/adapters/d1-mutation-unit-of-work.ts";
import { MutationConflictError } from "../worker/ports/mutation-unit-of-work.ts";

test("one D1 unit of work commits mutation, version, and history together", async () => {
  await withDatabase(async (db) => {
    const encounter = await db.prepare("SELECT id, version FROM encounters LIMIT 1").first();
    const token = await db.prepare("SELECT id, hp FROM tokens WHERE encounter_id = ? ORDER BY id LIMIT 1")
      .bind(encounter.id).first();
    const beforeActions = await scalar(db, "SELECT COUNT(*) AS value FROM actions WHERE encounter_id = ?", encounter.id);
    const unit = createD1MutationUnitOfWork(db);
    await unit.database.prepare("UPDATE tokens SET hp = ? WHERE id = ? AND encounter_id = ?")
      .bind(7, token.id, encounter.id).run();
    assert.equal(await scalar(db, "SELECT hp AS value FROM tokens WHERE id = ?", token.id), token.hp);
    await unit.commit({
      encounterId: encounter.id,
      expectedVersion: encounter.version,
      participantId: "atomic-test",
      actionType: "hp_changed",
      actionPayload: { tokenId: token.id, from: token.hp, to: 7 },
      now: 1_900_000_000_000,
    });
    assert.equal(await scalar(db, "SELECT hp AS value FROM tokens WHERE id = ?", token.id), 7);
    assert.equal(await scalar(db, "SELECT version AS value FROM encounters WHERE id = ?", encounter.id), encounter.version + 1);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM actions WHERE encounter_id = ?", encounter.id), beforeActions + 1);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM mutation_assertions", undefined), 0);
  });
});

test("a failure at the final statement boundary rolls the whole D1 commit back", async () => {
  await withDatabase(async (db) => {
    const encounter = await db.prepare("SELECT id, version FROM encounters LIMIT 1").first();
    const token = await db.prepare("SELECT id, hp FROM tokens WHERE encounter_id = ? ORDER BY id LIMIT 1")
      .bind(encounter.id).first();
    const beforeActions = await scalar(db, "SELECT COUNT(*) AS value FROM actions WHERE encounter_id = ?", encounter.id);
    const unit = createD1MutationUnitOfWork(db);
    await unit.database.prepare("UPDATE tokens SET hp = ? WHERE id = ?").bind(1, token.id).run();
    await unit.database.prepare("INSERT INTO actions (id) VALUES (?)").bind("invalid-row").run();
    await assert.rejects(unit.commit({
      encounterId: encounter.id,
      expectedVersion: encounter.version,
      participantId: "atomic-test",
      actionType: "hp_changed",
      actionPayload: {},
      now: 1_900_000_000_001,
    }));
    assert.equal(await scalar(db, "SELECT hp AS value FROM tokens WHERE id = ?", token.id), token.hp);
    assert.equal(await scalar(db, "SELECT version AS value FROM encounters WHERE id = ?", encounter.id), encounter.version);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM actions WHERE encounter_id = ?", encounter.id), beforeActions);
  });
});

test("the optimistic version guard rejects stale writers without partial state", async () => {
  await withDatabase(async (db) => {
    const encounter = await db.prepare("SELECT id, version FROM encounters LIMIT 1").first();
    const token = await db.prepare("SELECT id, hp FROM tokens WHERE encounter_id = ? ORDER BY id LIMIT 1")
      .bind(encounter.id).first();
    const unit = createD1MutationUnitOfWork(db);
    await unit.database.prepare("UPDATE tokens SET hp = ? WHERE id = ?").bind(2, token.id).run();
    await db.prepare("UPDATE encounters SET version = version + 1 WHERE id = ?").bind(encounter.id).run();
    await assert.rejects(unit.commit({
      encounterId: encounter.id,
      expectedVersion: encounter.version,
      participantId: "atomic-test",
      actionType: "hp_changed",
      now: 1_900_000_000_002,
    }), MutationConflictError);
    assert.equal(await scalar(db, "SELECT hp AS value FROM tokens WHERE id = ?", token.id), token.hp);
    assert.equal(await scalar(db, "SELECT COUNT(*) AS value FROM mutation_assertions", undefined), 0);
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
    await migrate(db);
    await run(db);
  } finally {
    await miniflare.dispose();
  }
}

async function migrate(db) {
  const directory = new URL("../drizzle/", import.meta.url);
  const migrations = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(migration, directory), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}

async function scalar(db, sql, binding) {
  const statement = binding === undefined ? db.prepare(sql) : db.prepare(sql).bind(binding);
  return (await statement.first()).value;
}
