import {
  CHAT_MESSAGE_MAX_LENGTH,
  resolveChatRecipient,
} from "../../shared/chat-domain.ts";
import type {
  ChatHandoutRepository,
  HandoutObjectStorage,
} from "../ports/chat-handout-repository.ts";
import {
  commandError,
  type CommandContextFor,
  type CommandOutcome,
} from "./types.ts";

type ChatHandoutDependencies = {
  repository: ChatHandoutRepository;
  objectStorage: HandoutObjectStorage;
};
export type ChatHandoutCommandContext<Name extends "send-chat-message" | "delete-handout"> =
  CommandContextFor<Name, ChatHandoutDependencies>;

export async function sendChatMessage(context: ChatHandoutCommandContext<"send-chat-message">): Promise<CommandOutcome> {
  const { payload, encounter, participant, repository, services, now } = context;
  const messageBody = cleanChatBody(payload.message);
  const handoutId = cleanEntityId(payload.handoutId) || null;
  const showImmediately = Boolean(handoutId && participant.role === "dm" && payload.showImmediately === true);
  if (!messageBody && !handoutId) {
    return commandError("Enter a message or attach a handout before sending.", 400);
  }
  if (handoutId && participant.role !== "dm") {
    return commandError("Only the DM can share handouts.", 403);
  }
  if (handoutId && !await repository.handoutIsAvailable(encounter.id, handoutId)) {
    return commandError("That handout is no longer available.", 404);
  }
  const recipient = resolveChatRecipient({
    senderName: participant.name,
    senderRole: participant.role,
    requestedRecipientName: payload.recipientName,
  });
  if (!recipient.allowed) return commandError(recipient.error, 403);

  const messageId = services.createId();
  if (!await repository.writeChatMessage({
    id: messageId,
    encounterId: encounter.id,
    senderName: participant.name,
    senderRole: participant.role,
    recipientName: recipient.recipientName,
    body: messageBody,
    handoutId,
    showImmediately,
    createdAt: now,
  })) return commandError("The chat message could not be stored within the scenario limit.", 409);
  await services.commit("chat_message_sent", {
    messageId,
    recipientName: recipient.recipientName,
    handoutId,
  });
  return { payload: { messageId, state: await services.loadState() } };
}

export async function deleteHandout(context: ChatHandoutCommandContext<"delete-handout">): Promise<CommandOutcome> {
  const { payload, encounter, participant, repository, objectStorage, services, now } = context;
  if (participant.role !== "dm") return commandError("This action requires the DM role.", 403);
  if (!objectStorage.available) return commandError("Handout storage is unavailable.", 503);
  const handoutId = cleanEntityId(payload.handoutId);
  const handout = await repository.findDeletableHandout(encounter.id, handoutId);
  if (!handout) return commandError("Handout not found.", 404);

  const references = await repository.countHandoutReferences(encounter.id, handout.id);
  await repository.markHandoutDeleted(encounter.id, handout, now);
  await services.commit("handout_deleted", { handoutId: handout.id, referencedMessages: references });
  await objectStorage.reconcileCleanup().catch(() => undefined);
  return {
    payload: {
      deleted: true,
      referencedMessages: references,
      state: await services.loadState(),
    },
  };
}

function cleanChatBody(value: unknown): string {
  return typeof value === "string"
    ? value
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .trim()
      .slice(0, CHAT_MESSAGE_MAX_LENGTH)
    : "";
}

function cleanEntityId(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64)
    : "";
}
