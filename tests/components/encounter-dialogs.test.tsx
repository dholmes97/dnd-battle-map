import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConcentrationReminderDialog, EncounterDialogs } from "@/app/encounter-dialogs";
import type { EncounterState, ParticipantSession } from "@/shared/contracts";

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

describe("EncounterDialogs scenario details", () => {
  it("keeps creation on Campaign Home instead of offering it inside a scenario", () => {
    const participant: ParticipantSession = { id: "dm", name: "Kevin", role: "dm", sessionSecret: "secret" };
    const state = { encounter: { code: "EMBER-KEEP", name: "Ember Keep", dmBriefing: "Mind the dragon." }, handouts: [] } as unknown as EncounterState;
    const scenario = { open: true, setOpen: vi.fn(), show: vi.fn() };

    render(<EncounterDialogs
      participant={participant} state={state} resetOpen={false} restartOpen={false}
      concentrationReminder={null} scenario={scenario as never} handoutTitle="" handoutUploading={false}
      handoutUploadError="" handoutDeletingId={null} lightboxHandout={null} handoutFitMode
      onResetOpen={vi.fn()} onRestartOpen={vi.fn()} onReset={vi.fn()} onRestart={vi.fn()}
      onDismissConcentrationReminder={vi.fn()} onHandoutTitle={vi.fn()} onUploadHandout={vi.fn()}
      onPreviewHandout={vi.fn()} onDeleteHandout={vi.fn()} onHandoutFitMode={vi.fn()} onCloseLightbox={vi.fn()}
    />);

    expect(screen.getByRole("heading", { name: "Scenario details" })).toBeTruthy();
    expect(screen.getByText(/Rename scenarios from Campaign Home/)).toBeTruthy();
    expect(screen.queryByText("Create another scenario")).toBeNull();
    expect(screen.queryByLabelText("New scenario name")).toBeNull();
    expect(screen.queryByLabelText("Current scenario name")).toBeNull();
  });
});
