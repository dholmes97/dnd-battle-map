import assert from "node:assert/strict";
import test from "node:test";

const script = new URL("../scripts/scenario-mail-reply.mjs", import.meta.url);

test("mail reply client reserves, records, and classifies through only the bounded provisioning routes", async () => {
  const calls = [];
  const original = {
    argv: process.argv,
    fetch: globalThis.fetch,
    token: process.env.SCENARIO_PROVISIONING_TOKEN,
    site: process.env.BATTLE_MAP_SITE_URL,
  };
  try {
    process.env.SCENARIO_PROVISIONING_TOKEN = "test-scenario-provisioning-token-000001";
    process.env.BATTLE_MAP_SITE_URL = "https://battle-map.example";
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      if (url.endsWith("/mail-replies")) return response({ created: true, reply: { id: "reply-1", responseMarker: "DND-SCENARIO-REPLY:job-1:reply-1" } }, 201);
      if (url.endsWith("/messages")) return response({ created: true, message: { messageId: "gmail-message-1" } }, 201);
      if (url.endsWith("/classify")) return response({ classification: { automationAuthored: true, recovered: false } });
      throw new Error(`Unexpected request ${url}`);
    };

    await runCommand(["reserve", "job-1", "ready"], "reserve");
    await runCommand(["record", "job-1", "reply-1", "gmail-message-1", "thread-1"], "record");
    await runCommand(["classify", "primary", "gmail-message-1", "thread-1", "DND-SCENARIO-REPLY:job-1:reply-1"], "classify");

    assert.deepEqual(calls.map((call) => [new URL(call.url).pathname, call.init.method]), [
      ["/api/scenario-provisioning/jobs/job-1/mail-replies", "POST"],
      ["/api/scenario-provisioning/jobs/job-1/mail-replies/reply-1/messages", "POST"],
      ["/api/scenario-provisioning/mail-messages/classify", "POST"],
    ]);
    assert.deepEqual(calls.map((call) => call.body), [
      { kind: "ready" },
      { messageId: "gmail-message-1", threadId: "thread-1" },
      { mailboxKey: "primary", messageId: "gmail-message-1", threadId: "thread-1", responseMarker: "DND-SCENARIO-REPLY:job-1:reply-1" },
    ]);
    assert.ok(calls.every((call) => call.init.headers.authorization === "Bearer test-scenario-provisioning-token-000001"));
  } finally {
    process.argv = original.argv;
    globalThis.fetch = original.fetch;
    if (original.token === undefined) delete process.env.SCENARIO_PROVISIONING_TOKEN; else process.env.SCENARIO_PROVISIONING_TOKEN = original.token;
    if (original.site === undefined) delete process.env.BATTLE_MAP_SITE_URL; else process.env.BATTLE_MAP_SITE_URL = original.site;
  }
});

async function runCommand(arguments_, name) {
  process.argv = [process.execPath, script.pathname, ...arguments_];
  const moduleUrl = new URL(script);
  moduleUrl.searchParams.set("test", `${name}-${process.pid}-${Date.now()}`);
  await import(moduleUrl.href);
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
