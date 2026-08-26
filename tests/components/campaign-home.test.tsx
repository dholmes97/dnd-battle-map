import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CampaignHome } from "@/app/campaign-home";
import type { JoinIdentity } from "@/app/join-screen";
import type { CampaignAccessSummary } from "@/shared/campaigns";

const encounters = [
  { code: "EMBER-KEEP", name: "Ember Keep", status: "active" as const, updatedAt: 1_782_000_000_000 },
  { code: "SUNLESS", name: "The Sunless Hall", status: "setup" as const, updatedAt: 1_781_000_000_000 },
];
const player: JoinIdentity = { id: "identity-dan", displayName: "Dan" };
const dm: JoinIdentity = { id: "identity-kevin", displayName: "Kevin" };
const campaign = (role: "player" | "dm"): CampaignAccessSummary => ({
  id: "campaign-force-of-nature", slug: "force-of-nature", name: "Force of Nature",
  membershipId: role === "dm" ? "membership-kevin" : "membership-dan", role,
  characters: role === "player" ? [{ id: "character-dareleth", name: "Dar'eleth", className: "Paladin", artAsset: null }] : [],
  members: role === "dm" ? [{ membershipId: "membership-kevin", identity: dm, role: "dm", characters: [] }] : [{ membershipId: "membership-dan", identity: player, role: "player", characters: [{ id: "character-dareleth", name: "Dar'eleth", className: "Paladin", artAsset: null }] }],
  encounters,
});

function home(identity: JoinIdentity, overrides: Partial<Parameters<typeof CampaignHome>[0]> = {}) {
  const props: Parameters<typeof CampaignHome>[0] = {
    identity, campaign: campaign(identity.id === "identity-kevin" ? "dm" : "player"), invitedIdentities: [], loading: false, openingCode: null, openingDestination: null, renamingCode: null, error: "", notice: "", creating: false, campaignMutationPending: false,
    onOpenEncounter: vi.fn(), onSetupEncounter: vi.fn(), onCreateEncounter: vi.fn(async () => true), onRenameEncounter: vi.fn(async () => true), onRenameCampaign: vi.fn(async () => true), onAddPlayer: vi.fn(async () => true), onBackToCampaigns: vi.fn(), onSignOut: vi.fn(), ...overrides,
  };
  render(<CampaignHome {...props} />); return props;
}

describe("CampaignHome", () => {
  it("gives a player a personal landing page with encounter entry and no creation controls", async () => {
    const props = home(player);
    expect(screen.getByRole("heading", { name: "Force of Nature" })).toBeTruthy();
    expect(screen.getByText("Dar'eleth")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Encounters" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /New encounter/ })).toBeNull();
    await userEvent.click(screen.getAllByRole("button", { name: /Enter encounter/ })[0]);
    expect(props.onOpenEncounter).toHaveBeenCalledWith("EMBER-KEEP");
  });

  it("lets the DM create a fresh encounter from campaign home", async () => {
    const onCreateEncounter = vi.fn(async () => true);
    home(dm, { onCreateEncounter });
    await userEvent.click(screen.getByRole("button", { name: /New encounter/ }));
    await userEvent.type(screen.getByLabelText("Encounter name"), "Ashes Below");
    await userEvent.click(screen.getByRole("button", { name: "Create encounter" }));
    expect(onCreateEncounter).toHaveBeenCalledWith({ name: "Ashes Below", mode: "party", sourceCode: "EMBER-KEEP" });
  });

  it("offers an existing encounter as the source for duplication", async () => {
    const onCreateEncounter = vi.fn(async () => true);
    home(dm, { onCreateEncounter });
    await userEvent.click(screen.getByRole("button", { name: /New encounter/ }));
    await userEvent.type(screen.getByLabelText("Encounter name"), "Ember Keep II");
    await userEvent.selectOptions(screen.getByLabelText("Starting point"), "duplicate");
    await userEvent.selectOptions(screen.getByLabelText("Encounter to duplicate"), "SUNLESS");
    await userEvent.click(screen.getByRole("button", { name: "Create encounter" }));
    expect(onCreateEncounter).toHaveBeenCalledWith({ name: "Ember Keep II", mode: "duplicate", sourceCode: "SUNLESS" });
  });

  it("lets the DM rename an encounter without opening the battle map", async () => {
    const onRenameEncounter = vi.fn(async () => true);
    home(dm, { onRenameEncounter });
    await userEvent.click(screen.getByRole("button", { name: "Rename Ember Keep" }));
    const input = screen.getByLabelText("Encounter name");
    await userEvent.clear(input);
    await userEvent.type(input, "Ember Keep Reforged");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(onRenameEncounter).toHaveBeenCalledWith("EMBER-KEEP", "Ember Keep Reforged");
  });

  it("gives the DM separate setup and live-map actions", async () => {
    const onSetupEncounter = vi.fn();
    const onOpenEncounter = vi.fn();
    home(dm, { onSetupEncounter, onOpenEncounter });

    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole("button", { name: "Set up" })[0]);
    expect(onSetupEncounter).toHaveBeenCalledWith("EMBER-KEEP");
    await userEvent.click(screen.getAllByRole("button", { name: "Battle map" })[0]);
    expect(onOpenEncounter).toHaveBeenCalledWith("EMBER-KEEP");
  });

  it("lets the DM add an invited player from campaign management", async () => {
    const onAddPlayer = vi.fn(async () => true);
    home(dm, { invitedIdentities: [dm, player], onAddPlayer });
    await userEvent.click(screen.getByRole("button", { name: "Manage campaign" }));
    await userEvent.selectOptions(screen.getByLabelText("Player"), "identity-dan");
    await userEvent.type(screen.getByLabelText("Character name"), "Dar'eleth");
    await userEvent.click(screen.getByRole("button", { name: "Add player" }));
    expect(onAddPlayer).toHaveBeenCalledWith({
      identityId: "identity-dan",
      character: { name: "Dar'eleth", className: "", maxHp: 10, armorClass: 10, speed: 30 },
    });
  });
});
