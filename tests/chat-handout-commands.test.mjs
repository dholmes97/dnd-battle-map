import assert from "node:assert/strict";
import test from "node:test";

import { deleteHandout, sendChatMessage } from "../worker/commands/chat-handout-commands.ts";

function context(overrides = {}) {
  const calls = [];
  return {
    calls,
    value: {
      encounter: { id: "encounter-1", code: "TEST", name: "Test", version: 1, status: "setup", activeMapImageId: null, activeMapSetupJson: null, activeMapPackageJson: null, draftMapImageId: null, draftMapSetupJson: null, gridWidth: 24, gridHeight: 16, currentRound: 0, activeInitiativeOrder: null, strictMovement: true, updatedAt: 1 },
      participant: { id: "participant-1", name: "Kevin", role: "dm" },
      payload: {},
      now: 1234,
      repository: {
        handoutIsAvailable: async () => true,
        writeChatMessage: async (message) => { calls.push(["message", message]); return true; },
        findDeletableHandout: async () => ({ id: "handout-1", displayKey: "display", thumbnailKey: "thumbnail" }),
        countHandoutReferences: async () => 3,
        markHandoutDeleted: async (...args) => calls.push(["deleted", ...args]),
      },
      objectStorage: {
        available: true,
        reconcileCleanup: async () => calls.push(["reconcile"]),
      },
      services: {
        createId: () => "message-1",
        loadState: async () => ({ marker: "state" }),
        commit: async (...args) => calls.push(["commit", ...args]),
        commitFor: async (...args) => calls.push(["commit-for", ...args]),
      },
      ...overrides,
    },
  };
}

test("chat handler applies recipient policy and writes through a fake port", async () => {
  const fixture = context({ payload: { message: "  Look here  ", recipientName: "Dan" } });
  const result = await sendChatMessage(fixture.value);
  assert.equal(result.status, undefined);
  assert.equal(result.payload.messageId, "message-1");
  assert.deepEqual(fixture.calls[0], ["message", {
    id: "message-1",
    encounterId: "encounter-1",
    senderName: "Kevin",
    senderRole: "dm",
    recipientName: "Dan",
    body: "Look here",
    handoutId: null,
    showImmediately: false,
    createdAt: 1234,
  }]);
  assert.equal(fixture.calls.at(-1)[0], "commit");
});

test("players cannot send handouts or private messages to another player", async () => {
  const handout = context({
    participant: { id: "dan", name: "Dan", role: "player" },
    payload: { handoutId: "handout-1" },
  });
  assert.deepEqual(await sendChatMessage(handout.value), {
    status: 403,
    payload: { error: "Only the DM can share handouts." },
  });
  const privateMessage = context({
    participant: { id: "dan", name: "Dan", role: "player" },
    payload: { message: "secret", recipientName: "Barry" },
  });
  assert.equal((await sendChatMessage(privateMessage.value)).status, 403);
});

test("chat quota failure preserves existing durable messages and does not bump state", async () => {
  const fixture = context({
    payload: { message: "One too many" },
    repository: {
      ...context().value.repository,
      writeChatMessage: async () => false,
    },
  });
  assert.equal((await sendChatMessage(fixture.value)).status, 409);
  assert.deepEqual(fixture.calls, []);
});

test("handout deletion commits a tombstone/outbox before cleanup reconciliation", async () => {
  const fixture = context({ payload: { handoutId: "handout-1" } });
  const result = await deleteHandout(fixture.value);
  assert.equal(result.payload.deleted, true);
  assert.equal(result.payload.referencedMessages, 3);
  assert.deepEqual(fixture.calls, [
    ["deleted", "encounter-1", { id: "handout-1", displayKey: "display", thumbnailKey: "thumbnail" }, 1234],
    ["commit", "handout_deleted", { handoutId: "handout-1", referencedMessages: 3 }],
    ["reconcile"],
  ]);
});
