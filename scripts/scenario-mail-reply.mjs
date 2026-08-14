#!/usr/bin/env node

const token = process.env.SCENARIO_PROVISIONING_TOKEN?.trim() ?? "";
if (token.length < 32) fail("Set SCENARIO_PROVISIONING_TOKEN to the dedicated scenario-provisioning secret.");
const siteUrl = cleanSiteUrl(process.env.BATTLE_MAP_SITE_URL);
if (!siteUrl) fail("Set BATTLE_MAP_SITE_URL to the deployed battle-map origin, such as https://example.com.");

const [command, ...arguments_] = process.argv.slice(2);
let result;
if (command === "reserve") {
  const [jobId, kind] = arguments_;
  requireArguments(command, arguments_, 2);
  result = await apiJson(`/api/scenario-provisioning/jobs/${encodeURIComponent(jobId)}/mail-replies`, { kind });
} else if (command === "record") {
  const [jobId, replyId, messageId, threadId] = arguments_;
  requireArguments(command, arguments_, 4);
  result = await apiJson(
    `/api/scenario-provisioning/jobs/${encodeURIComponent(jobId)}/mail-replies/${encodeURIComponent(replyId)}/messages`,
    { messageId, threadId },
  );
} else if (command === "classify") {
  const [mailboxKey, messageId, threadId, responseMarker] = arguments_;
  if (arguments_.length < 3 || arguments_.length > 4) usageFailure();
  result = await apiJson("/api/scenario-provisioning/mail-messages/classify", {
    mailboxKey,
    messageId,
    threadId,
    ...(responseMarker ? { responseMarker } : {}),
  });
} else {
  usageFailure();
}

console.log(JSON.stringify(result, null, 2));

async function apiJson(path, body) {
  const response = await fetch(`${siteUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  }).catch((error) => fail(`Provisioning mail request failed: ${error.message}`));
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : {}; } catch { fail(`Provisioning API returned non-JSON status ${response.status}.`); }
  if (!response.ok) fail(`Provisioning API ${value.code ?? response.status}: ${value.error ?? "request failed"}`);
  return value;
}

function requireArguments(commandName, values, count) {
  if (values.length !== count || values.some((value) => !value)) usageFailure(commandName);
}

function cleanSiteUrl(value) {
  try {
    const url = new URL(value ?? "");
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== "/") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function usageFailure() {
  fail([
    "Usage:",
    "  npm run scenario:mail-reply -- reserve <jobId> <clarification|ready|failed>",
    "  npm run scenario:mail-reply -- record <jobId> <replyId> <gmailMessageId> <gmailThreadId>",
    "  npm run scenario:mail-reply -- classify <mailboxKey> <gmailMessageId> <gmailThreadId> [responseMarker]",
  ].join("\n"));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
