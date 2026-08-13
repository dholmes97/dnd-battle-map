"use client";

import type { FormEvent, PointerEvent as ReactPointerEvent, RefObject, UIEvent } from "react";
import IconActionButton from "@/app/icon-action-button";
import { ProtectedHandoutImage } from "@/app/handout-images";
import type {
  EncounterState,
  ParticipantSession,
  SharedChatMessage,
  SharedHandout,
} from "@/shared/contracts";
import { CHAT_MESSAGE_MAX_LENGTH } from "@/shared/chat-domain.ts";
import { HANDOUT_MAX_PER_SCENARIO } from "@/shared/handout-domain.ts";

export type ChatDock = "left" | "right";
export type ChatChannel = { key: string; label: string };

function chatTime(createdAt: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(createdAt));
}

type ChatPanelProps = {
  participant: ParticipantSession;
  state: EncounterState;
  dock: ChatDock;
  minimized: boolean;
  unreadTotal: number;
  channels: ChatChannel[];
  activeChannel: string;
  unreadByChannel: Record<string, number>;
  messages: SharedChatMessage[];
  messagesRef: RefObject<HTMLDivElement | null>;
  draft: string;
  sending: boolean;
  handoutPickerOpen: boolean;
  handoutUploading: boolean;
  handoutUploadError: string;
  selectedHandout: SharedHandout | null;
  showImmediately: boolean;
  onDockPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onDockPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onDockPointerEnd: (event: ReactPointerEvent<HTMLElement>) => void;
  onToggleMinimized: () => void;
  onClose: () => void;
  onSelectChannel: (channel: string) => void;
  onMessagesScroll: (event: UIEvent<HTMLDivElement>) => void;
  onOpenHandout: (handout: NonNullable<SharedChatMessage["handout"]>) => void;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  onToggleHandoutPicker: () => void;
  onUploadNew: (file: File) => void;
  onSelectHandout: (handoutId: string) => void;
  onRemoveHandout: () => void;
  onShowImmediatelyChange: (show: boolean) => void;
};

export function ChatPanel({
  participant,
  state,
  dock,
  minimized,
  unreadTotal,
  channels,
  activeChannel,
  unreadByChannel,
  messages,
  messagesRef,
  draft,
  sending,
  handoutPickerOpen,
  handoutUploading,
  handoutUploadError,
  selectedHandout,
  showImmediately,
  onDockPointerDown,
  onDockPointerMove,
  onDockPointerEnd,
  onToggleMinimized,
  onClose,
  onSelectChannel,
  onMessagesScroll,
  onOpenHandout,
  onDraftChange,
  onSend,
  onToggleHandoutPicker,
  onUploadNew,
  onSelectHandout,
  onRemoveHandout,
  onShowImmediatelyChange,
}: ChatPanelProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSend();
  };
  return <section className={`chat-panel is-${dock}${minimized ? " is-minimized" : ""}`} aria-label="Encounter chat">
    <header
      className="chat-panel-header"
      onPointerDown={onDockPointerDown}
      onPointerMove={onDockPointerMove}
      onPointerUp={onDockPointerEnd}
      onPointerCancel={onDockPointerEnd}
      title="Drag to dock chat on the other side"
    >
      <span><small>Encounter</small><strong>Chat</strong></span>
      {minimized && unreadTotal > 0 ? <em className="chat-panel-unread-badge" aria-label={`${unreadTotal} unread ${unreadTotal === 1 ? "message" : "messages"}`}>{Math.min(99, unreadTotal)}</em> : null}
      <div className="chat-window-actions">
        <button type="button" className="chat-minimize" aria-label={minimized ? "Expand chat" : "Minimize chat"} onClick={onToggleMinimized}>{minimized ? "▢" : "—"}</button>
        <IconActionButton variant="close" label="Close chat" onClick={onClose} />
      </div>
    </header>
    {!minimized ? <>
      <nav className="chat-channels" aria-label="Chat conversations">
        {channels.map((channel) => <button
          type="button"
          key={channel.key}
          className={activeChannel === channel.key ? "is-active" : ""}
          aria-pressed={activeChannel === channel.key}
          onClick={() => onSelectChannel(channel.key)}
        >
          <span>{channel.label}</span>
          {(unreadByChannel[channel.key] ?? 0) > 0 ? <em>{unreadByChannel[channel.key]}</em> : null}
        </button>)}
      </nav>
      <div
        ref={messagesRef}
        className="chat-messages"
        role="log"
        aria-live="polite"
        aria-label={`${channels.find((channel) => channel.key === activeChannel)?.label ?? "Chat"} messages`}
        onScroll={onMessagesScroll}
      >
        {messages.length === 0 ? <div className="chat-empty"><strong>No messages yet</strong><span>{activeChannel === "everyone" ? "Start the table conversation." : "This conversation is private."}</span></div> : null}
        {messages.map((message) => <article className={`chat-message${message.senderName === participant.name ? " is-mine" : ""}${message.id.startsWith("pending-chat-") ? " is-pending" : ""}`} key={message.id}>
          <div><strong>{message.senderName}</strong><time dateTime={new Date(message.createdAt).toISOString()}>{chatTime(message.createdAt)}</time></div>
          {message.handout ? message.handout.available ? <button type="button" className="chat-handout-preview" onClick={() => onOpenHandout(message.handout!)} aria-label={`Open ${message.handout.title}`}>
            <ProtectedHandoutImage participant={participant} encounterCode={state.encounter.code} handoutId={message.handout.id} variant="thumbnail" revision={message.handout.updatedAt} alt="" />
            <span><small>Handout</small><strong>{message.handout.title}</strong><em>Click to enlarge</em></span>
          </button> : <div className="chat-handout-unavailable"><small>Handout removed</small><strong>{message.handout.title}</strong></div> : null}
          {message.body ? <p>{message.body}</p> : null}
        </article>)}
      </div>
      <form className="chat-compose" onSubmit={submit}>
        <div className="chat-compose-heading">
          <label htmlFor="chat-message-input">{activeChannel === "everyone" ? "Everyone can see this" : `Private with ${activeChannel}`}</label>
          {participant.role === "dm" ? <button type="button" className={handoutPickerOpen ? "is-active" : ""} onClick={onToggleHandoutPicker}>Attach image</button> : null}
        </div>
        {participant.role === "dm" && handoutPickerOpen ? <div className="chat-handout-picker">
          <div className="chat-handout-picker-head"><strong>Scenario handouts</strong><label className={handoutUploading ? "is-disabled" : ""}>{handoutUploading ? "Preparing…" : "Upload new"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={handoutUploading} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) onUploadNew(file); }} /></label></div>
          {state.handouts.length ? <div className="chat-handout-options">{state.handouts.map((handout) => <button type="button" key={handout.id} className={selectedHandout?.id === handout.id ? "is-selected" : ""} onClick={() => onSelectHandout(handout.id)}>
            <ProtectedHandoutImage participant={participant} encounterCode={state.encounter.code} handoutId={handout.id} variant="thumbnail" revision={handout.updatedAt} alt="" />
            <span>{handout.title}</span>
          </button>)}</div> : <p>No prepared handouts yet. Upload one here or in Scenario Setup.</p>}
          {handoutUploadError ? <div className="form-error" role="alert">{handoutUploadError}</div> : null}
        </div> : null}
        {selectedHandout ? <div className="chat-selected-handout"><span><small>Attached image</small><strong>{selectedHandout.title}</strong></span><IconActionButton variant="remove" label="Remove attached handout" onClick={onRemoveHandout} /><label className="chat-show-immediately"><input type="checkbox" checked={showImmediately} onChange={(event) => onShowImmediatelyChange(event.target.checked)} /><span><strong>Show immediately</strong><small>Opens for connected recipients without marking chat read.</small></span></label></div> : null}
        <div className="chat-compose-entry">
          <textarea
            id="chat-message-input"
            value={draft}
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            rows={2}
            placeholder="Write a message…"
            aria-label="Chat message"
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
          />
          <button type="submit" disabled={sending || (!draft.trim() && !selectedHandout)}>{sending ? "Sending…" : "Send"}</button>
        </div>
        <small>Enter to send · Shift+Enter for a new line</small>
      </form>
    </> : null}
  </section>;
}

type ScenarioHandoutsProps = {
  participant: ParticipantSession;
  encounterCode: string;
  handouts: SharedHandout[];
  title: string;
  uploading: boolean;
  uploadError: string;
  deletingId: string | null;
  onTitleChange: (title: string) => void;
  onUpload: (file: File, title: string, replaceId?: string) => void;
  onPreview: (handout: SharedHandout) => void;
  onDelete: (handout: SharedHandout) => void;
};

export function ScenarioHandouts({ participant, encounterCode, handouts, title, uploading, uploadError, deletingId, onTitleChange, onUpload, onPreview, onDelete }: ScenarioHandoutsProps) {
  return <section className="scenario-handouts" aria-labelledby="scenario-handouts-title">
    <div className="scenario-create-heading"><strong id="scenario-handouts-title">Prepared handouts</strong><small>Images are resized and compressed in your browser. Only a bounded display copy and thumbnail are stored.</small></div>
    <div className="handout-upload-row">
      <label>Title<input maxLength={80} value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Strahd's invitation" disabled={uploading} /></label>
      <label className={`handout-upload-button${uploading ? " is-disabled" : ""}`}>{uploading ? "Preparing image…" : "Add image"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) onUpload(file, title); }} /></label>
    </div>
    <p className="handout-storage-note">JPEG, PNG, or WebP · source under 12 MB and 24 megapixels · up to {HANDOUT_MAX_PER_SCENARIO} handouts per scenario</p>
    {uploadError ? <div className="form-error" role="alert">{uploadError}</div> : null}
    {handouts.length ? <div className="scenario-handout-list">{handouts.map((handout) => <article key={handout.id}>
      <button type="button" className="scenario-handout-preview" onClick={() => onPreview(handout)} aria-label={`Preview ${handout.title}`}>
        <ProtectedHandoutImage participant={participant} encounterCode={encounterCode} handoutId={handout.id} variant="thumbnail" revision={handout.updatedAt} alt="" />
      </button>
      <span><strong>{handout.title}</strong><small>{handout.width} × {handout.height} · {handout.messageCount ? `sent ${handout.messageCount}×` : "not sent"}</small></span>
      <div className="handout-item-actions">
        <label className={uploading ? "is-disabled" : ""}>Replace<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) onUpload(file, handout.title, handout.id); }} /></label>
        <IconActionButton variant="delete" label={`Delete ${handout.title}`} disabled={deletingId === handout.id || uploading} onClick={() => onDelete(handout)} />
      </div>
    </article>)}</div> : <div className="scenario-handout-empty">No handouts prepared for this scenario.</div>}
  </section>;
}

export function HandoutLightbox({ participant, encounterCode, handout, fitMode, onFitModeChange, onClose }: {
  participant: ParticipantSession;
  encounterCode: string;
  handout: NonNullable<SharedChatMessage["handout"]>;
  fitMode: boolean;
  onFitModeChange: (fit: boolean) => void;
  onClose: () => void;
}) {
  return <div className="handout-lightbox" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="handout-lightbox-title">
      <header><span><small>Handout</small><strong id="handout-lightbox-title">{handout.title}</strong></span><IconActionButton variant="close" label="Close handout" autoFocus onClick={onClose} /></header>
      <div className={`handout-lightbox-image${fitMode ? " is-fit" : " is-actual"}`}><ProtectedHandoutImage participant={participant} encounterCode={encounterCode} handoutId={handout.id} variant="display" revision={handout.updatedAt} alt={handout.title} /></div>
      <footer><div className="handout-view-controls" role="group" aria-label="Image size"><button type="button" aria-pressed={fitMode} onClick={() => onFitModeChange(true)}>Fit</button><button type="button" aria-pressed={!fitMode} onClick={() => onFitModeChange(false)}>Actual size</button></div>{handout.width && handout.height ? <span>{handout.width} × {handout.height}</span> : null}</footer>
    </section>
  </div>;
}
