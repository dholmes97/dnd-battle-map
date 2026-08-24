import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

test("human identities receive campaign-scoped roles, characters, encounters, and sessions", async () => {
  await withWorker(async (worker, db) => {
    const danCampaigns = await worker.fetch(request("/api/campaigns?identityId=identity-dan"), { DB: db }, context());
    assert.equal(danCampaigns.status, 200);
    const danAccess = await danCampaigns.json();
    assert.deepEqual(danAccess.identity, { id: "identity-dan", displayName: "Dan" });
    assert.equal(danAccess.items.length, 1);
    assert.equal(danAccess.items[0].name, "Force of Nature");
    assert.equal(danAccess.items[0].role, "player");
    assert.deepEqual(danAccess.items[0].characters.map(({ name, className }) => ({ name, className })), [
      { name: "Dar'eleth", className: "Paladin" },
    ]);
    assert.equal(danAccess.items[0].encounters.length, 1);

    const code = danAccess.items[0].encounters[0].code;
    const joined = await worker.fetch(request(`/api/encounters/${code}/join`, {
      method: "POST",
      body: JSON.stringify({ identityId: "identity-dan", campaignId: "campaign-force-of-nature", role: "dm" }),
    }), { DB: db }, context());
    assert.equal(joined.status, 200);
    const session = await joined.json();
    assert.equal(session.participantName, "Dan");
    assert.equal(session.role, "player", "the server resolves role from campaign membership");
    assert.equal(session.state.tokens.find((token) => token.name === "Dar'eleth").controlledByViewer, true);
    assert.equal(session.state.tokens.find((token) => token.name === "Jelton").controlledByViewer, false);
  });
});

test("encounter entry rejects identities outside the selected campaign", async () => {
  await withWorker(async (worker, db) => {
    const encounter = await db.prepare("SELECT code FROM encounters LIMIT 1").first();
    const unknown = await worker.fetch(request(`/api/encounters/${encounter.code}/join`, {
      method: "POST",
      body: JSON.stringify({ identityId: "identity-unknown", campaignId: "campaign-force-of-nature" }),
    }), { DB: db }, context());
    assert.equal(unknown.status, 403);
    const wrongCampaign = await worker.fetch(request(`/api/encounters/${encounter.code}/join`, {
      method: "POST",
      body: JSON.stringify({ identityId: "identity-dan", campaignId: "campaign-another" }),
    }), { DB: db }, context());
    assert.equal(wrongCampaign.status, 403);
  });
});

test("DM-created encounters stay in the selected campaign and retain character relationships", async () => {
  await withWorker(async (worker, db) => {
    const encounter = await db.prepare("SELECT code FROM encounters LIMIT 1").first();
    const joined = await worker.fetch(request(`/api/encounters/${encounter.code}/join`, {
      method: "POST",
      body: JSON.stringify({ identityId: "identity-kevin", campaignId: "campaign-force-of-nature" }),
    }), { DB: db }, context());
    const session = await joined.json();
    const created = await worker.fetch(request(`/api/encounters/${encounter.code}/command`, {
      method: "POST",
      body: JSON.stringify({
        participantId: session.participantId,
        sessionSecret: session.sessionSecret,
        command: "create-scenario",
        payload: { name: "Campaign Relationship Test", mode: "party" },
      }),
    }), { DB: db }, context());
    assert.equal(created.status, 200);
    const result = await created.json();
    const row = await db.prepare("SELECT id, campaign_id FROM encounters WHERE code = ?")
      .bind(result.scenario.code).first();
    assert.equal(row.campaign_id, "campaign-force-of-nature");
    const tokens = await db.prepare(
      "SELECT campaign_character_id FROM tokens WHERE encounter_id = ? ORDER BY campaign_character_id",
    ).bind(row.id).all();
    assert.deepEqual(tokens.results.map(({ campaign_character_id }) => campaign_character_id), [
      "character-dareleth", "character-jelton", "character-malichar",
    ]);
  });
});

function request(path, init = {}) {
  return new Request(`http://localhost${path}`, {
    headers: { "CF-Connecting-IP": "192.0.2.44", "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

function context() {
  return { waitUntil() {}, passThroughOnException() {} };
}

async function withWorker(run) {
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
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("campaign-access-test", `${process.pid}-${Date.now()}-${Math.random()}`);
    const { default: worker } = await import(workerUrl.href);
    await run(worker, db);
  } finally {
    await miniflare.dispose();
  }
}
