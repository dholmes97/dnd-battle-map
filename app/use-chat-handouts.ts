"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { prepareHandoutImages } from "@/app/handout-images";
import { viewerHeaders, type EncounterSync } from "@/app/use-encounter-sync";
import type {
  EncounterState,
  ParticipantSession,
  Role,
  SharedChatMessage,
  SharedHandout,
} from "@/shared/contracts";
import {
  CHAT_DM_NAME,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_PLAYER_NAMES,
  chatChannelKeyForMessage,
  incomingImmediateHandouts,
} from "@/shared/chat-domain.ts";
import { cleanHandoutTitle } from "@/shared/handout-domain.ts";
import type { ChatDock } from "@/app/chat-handouts-ui";

type ChatPreferences = { dock: ChatDock; readAt: Record<string, number> };

const CHAT_UI_STORAGE_PREFIX = "dnd-battle-map:chat:v1";

function chatPreferencesStorageKey(name: string, role: Role, encounterCode: string) {
  return `${CHAT_UI_STORAGE_PREFIX}:${encounterCode}:${role}:${encodeURIComponent(name.trim().toLocaleLowerCase())}`;
}

function loadChatPreferences(name: string, role: Role, encounterCode: string): ChatPreferences {
  try {
    const stored = window.localStorage.getItem(chatPreferencesStorageKey(name, role, encounterCode));
    if (!stored) return { dock: "left", readAt: {} };
    const parsed = JSON.parse(stored) as Partial<ChatPreferences>;
    const readAt = parsed.readAt && typeof parsed.readAt === "object"
      ? Object.fromEntries(Object.entries(parsed.readAt).filter((entry): entry is [string, number] => Number.isFinite(entry[1])))
      : {};
    return { dock: parsed.dock === "right" ? "right" : "left", readAt };
  } catch {
    return { dock: "left", readAt: {} };
  }
}

type UseChatHandoutsInput = {
  participant: ParticipantSession | null;
  state: EncounterState | null;
  sync: EncounterSync;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useChatHandouts({ participant, state, sync, canvasRef, setNotice }: UseChatHandoutsInput) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [dock, setDock] = useState<ChatDock>("left");
  const [activeChannel, setActiveChannel] = useState("everyone");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [readAt, setReadAt] = useState<Record<string, number>>({});
  const [handoutTitle, setHandoutTitle] = useState("");
  const [handoutUploading, setHandoutUploading] = useState(false);
  const [handoutUploadError, setHandoutUploadError] = useState("");
  const [handoutDeletingId, setHandoutDeletingId] = useState<string | null>(null);
  const [handoutPickerOpen, setHandoutPickerOpen] = useState(false);
  const [selectedHandoutId, setSelectedHandoutId] = useState<string | null>(null);
  const [showImmediately, setShowImmediately] = useState(false);
  const [lightboxHandout, setLightboxHandout] = useState<SharedChatMessage["handout"]>(null);
  const [handoutFitMode, setHandoutFitMode] = useState(true);
  const [forcedHandoutQueue, setForcedHandoutQueue] = useState<NonNullable<SharedChatMessage["handout"]>[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const shouldStickRef = useRef(true);
  const dockDragRef = useRef<number | null>(null);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const immediateReadyRef = useRef(false);

  const preferencesKey = participant && state
    ? chatPreferencesStorageKey(participant.name, participant.role, state.encounter.code)
    : null;
  const channels = participant?.role === "dm"
    ? [{ key: "everyone", label: "Everyone" }, ...CHAT_PLAYER_NAMES.map((name) => ({ key: name, label: name }))]
    : [{ key: "everyone", label: "Everyone" }, { key: CHAT_DM_NAME, label: "DM" }];
  const messages = participant && state
    ? state.chatMessages.filter((message) => chatChannelKeyForMessage(message, participant) === activeChannel)
    : [];
  const unreadByChannel = participant && state
    ? state.chatMessages.reduce<Record<string, number>>((counts, message) => {
      const channel = chatChannelKeyForMessage(message, participant);
      const readThrough = open && !minimized && channel === activeChannel
        ? Number.POSITIVE_INFINITY
        : readAt[channel] ?? 0;
      if (message.senderName !== participant.name && message.createdAt > readThrough) {
        counts[channel] = (counts[channel] ?? 0) + 1;
      }
      return counts;
    }, {})
    : {};
  const unreadTotal = Object.values(unreadByChannel).reduce((total, count) => total + count, 0);
  const latestAt = messages.at(-1)?.createdAt ?? 0;
  const selectedHandout = state?.handouts.find((handout) => handout.id === selectedHandoutId) ?? null;

  useEffect(() => {
    if (!preferencesKey) return;
    try {
      window.localStorage.setItem(preferencesKey, JSON.stringify({ dock, readAt }));
    } catch {
      // Chat content remains authoritative; only docking and read markers are local preferences.
    }
  }, [dock, preferencesKey, readAt]);

  useEffect(() => {
    const element = messagesRef.current;
    if (!open || minimized || !element || !shouldStickRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [activeChannel, latestAt, minimized, open]);

  useEffect(() => {
    if (!participant || !state) return;
    const incoming = incomingImmediateHandouts(
      state.chatMessages,
      participant,
      knownMessageIdsRef.current,
      immediateReadyRef.current,
    );
    knownMessageIdsRef.current = new Set(incoming.knownMessageIds);
    immediateReadyRef.current = true;
    const newHandouts = incoming.handouts
      .filter((handout: SharedChatMessage["handout"]): handout is NonNullable<SharedChatMessage["handout"]> => Boolean(handout));
    if (newHandouts.length) setForcedHandoutQueue((current) => [...current, ...newHandouts]);
  }, [participant, state]);

  useEffect(() => {
    if (lightboxHandout || forcedHandoutQueue.length === 0) return;
    const timer = window.setTimeout(() => {
      setLightboxHandout(forcedHandoutQueue[0]);
      setHandoutFitMode(true);
      setForcedHandoutQueue((current) => current.slice(1));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [forcedHandoutQueue, lightboxHandout]);

  const markChannelRead = (channel: string) => {
    if (!participant || !state) return;
    const latest = state.chatMessages
      .filter((message) => chatChannelKeyForMessage(message, participant) === channel)
      .at(-1)?.createdAt ?? 0;
    if (!latest) return;
    setReadAt((current) => latest > (current[channel] ?? 0) ? { ...current, [channel]: latest } : current);
  };

  const resetForParticipant = (name: string, role: Role, encounterCode: string) => {
    const preferences = loadChatPreferences(name, role, encounterCode);
    setDock(preferences.dock);
    setReadAt(preferences.readAt);
    setActiveChannel("everyone");
    setOpen(false);
    setMinimized(false);
    setSelectedHandoutId(null);
    setShowImmediately(false);
    setForcedHandoutQueue([]);
    knownMessageIdsRef.current.clear();
    immediateReadyRef.current = false;
    setHandoutPickerOpen(false);
    setLightboxHandout(null);
  };

  const sendMessage = async () => {
    if (!participant || !state || sending) return;
    const message = draft.replace(/\r\n?/g, "\n").trim().slice(0, CHAT_MESSAGE_MAX_LENGTH);
    if (!message && !selectedHandout) return;
    const recipientName = activeChannel === "everyone"
      ? null
      : participant.role === "dm" ? activeChannel : CHAT_DM_NAME;
    const optimisticMessage: SharedChatMessage = {
      id: `pending-chat-${crypto.randomUUID()}`,
      senderName: participant.name,
      senderRole: participant.role,
      recipientName,
      body: message,
      showImmediately: Boolean(selectedHandout && showImmediately),
      handout: selectedHandout ? {
        id: selectedHandout.id,
        title: selectedHandout.title,
        width: selectedHandout.width,
        height: selectedHandout.height,
        updatedAt: selectedHandout.updatedAt,
        available: true,
      } : null,
      createdAt: Math.max(state.encounter.updatedAt, state.chatMessages.at(-1)?.createdAt ?? 0) + 1,
    };
    setSending(true);
    setDraft("");
    setSelectedHandoutId(null);
    setShowImmediately(false);
    setHandoutPickerOpen(false);
    shouldStickRef.current = true;
    const result = await sync.runOptimisticCommand<{ state: EncounterState; messageId: string }>(
      "send-chat-message",
      { recipientName, message, handoutId: selectedHandout?.id ?? null, showImmediately: Boolean(selectedHandout && showImmediately) },
      (current) => ({ ...current, chatMessages: [...current.chatMessages, optimisticMessage] }),
      undefined,
      undefined,
      false,
    );
    if (!result) {
      setDraft((current) => current || message);
      setSelectedHandoutId(selectedHandout?.id ?? null);
      setShowImmediately(Boolean(selectedHandout && showImmediately));
    }
    setSending(false);
  };

  const uploadHandout = async (file: File, requestedTitle: string, selectForChat = false, replaceId: string | null = null) => {
    if (!participant || participant.role !== "dm" || !state || handoutUploading) return;
    const fallbackTitle = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    const title = cleanHandoutTitle(requestedTitle || fallbackTitle);
    if (!title) { setHandoutUploadError("Give the handout a title."); return; }
    setHandoutUploading(true);
    setHandoutUploadError("");
    try {
      const prepared = await prepareHandoutImages(file);
      const form = new FormData();
      form.set("title", title);
      form.set("display", prepared.display, "display.webp");
      form.set("thumbnail", prepared.thumbnail, "thumbnail.webp");
      if (replaceId) form.set("replaceId", replaceId);
      const response = await fetch(`/api/encounters/${encodeURIComponent(state.encounter.code)}/handouts`, {
        method: "POST",
        headers: viewerHeaders(participant),
        body: form,
      });
      const result = await response.json() as { handoutId?: string; state?: EncounterState; error?: string };
      if (!response.ok || !result.state || !result.handoutId) throw new Error(result.error || "The handout could not be saved.");
      sync.acceptState(result.state);
      setHandoutTitle("");
      if (selectForChat) {
        setSelectedHandoutId(result.handoutId);
        setHandoutPickerOpen(false);
      }
      setNotice(replaceId ? `${title} updated.` : `${title} prepared.`);
    } catch (uploadError) {
      setHandoutUploadError(uploadError instanceof Error ? uploadError.message : "The handout could not be saved.");
    }
    setHandoutUploading(false);
  };

  const deleteHandout = async (handout: SharedHandout) => {
    if (!participant || participant.role !== "dm" || handoutDeletingId) return;
    const warning = handout.messageCount > 0
      ? `Delete “${handout.title}”? It appears in ${handout.messageCount} chat ${handout.messageCount === 1 ? "message" : "messages"}; those messages will keep their captions but show that the image is unavailable.`
      : `Delete “${handout.title}” from this scenario?`;
    if (!window.confirm(warning)) return;
    setHandoutDeletingId(handout.id);
    if (selectedHandoutId === handout.id) setSelectedHandoutId(null);
    await sync.runOptimisticCommand(
      "delete-handout",
      { handoutId: handout.id },
      (current) => ({
        ...current,
        handouts: current.handouts.filter((candidate) => candidate.id !== handout.id),
        chatMessages: current.chatMessages.map((message) => message.handout?.id === handout.id
          ? { ...message, handout: { ...message.handout, available: false } }
          : message),
      }),
      `${handout.title} deleted.`,
      undefined,
      false,
    );
    setHandoutDeletingId(null);
  };

  const onDockPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    dockDragRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onDockPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (dockDragRef.current !== event.pointerId) return;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (bounds) setDock(event.clientX < bounds.left + bounds.width / 2 ? "left" : "right");
  };
  const onDockPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    if (dockDragRef.current !== event.pointerId) return;
    dockDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return {
    open, setOpen, minimized, setMinimized, dock, activeChannel, setActiveChannel,
    draft, setDraft, sending, channels, messages, unreadByChannel, unreadTotal,
    messagesRef, shouldStickRef, markChannelRead, resetForParticipant, sendMessage,
    handoutTitle, setHandoutTitle, handoutUploading, handoutUploadError, setHandoutUploadError,
    handoutDeletingId, handoutPickerOpen, setHandoutPickerOpen,
    selectedHandoutId, setSelectedHandoutId, selectedHandout,
    showImmediately, setShowImmediately, lightboxHandout, setLightboxHandout,
    handoutFitMode, setHandoutFitMode, uploadHandout, deleteHandout,
    onDockPointerDown, onDockPointerMove, onDockPointerEnd,
  };
}
