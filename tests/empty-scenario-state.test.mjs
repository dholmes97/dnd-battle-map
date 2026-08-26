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
    const environment = { DB: db };
    const executionContext = { waitUntil() {}, passThroughOnException() {} };
    const login = await worker.fetch(new Request("http://localhost/api/auth/dev-login", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": "192.0.2.1" },
      body: JSON.stringify({ identityId: "identity-dan" }),
    }), environment, executionContext);
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    const joined = await worker.fetch(new Request(`http://localhost/api/encounters/${encounter.code}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "CF-Connecting-IP": "192.0.2.1" },
      body: JSON.stringify({ campaignId: "campaign-force-of-nature" }),
    }), environment, executionContext);
    const session = await joined.json();

    const response = await worker.fetch(
      new Request(`http://localhost/api/encounters/${encounter.code}/state`, {
        headers: {
          "CF-Connecting-IP": "192.0.2.1",
          "x-operation-id": "empty-scenario-check",
          "x-participant-id": session.participantId,
          "x-session-secret": session.sessionSecret,
        },
      }),
      environment,
      executionContext,
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("x-request-id"), /^[a-f0-9-]{36}$/);
    assert.equal(response.headers.get("x-operation-id"), "empty-scenario-check");
    assert.match(response.headers.get("server-timing"), /request;dur=.*projection;dur=/);
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
