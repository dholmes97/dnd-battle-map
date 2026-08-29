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
      invitedIdentities={[]}
      loading={false}
      mutationPending={false}
      error=""
      onEnterCampaign={onEnterCampaign}
      onCreateCampaign={vi.fn(async () => true)}
      onLaunchQa={vi.fn()} onResetQa={vi.fn()} onSignOut={vi.fn()}
    />);
    expect(screen.getByRole("heading", { name: "Welcome back, Dan." })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Force of Nature" })).toBeTruthy();
    expect(screen.getByText("Dar'eleth · Paladin")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Open campaign/ }));
    expect(onEnterCampaign).toHaveBeenCalledWith("campaign-force-of-nature");
  });

  it("lets an authorized human create a campaign with invited players", async () => {
    const onCreateCampaign = vi.fn(async () => true);
    render(<CampaignList
      identity={{ id: "identity-dan", displayName: "Dan", canCreateCampaigns: true }}
      campaigns={[]}
      invitedIdentities={[{ id: "identity-dan", displayName: "Dan" }, { id: "identity-barry", displayName: "Barry" }]}
      loading={false}
      mutationPending={false}
      error=""
      onEnterCampaign={vi.fn()}
      onCreateCampaign={onCreateCampaign}
      onLaunchQa={vi.fn()} onResetQa={vi.fn()} onSignOut={vi.fn()}
    />);
    await userEvent.click(screen.getByRole("button", { name: /New campaign/ }));
    await userEvent.type(screen.getByLabelText("Campaign name"), "Lantern Coast");
    await userEvent.click(screen.getByRole("checkbox", { name: /Barry/ }));
    await userEvent.type(screen.getByLabelText("Character name"), "Old Rowan");
    await userEvent.type(screen.getByLabelText("Class"), "Ranger");
    await userEvent.click(screen.getByRole("button", { name: "Create campaign" }));
    expect(onCreateCampaign).toHaveBeenCalledWith({
      name: "Lantern Coast",
      players: [{ identityId: "identity-barry", character: { name: "Old Rowan", className: "Ranger", maxHp: 10, armorClass: 10, speed: 30 } }],
    });
  });
});
