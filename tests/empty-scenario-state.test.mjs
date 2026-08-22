import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

test("an existing encounter projects normally when its token collection is empty", async () => {
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
    const encounter = await db.prepare("SELECT id, code FROM encounters LIMIT 1").first();
    await db.prepare("DELETE FROM effects WHERE encounter_id = ?").bind(encounter.id).run();
    await db.prepare("DELETE FROM tokens WHERE encounter_id = ?").bind(encounter.id).run();
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("empty-scenario-test", `${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);

    const response = await worker.fetch(
      new Request(`http://localhost/api/encounters/${encounter.code}/state`, {
        headers: { "CF-Connecting-IP": "192.0.2.1" },
      }),
      { DB: db },
      { waitUntil() {}, passThroughOnException() {} },
    );
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.encounter.code, encounter.code);
    assert.deepEqual(state.tokens, []);
  } finally {
    await miniflare.dispose();
  }
});

test("the client rejects malformed or null authoritative command state before dereferencing it", async () => {
  const sync = await readFile(new URL("../app/use-encounter-sync.ts", import.meta.url), "utf8");
  assert.match(sync, /if \(!isEncounterState\(next\)\)/);
  assert.match(sync, /server returned an invalid encounter state/i);
});
