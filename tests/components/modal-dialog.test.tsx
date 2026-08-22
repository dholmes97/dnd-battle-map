import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ModalDialog } from "@/app/modal-dialog";

function Harness({ closeOnEscape = true, initialFocus = "first", onDismiss = vi.fn() }: {
  closeOnEscape?: boolean;
  initialFocus?: "first" | "dialog";
  onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dismiss = () => { onDismiss(); setOpen(false); };
  return <div>
    <button onClick={() => setOpen(true)}>Open dialog</button>
    <button>Background action</button>
    {open ? <ModalDialog
      labelledBy="test-dialog-title"
      closeOnEscape={closeOnEscape}
      initialFocus={initialFocus}
      closeOnBackdrop
      onDismiss={dismiss}
    >
      <h2 id="test-dialog-title">Safe dialog</h2>
      <button data-dialog-initial-focus>First action</button>
      <button onClick={dismiss}>Last action</button>
    </ModalDialog> : null}
  </div>;
}

describe("ModalDialog", () => {
  it("focuses inside, traps both tab directions, makes the background inert, and restores the opener", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open dialog" });
    const background = screen.getByRole("button", { name: "Background action" });
    await user.click(opener);

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First action" }));
    expect(background.inert).toBe(true);
    expect(background.getAttribute("aria-hidden")).toBe("true");

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last action" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First action" }));

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(Boolean(background.inert)).toBe(false);
    expect(background.hasAttribute("aria-hidden")).toBe(false);
  });

  it("does not let Escape dismiss a required acknowledgement", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<Harness closeOnEscape={false} onDismiss={onDismiss} />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Safe dialog" })).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("wraps Shift+Tab to the last action when the dialog surface has initial focus", async () => {
    const user = userEvent.setup();
    render(<Harness initialFocus="dialog" />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "Safe dialog" }));
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last action" }));
  });
});
