import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EncounterSetupDetails } from "@/app/encounter-setup-details";
import type { ParticipantSession } from "@/shared/contracts";

const dm: ParticipantSession = { id: "dm", name: "Kevin", role: "dm", sessionSecret: "secret" };

describe("EncounterSetupDetails", () => {
  it("keeps the DM briefing and durable handout preparation together", async () => {
    const onUpload = vi.fn();
    render(<EncounterSetupDetails
      participant={dm}
      encounterCode="EMBER-KEEP"
      dmBriefing="Mind the dragon beneath the bell."
      handouts={[]}
      title="Invitation"
      uploading={false}
      uploadError=""
      deletingId={null}
      onTitleChange={vi.fn()}
      onUpload={onUpload}
      onPreview={vi.fn()}
      onDelete={vi.fn()}
    />);

    expect(screen.getByText("Briefing & handouts")).toBeTruthy();
    expect(screen.getByText("Mind the dragon beneath the bell.")).toBeTruthy();
    expect(screen.getByText("No handouts prepared for this encounter.")).toBeTruthy();

    const file = new File(["image"], "invitation.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Add image"), file);
    expect(onUpload).toHaveBeenCalledWith(file, "Invitation");
  });
});
