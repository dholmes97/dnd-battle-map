import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

import { handleScenarioProvisioningApi } from "../worker/scenario-provisioning-api.ts";

const token = "test-scenario-provisioning-token-000001";

test("mail provenance API prevents an allowlisted self-reply from becoming a scenario revision", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  try {
    const db = await miniflare.getD1Database("DB");
    await applyMigrations(db);
    const environment = {
      DB: db,
      SCENARIO_PROVISIONING_TOKEN: token,
      SCENARIO_PROVISIONING_SENDERS: "kevin@example.com,dan@example.com",
    };
    const createdResponse = await handleScenarioProvisioningApi(
      jsonRequest("http://localhost/api/scenario-provisioning/jobs", manifest()),
      environment,
    );
    assert.equal(createdResponse.status, 201);
    const jobId = (await createdResponse.json()).job.id;

    const transitioned = await handleScenarioProvisioningApi(
      jsonRequest(`http://localhost/api/scenario-provisioning/jobs/${jobId}`, { status: "needs_clarification", summary: "Need one answer." }, "PATCH"),
      environment,
    );
    assert.equal(transitioned.status, 200);

    const reservedResponse = await handleScenarioProvisioningApi(
      jsonRequest(`http://localhost/api/scenario-provisioning/jobs/${jobId}/mail-replies`, { kind: "clarification" }),
      environment,
    );
    assert.equal(reservedResponse.status, 201);
    const reply = (await reservedResponse.json()).reply;
    assert.match(reply.responseMarker, /^DND-SCENARIO-REPLY:/);

    const recordedResponse = await handleScenarioProvisioningApi(
      jsonRequest(`http://localhost/api/scenario-provisioning/jobs/${jobId}/mail-replies/${reply.id}/messages`, { messageId: "dan-automation-reply-1", threadId: "self-thread" }),
      environment,
    );
    assert.equal(recordedResponse.status, 201);

    const classificationResponse = await handleScenarioProvisioningApi(
      jsonRequest("http://localhost/api/scenario-provisioning/mail-messages/classify", {
        mailboxKey: "primary",
        messageId: "dan-automation-reply-1",
        threadId: "self-thread",
      }),
      environment,
    );
    assert.deepEqual((await classificationResponse.json()).classification, {
      automationAuthored: true,
      recovered: false,
      reply,
    });

    const loopAttempt = await handleScenarioProvisioningApi(
      jsonRequest("http://localhost/api/scenario-provisioning/jobs", manifest({
        idempotencyKey: "gmail-primary-dan-automation-reply-1",
        source: { provider: "gmail", mailboxKey: "primary", messageId: "dan-automation-reply-1", threadId: "self-thread", sender: "dan@example.com" },
      })),
      environment,
    );
    assert.equal(loopAttempt.status, 409);
    assert.equal((await loopAttempt.json()).code, "mail_message_automation_authored");

    const humanClassification = await handleScenarioProvisioningApi(
      jsonRequest("http://localhost/api/scenario-provisioning/mail-messages/classify", {
        mailboxKey: "primary",
        messageId: "dan-human-followup-1",
        threadId: "self-thread",
      }),
      environment,
    );
    assert.equal((await humanClassification.json()).classification.automationAuthored, false);
  } finally {
    await miniflare.dispose();
  }
});

async function applyMigrations(db) {
  const directory = new URL("../drizzle/", import.meta.url);
  const migrations = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  for (const migration of migrations) {
    const sql = await readFile(new URL(migration, directory), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}

function jsonRequest(url, body, method = "POST") {
  const serialized = JSON.stringify(body);
  return new Request(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(serialized)),
    },
    body: serialized,
  });
}

function manifest(overrides = {}) {
  return {
    version: 1,
    idempotencyKey: "gmail-primary-dan-human-1",
    revision: 1,
    operation: "create",
    source: { provider: "gmail", mailboxKey: "primary", messageId: "dan-human-1", threadId: "self-thread", sender: "dan@example.com" },
    scenario: { name: "Sunken Chapel", briefing: "Briefing", presetName: "Sunken Chapel", presetDescription: "" },
    settings: { strictMovement: false },
    party: { include: true, sourceScenarioCode: "EMBER-KEEP", placements: [] },
    map: {
      id: "sunken-chapel-v1", assetId: "map-main", name: "Sunken Chapel", description: "Flooded chapel",
      biome: "dungeon", mood: "torchlight", width: 24, height: 16,
      fog: { mode: "off", sharedPolygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }], walls: [], doors: [], circles: [] },
      labels: [], notes: [],
    },
    handouts: [], creatures: [], assumptions: [], reviewWarnings: [],
    ...overrides,
  };
}
