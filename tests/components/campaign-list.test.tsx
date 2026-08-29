import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
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
      qaPending={null}
      error=""
      notice=""
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
      qaPending={null}
      error=""
      notice=""
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

  it("offers three interaction QA personas with clear pending and completion feedback", async () => {
    const onLaunchQa = vi.fn();
    const props: ComponentProps<typeof CampaignList> = {
      identity: { id: "identity-dan", displayName: "Dan", canUseQaSessions: true },
      campaigns: [], invitedIdentities: [], loading: false, mutationPending: false,
      qaPending: null, error: "", notice: "", onEnterCampaign: vi.fn(),
      onCreateCampaign: vi.fn(async () => true), onLaunchQa, onResetQa: vi.fn(), onSignOut: vi.fn(),
    };
    const view = render(<CampaignList {...props} />);
    expect(screen.getByRole("heading", { name: "Interaction QA" })).toBeTruthy();
    expect(screen.getByText(/three windows/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open QA DM" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open QA Player 1" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open QA Player 2" }));
    expect(onLaunchQa).toHaveBeenCalledWith("player2");

    view.rerender(<CampaignList {...props} qaPending="reset" notice="Interaction QA fixture reset." />);
    const reset = screen.getByRole("button", { name: "Resetting fixture…" });
    expect(reset.hasAttribute("disabled")).toBe(true);
    expect(reset.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Interaction QA fixture reset.");
  });
});
