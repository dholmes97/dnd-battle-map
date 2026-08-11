import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_DM_NAME,
  chatChannelKeyForMessage,
  chatMessageVisibleToViewer,
  resolveChatRecipient,
} from "../shared/chat-domain.mjs";

const dm = { name: CHAT_DM_NAME, role: "dm" };
const dan = { name: "Dan", role: "player" };
const barry = { name: "Barry", role: "player" };

test("chat recipients preserve public chat and restrict private threads to the DM", () => {
  assert.deepEqual(resolveChatRecipient({ senderName: "Kevin", senderRole: "dm", requestedRecipientName: null }), { allowed: true, recipientName: null });
  assert.deepEqual(resolveChatRecipient({ senderName: "Kevin", senderRole: "dm", requestedRecipientName: "dan" }), { allowed: true, recipientName: "Dan" });
  assert.deepEqual(resolveChatRecipient({ senderName: "Dan", senderRole: "player", requestedRecipientName: "Kevin" }), { allowed: true, recipientName: "Kevin" });
  assert.equal(resolveChatRecipient({ senderName: "Dan", senderRole: "player", requestedRecipientName: "Barry" }).allowed, false);
  assert.equal(resolveChatRecipient({ senderName: "Kevin", senderRole: "dm", requestedRecipientName: "Kevin" }).allowed, false);
});

test("private messages are filtered for players before state leaves the server", () => {
  const everyone = { senderName: "Scott", recipientName: null };
  const danPrivate = { senderName: "Kevin", recipientName: "Dan" };
  const barryReply = { senderName: "Barry", recipientName: "Kevin" };

  assert.equal(chatMessageVisibleToViewer(everyone, dan), true);
  assert.equal(chatMessageVisibleToViewer(danPrivate, dm), true);
  assert.equal(chatMessageVisibleToViewer(danPrivate, dan), true);
  assert.equal(chatMessageVisibleToViewer(danPrivate, barry), false);
  assert.equal(chatMessageVisibleToViewer(barryReply, dan), false);
  assert.equal(chatMessageVisibleToViewer(barryReply, barry), true);
  assert.equal(chatMessageVisibleToViewer(everyone, null), false);
});

test("visible private messages map to the correct participant thread", () => {
  assert.equal(chatChannelKeyForMessage({ senderName: "Kevin", recipientName: "Dan" }, dm), "Dan");
  assert.equal(chatChannelKeyForMessage({ senderName: "Barry", recipientName: "Kevin" }, dm), "Barry");
  assert.equal(chatChannelKeyForMessage({ senderName: "Kevin", recipientName: "Dan" }, dan), "Kevin");
  assert.equal(chatChannelKeyForMessage({ senderName: "Scott", recipientName: null }, dan), "everyone");
});
