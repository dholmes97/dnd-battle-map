export const CHAT_DM_NAME = "Kevin";
export const CHAT_PLAYER_NAMES = Object.freeze(["Dan", "Barry", "Scott"]);
export const CHAT_MESSAGE_MAX_LENGTH = 500;

function fixedName(value, names) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleLowerCase();
  return names.find((name) => name.toLocaleLowerCase() === normalized) ?? null;
}

export function resolveChatRecipient({ senderName, senderRole, requestedRecipientName }) {
  if (requestedRecipientName === null || requestedRecipientName === undefined || requestedRecipientName === "" || requestedRecipientName === "everyone") {
    return { allowed: true, recipientName: null };
  }
  if (senderRole === "dm") {
    const recipientName = fixedName(requestedRecipientName, CHAT_PLAYER_NAMES);
    return recipientName
      ? { allowed: true, recipientName }
      : { allowed: false, error: "The DM can privately message a player." };
  }
  const dmName = fixedName(requestedRecipientName, [CHAT_DM_NAME]);
  if (dmName && fixedName(senderName, CHAT_PLAYER_NAMES)) {
    return { allowed: true, recipientName: dmName };
  }
  return { allowed: false, error: "Players can privately message the DM." };
}

export function chatMessageVisibleToViewer(message, viewer) {
  if (!viewer) return false;
  if (message.recipientName === null) return true;
  if (viewer.role === "dm") return true;
  return message.senderName === viewer.name || message.recipientName === viewer.name;
}

export function chatChannelKeyForMessage(message, viewer) {
  if (message.recipientName === null) return "everyone";
  if (viewer.role === "dm") {
    return message.senderName === CHAT_DM_NAME ? message.recipientName : message.senderName;
  }
  return CHAT_DM_NAME;
}
