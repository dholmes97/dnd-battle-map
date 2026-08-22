import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

import { createD1AnnotationFogRepository } from "../worker/adapters/d1-annotation-fog-repository.ts";
import { createD1MutationUnitOfWork } from "../worker/adapters/d1-mutation-unit-of-work.ts";

test("D1 clears, restores, and re-clears only the exact durable drawing snapshot", async () => {
  await withDatabase(async (db) => {
    const encounter = await db.prepare("SELECT id, version, grid_width, grid_height FROM encounters LIMIT 1").first();
    const drawings = [drawing("clear-test-a", 1), drawing("clear-test-b", 2)];
    await db.batch([
      ...drawings.map((annotation) => insertAnnotation(db, encounter.id, annotation)),
      insertAnnotation(db, encounter.id, {
        ...drawing("clear-test-ping", 3),
        annotationType: "ping",
        x2: null,
        y2: null,
        expiresAt: 2_000,
      }),
    ]);

    const clearUnit = createD1MutationUnitOfWork(db);
    const clearRepository = createD1AnnotationFogRepository(clearUnit.database);
    const snapshot = await clearRepository.listDurableAnnotations(encounter.id);
    assert.deepEqual(snapshot.map(({ id }) => id), ["clear-test-a", "clear-test-b"]);
    await clearRepository.clearDurableAnnotations(encounter.id);
    await clearUnit.commit({
      encounterId: encounter.id,
      expectedVersion: encounter.version,
      participantId: "dm-clear-test",
      actionType: "annotations_cleared",
      actionPayload: { annotations: snapshot },
      now: 4_000,
    });
    assert.deepEqual(await annotationIds(db, encounter.id), ["clear-test-ping"]);
    const history = await db.prepare(
      "SELECT payload_json FROM actions WHERE encounter_id = ? AND action_type = 'annotations_cleared' ORDER BY created_at DESC LIMIT 1",
    ).bind(encounter.id).first();
    assert.deepEqual(JSON.parse(history.payload_json).annotations.map(({ id }) => id), ["clear-test-a", "clear-test-b"]);

    const undoUnit = createD1MutationUnitOfWork(db);
    const restored = await createD1AnnotationFogRepository(undoUnit.database).replayHistoryAction({
      direction: "undo", encounterId: encounter.id, participantId: "dm-clear-test",
      actionType: "annotations_cleared", payload: { annotations: snapshot },
      gridWidth: encounter.grid_width, gridHeight: encounter.grid_height, now: 5_000,
    });
    assert.equal(restored, 2);
    await undoUnit.commit({ encounterId: encounter.id, participantId: null, actionType: null, now: 5_000 });
    assert.deepEqual(await annotationIds(db, encounter.id), ["clear-test-a", "clear-test-b", "clear-test-ping"]);

    await insertAnnotation(db, encounter.id, drawing("later-drawing", 4)).run();
    const redoUnit = createD1MutationUnitOfWork(db);
    const removed = await createD1AnnotationFogRepository(redoUnit.database).replayHistoryAction({
      direction: "redo", encounterId: encounter.id, participantId: "dm-clear-test",
      actionType: "annotations_cleared", payload: { annotations: snapshot },
      gridWidth: encounter.grid_width, gridHeight: encounter.grid_height, now: 6_000,
    });
    assert.equal(removed, 2);
    await redoUnit.commit({ encounterId: encounter.id, participantId: null, actionType: null, now: 6_000 });
    assert.deepEqual(await annotationIds(db, encounter.id), ["clear-test-ping", "later-drawing"]);
  });
});

function drawing(id, createdAt) {
  return {
    id, annotationType: "drawing", x: createdAt, y: 1, x2: createdAt + 1, y2: 2,
    color: "#f5c65c", label: null, createdBy: "dm-clear-test", expiresAt: null, createdAt,
  };
}

function insertAnnotation(db, encounterId, annotation) {
  return db.prepare(
    `INSERT INTO annotations
     (id, encounter_id, annotation_type, x, y, x2, y2, color, label,
      created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    annotation.id, encounterId, annotation.annotationType, annotation.x, annotation.y,
    annotation.x2, annotation.y2, annotation.color, annotation.label, annotation.createdBy,
    annotation.expiresAt, annotation.createdAt,
  );
}

async function annotationIds(db, encounterId) {
  const rows = await db.prepare(
    "SELECT id FROM annotations WHERE encounter_id = ? AND (id LIKE '%clear-test%' OR id = 'later-drawing') ORDER BY id",
  ).bind(encounterId).all();
  return rows.results.map(({ id }) => id);
}

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
