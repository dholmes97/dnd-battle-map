import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CampaignList } from "@/app/campaign-list";

describe("CampaignList", () => {
  it("shows campaigns available to the signed-in human and opens the selected campaign", async () => {
    const onEnterCampaign = vi.fn();
    render(<CampaignList
      identity={{ id: "identity-dan", displayName: "Dan" }}
      campaigns={[{
        id: "campaign-force-of-nature", slug: "force-of-nature", name: "Force of Nature",
        membershipId: "membership-dan", role: "player",
        characters: [{ id: "character-dareleth", name: "Dar'eleth", className: "Paladin", artAsset: null }],
        encounters: [{ code: "EMBER-KEEP", name: "Ember Keep", status: "setup", updatedAt: 1 }],
      }]}
      loading={false}
      error=""
      onEnterCampaign={onEnterCampaign}
      onSignOut={vi.fn()}
    />);
    expect(screen.getByRole("heading", { name: "Welcome back, Dan." })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Force of Nature" })).toBeTruthy();
    expect(screen.getByText("Dar'eleth · Paladin")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Open campaign/ }));
    expect(onEnterCampaign).toHaveBeenCalledWith("campaign-force-of-nature");
  });
});
