import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanScenarioMailboxKey,
  cleanScenarioProviderMessageId,
  extractScenarioMailResponseMarker,
  parseScenarioMailReplyKind,
  parseScenarioMailResponseMarker,
  scenarioMailResponseMarker,
} from "../shared/scenario-mail-provenance.ts";

test("scenario mail markers round-trip from a bounded plain-text reply footer", () => {
  const marker = scenarioMailResponseMarker("job-123", "reply-456");
  assert.equal(marker, "DND-SCENARIO-REPLY:job-123:reply-456");
  assert.equal(extractScenarioMailResponseMarker(`Scenario ready.\n\n${marker}\n`), marker);
  assert.deepEqual(parseScenarioMailResponseMarker(marker), {
    marker,
    jobId: "job-123",
    replyId: "reply-456",
  });
});

test("mail provenance validation rejects loose identifiers and unsupported reply kinds", () => {
  assert.equal(parseScenarioMailReplyKind("clarification"), "clarification");
  assert.equal(parseScenarioMailReplyKind("ready"), "ready");
  assert.equal(parseScenarioMailReplyKind("sent"), null);
  assert.equal(cleanScenarioMailboxKey("primary"), "primary");
  assert.equal(cleanScenarioMailboxKey("../../mailbox"), null);
  assert.equal(cleanScenarioProviderMessageId("gmail-message-1"), "gmail-message-1");
  assert.equal(cleanScenarioProviderMessageId("message id with spaces"), null);
  assert.equal(parseScenarioMailResponseMarker("DND-SCENARIO-REPLY:unknown"), null);
});
