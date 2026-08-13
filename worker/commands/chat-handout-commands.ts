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
  type CommandEncounter,
  type CommandOutcome,
  type CommandParticipant,
  type CommandServices,
} from "./types.ts";

export type ChatHandoutCommandContext = {
  encounter: CommandEncounter;
  participant: CommandParticipant;
  body: Record<string, unknown>;
  now: number;
  repository: ChatHandoutRepository;
  objectStorage: HandoutObjectStorage;
  services: CommandServices;
};

export async function sendChatMessage(context: ChatHandoutCommandContext): Promise<CommandOutcome> {
  const { body, encounter, participant, repository, services, now } = context;
  const messageBody = cleanChatBody(body.message);
  const handoutId = cleanEntityId(body.handoutId) || null;
  const showImmediately = Boolean(handoutId && participant.role === "dm" && body.showImmediately === true);
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
    requestedRecipientName: body.recipientName,
  });
  if (!recipient.allowed) return commandError(recipient.error, 403);

  const messageId = services.createId();
  await repository.writeChatMessage({
    id: messageId,
    encounterId: encounter.id,
    senderName: participant.name,
    senderRole: participant.role,
    recipientName: recipient.recipientName,
    body: messageBody,
    handoutId,
    showImmediately,
    createdAt: now,
  });
  await services.bumpEncounter();
  return { payload: { messageId, state: await services.loadState() } };
}

export async function deleteHandout(context: ChatHandoutCommandContext): Promise<CommandOutcome> {
  const { body, encounter, participant, repository, objectStorage, services, now } = context;
  if (participant.role !== "dm") return commandError("This action requires the DM role.", 403);
  if (!objectStorage.available) return commandError("Handout storage is unavailable.", 503);
  const handoutId = cleanEntityId(body.handoutId);
  const handout = await repository.findDeletableHandout(encounter.id, handoutId);
  if (!handout) return commandError("Handout not found.", 404);

  const references = await repository.countHandoutReferences(encounter.id, handout.id);
  await objectStorage.deleteObjects([handout.displayKey, handout.thumbnailKey]);
  await repository.markHandoutDeleted(encounter.id, handout.id, now);
  await services.bumpEncounter();
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
