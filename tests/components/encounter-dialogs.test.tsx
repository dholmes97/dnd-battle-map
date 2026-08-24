import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConcentrationReminderDialog } from "@/app/encounter-dialogs";

describe("ConcentrationReminderDialog", () => {
  it("requires an explicit dismissal from its blocking shadowbox", () => {
    const onDismiss = vi.fn();
    const { container } = render(<ConcentrationReminderDialog reminder={{ tokenId: "token-1", tokenName: "Dar'eleth" }} onDismiss={onDismiss} />);

    expect(screen.getByRole("alertdialog", { name: "Concentration check required" })).toBeTruthy();
    expect(screen.getByText("Dar'eleth")).toBeTruthy();

    fireEvent.mouseDown(container.querySelector(".concentration-reminder-shadowbox")!);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss reminder" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
