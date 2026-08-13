import assert from "node:assert/strict";
import test from "node:test";

import { deleteHandout, sendChatMessage } from "../worker/commands/chat-handout-commands.ts";

function context(overrides = {}) {
  const calls = [];
  return {
    calls,
    value: {
      encounter: { id: "encounter-1", code: "TEST", name: "Test", status: "setup", mapPackageJson: null, activeMapPresetId: null, gridWidth: 24, gridHeight: 16, currentRound: 0, activeInitiativeOrder: null, strictMovement: true, updatedAt: 1 },
      participant: { id: "participant-1", name: "Kevin", role: "dm" },
      body: {},
      now: 1234,
      repository: {
        handoutIsAvailable: async () => true,
        writeChatMessage: async (message) => calls.push(["message", message]),
        findDeletableHandout: async () => ({ id: "handout-1", displayKey: "display", thumbnailKey: "thumbnail" }),
        countHandoutReferences: async () => 3,
        markHandoutDeleted: async (...args) => calls.push(["deleted", ...args]),
      },
      objectStorage: {
        available: true,
        deleteObjects: async (keys) => calls.push(["objects", keys]),
      },
      services: {
        createId: () => "message-1",
        loadState: async () => ({ marker: "state" }),
        bumpEncounter: async () => calls.push(["bump"]),
        recordAction: async () => {},
      },
      ...overrides,
    },
  };
}

test("chat handler applies recipient policy and writes through a fake port", async () => {
  const fixture = context({ body: { message: "  Look here  ", recipientName: "Dan" } });
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
  assert.deepEqual(fixture.calls.at(-1), ["bump"]);
});

test("players cannot send handouts or private messages to another player", async () => {
  const handout = context({
    participant: { id: "dan", name: "Dan", role: "player" },
    body: { handoutId: "handout-1" },
  });
  assert.deepEqual(await sendChatMessage(handout.value), {
    status: 403,
    payload: { error: "Only the DM can share handouts." },
  });
  const privateMessage = context({
    participant: { id: "dan", name: "Dan", role: "player" },
    body: { message: "secret", recipientName: "Barry" },
  });
  assert.equal((await sendChatMessage(privateMessage.value)).status, 403);
});

test("handout deletion removes both derived objects without reading D1 directly", async () => {
  const fixture = context({ body: { handoutId: "handout-1" } });
  const result = await deleteHandout(fixture.value);
  assert.equal(result.payload.deleted, true);
  assert.equal(result.payload.referencedMessages, 3);
  assert.deepEqual(fixture.calls, [
    ["objects", ["display", "thumbnail"]],
    ["deleted", "encounter-1", "handout-1", 1234],
    ["bump"],
  ]);
});
