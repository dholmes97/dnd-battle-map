import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatPanel, HandoutLightbox } from "@/app/chat-handouts-ui";
import type { EncounterState, ParticipantSession } from "@/shared/contracts";

const participant: ParticipantSession = { id: "p-dan", name: "Dan", role: "player", sessionSecret: "secret" };
const state = {
  encounter: { code: "TEST", updatedAt: 100 },
  handouts: [],
} as unknown as EncounterState;

function renderChat(overrides: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const properties: Parameters<typeof ChatPanel>[0] = {
    participant,
    state,
    dock: "left",
    minimized: false,
    unreadTotal: 0,
    channels: [{ key: "everyone", label: "Everyone" }, { key: "Kevin", label: "DM" }],
    activeChannel: "everyone",
    unreadByChannel: {},
    messages: [],
    messagesRef: { current: null },
    draft: "",
    sending: false,
    handoutPickerOpen: false,
    handoutUploading: false,
    handoutUploadError: "",
    selectedHandout: null,
    showImmediately: false,
    onDockPointerDown: vi.fn(),
    onDockPointerMove: vi.fn(),
    onDockPointerEnd: vi.fn(),
    onToggleMinimized: vi.fn(),
    onClose: vi.fn(),
    onSelectChannel: vi.fn(),
    onMessagesScroll: vi.fn(),
    onOpenHandout: vi.fn(),
    onDraftChange: vi.fn(),
    onSend: vi.fn(),
    onToggleHandoutPicker: vi.fn(),
    onUploadNew: vi.fn(),
    onSelectHandout: vi.fn(),
    onRemoveHandout: vi.fn(),
    onShowImmediatelyChange: vi.fn(),
    ...overrides,
  };
  render(<ChatPanel {...properties} />);
  return properties;
}

describe("ChatPanel", () => {
  it("shows a compact numeric badge when minimized", () => {
    renderChat({ minimized: true, unreadTotal: 3 });
    expect(screen.getByLabelText("3 unread messages").textContent).toBe("3");
    expect(screen.queryByText("3 unread")).toBeNull();
  });

  it("selects private channels and exposes their unread count", async () => {
    const onSelectChannel = vi.fn();
    renderChat({ unreadByChannel: { Kevin: 2 }, onSelectChannel });
    const privateChannel = screen.getByRole("button", { name: "DM2" });
    expect(privateChannel.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(privateChannel);
    expect(onSelectChannel).toHaveBeenCalledWith("Kevin");
  });

  it("sends on Enter but preserves Shift+Enter for a new line", () => {
    const onSend = vi.fn();
    renderChat({ draft: "Ready", onSend });
    const input = screen.getByLabelText("Chat message");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledOnce();
    expect(screen.getByRole("log").getAttribute("tabindex")).toBe("0");
  });

  it("uses the standard remove control and retains the immediate-view choice", async () => {
    const onRemoveHandout = vi.fn();
    const onShowImmediatelyChange = vi.fn();
    renderChat({
      participant: { ...participant, name: "Kevin", role: "dm" },
      selectedHandout: { id: "h1", title: "Invitation", width: 600, height: 900, displayBytes: 1200, thumbnailBytes: 240, createdAt: 1, updatedAt: 1, messageCount: 0 },
      showImmediately: true,
      onRemoveHandout,
      onShowImmediatelyChange,
    });
    expect((screen.getByRole("checkbox", { name: /Show immediately/ }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Remove attached handout" }));
    expect(onRemoveHandout).toHaveBeenCalledOnce();
  });
});

describe("HandoutLightbox", () => {
  it("defaults to whole-image Fit and lets the viewer request Actual size", async () => {
    const onFitModeChange = vi.fn();
    render(<HandoutLightbox
      participant={participant}
      encounterCode="TEST"
      handout={{ id: "h1", title: "Invitation", width: 600, height: 1200, updatedAt: 1, available: true }}
      fitMode
      onFitModeChange={onFitModeChange}
      onClose={vi.fn()}
    />);
    expect(screen.getByRole("button", { name: "Fit" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Actual size" }));
    expect(onFitModeChange).toHaveBeenCalledWith(false);
  });
});
