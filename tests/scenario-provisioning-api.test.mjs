import assert from "node:assert/strict";
import test from "node:test";

import { handleScenarioProvisioningApi } from "../worker/scenario-provisioning-api.ts";

const provisioningToken = "test-scenario-provisioning-token-000001";
const catalogToken = "test-catalog-import-token-00000000001";

test("provisioning API accepts only its dedicated bearer secret", async () => {
  const endpoint = "http://localhost/api/scenario-provisioning/jobs";
  const environment = {
    SCENARIO_PROVISIONING_TOKEN: provisioningToken,
    SCENARIO_PROVISIONING_SENDERS: "kevin@example.com,dan@example.com",
    CATALOG_IMPORT_TOKEN: catalogToken,
  };
  const cases = [
    new Request(endpoint, { method: "POST", headers: { "x-participant-id": "kevin-dm", "x-session-secret": "selectable-dm-session" }, body: "{}" }),
    request(endpoint, catalogToken, manifest()),
    request(endpoint, "wrong-scenario-provisioning-token-01", manifest()),
    request("http://localhost/api/scenario-provisioning/jobs/job-1/mail-replies", catalogToken, { kind: "ready" }),
    request("http://localhost/api/scenario-provisioning/mail-messages/classify", catalogToken, { mailboxKey: "primary", messageId: "message-1", threadId: "thread-1" }),
  ];
  for (const candidate of cases) {
    const response = await handleScenarioProvisioningApi(candidate, environment);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "unauthorized");
  }
});

test("provisioning API rejects a correctly signed manifest from another sender before storage", async () => {
  const response = await handleScenarioProvisioningApi(
    request("http://localhost/api/scenario-provisioning/jobs", provisioningToken, manifest("attacker@example.com")),
    {
      SCENARIO_PROVISIONING_TOKEN: provisioningToken,
      SCENARIO_PROVISIONING_SENDERS: "kevin@example.com,dan@example.com",
    },
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "sender_unauthorized");
});

function request(url, token, body) {
  const serialized = JSON.stringify(body);
  return new Request(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": String(Buffer.byteLength(serialized)) },
    body: serialized,
  });
}

function manifest(sender = "kevin@example.com") {
  return {
    version: 1,
    idempotencyKey: "gmail-primary-message-1-revision-1",
    revision: 1,
    operation: "create",
    source: { provider: "gmail", mailboxKey: "primary", messageId: "message-1", threadId: "thread-1", sender },
    scenario: { name: "Sunken Chapel", briefing: "Briefing" },
    settings: { strictMovement: false },
    party: { include: true, sourceScenarioCode: "EMBER-KEEP", placements: [] },
    map: {
      id: "sunken-chapel-v1", assetId: "map-main", name: "Sunken Chapel", description: "Flooded chapel",
      biome: "dungeon", mood: "torchlight", width: 24, height: 16,
      fog: { mode: "off", sharedPolygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }], walls: [], doors: [], circles: [] },
      labels: [], notes: [],
    },
    handouts: [], creatures: [], assumptions: [], reviewWarnings: [],
  };
}
