import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_DM_NAME,
  chatChannelKeyForMessage,
  chatMessageVisibleToViewer,
  incomingImmediateHandouts,
  resolveChatRecipient,
  shouldShowHandoutImmediately,
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

test("immediate handouts target players without changing chat-read policy", () => {
  const publicHandout = { senderName: "Kevin", senderRole: "dm", recipientName: null, showImmediately: true, handout: { available: true } };
  const privateHandout = { ...publicHandout, recipientName: "Dan" };
  assert.equal(shouldShowHandoutImmediately(publicHandout, dan), true);
  assert.equal(shouldShowHandoutImmediately(privateHandout, dan), true);
  assert.equal(shouldShowHandoutImmediately(privateHandout, barry), false);
  assert.equal(shouldShowHandoutImmediately(publicHandout, dm), false);
  assert.equal(shouldShowHandoutImmediately({ ...publicHandout, showImmediately: false }, dan), false);
  assert.equal(shouldShowHandoutImmediately({ ...publicHandout, handout: { available: false } }, dan), false);
});

test("immediate handouts open only for messages arriving during the live session", () => {
  const oldMessage = { id: "old", senderName: "Kevin", senderRole: "dm", recipientName: null, showImmediately: true, handout: { id: "old-image", available: true } };
  const newMessage = { ...oldMessage, id: "new", handout: { id: "new-image", available: true } };
  const initial = incomingImmediateHandouts([oldMessage], dan, [], false);
  assert.deepEqual(initial.handouts, []);
  const update = incomingImmediateHandouts([oldMessage, newMessage], dan, initial.knownMessageIds, true);
  assert.deepEqual(update.handouts.map((handout) => handout.id), ["new-image"]);
  assert.deepEqual(update.knownMessageIds, ["old", "new"]);
});
