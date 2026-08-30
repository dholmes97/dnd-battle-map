import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CampaignHome } from "@/app/campaign-home";
import type { JoinIdentity } from "@/app/join-screen";
import type { CampaignAccessSummary } from "@/shared/campaigns";
import type { CombatActionProfile } from "@/shared/combat-rolling";

const encounters = [
  { code: "EMBER-KEEP", name: "Ember Keep", status: "active" as const, updatedAt: 1_782_000_000_000 },
  { code: "SUNLESS", name: "The Sunless Hall", status: "setup" as const, updatedAt: 1_781_000_000_000 },
];
const player: JoinIdentity = { id: "identity-dan", displayName: "Dan" };
const dm: JoinIdentity = { id: "identity-kevin", displayName: "Kevin" };
const campaign = (role: "player" | "dm"): CampaignAccessSummary => ({
  id: "campaign-force-of-nature", slug: "force-of-nature", name: "Force of Nature",
  membershipId: role === "dm" ? "membership-kevin" : "membership-dan", role,
  characters: role === "player" ? [{ id: "character-dareleth", name: "Dar'eleth", className: "Paladin", artAsset: "/assets/tokens/characters/dareleth-paladin-01.png" }] : [],
  members: role === "dm" ? [{ membershipId: "membership-kevin", identity: dm, role: "dm", characters: [] }] : [{ membershipId: "membership-dan", identity: player, role: "player", characters: [{ id: "character-dareleth", name: "Dar'eleth", className: "Paladin", artAsset: "/assets/tokens/characters/dareleth-paladin-01.png" }] }],
  encounters,
});

function home(identity: JoinIdentity, overrides: Partial<Parameters<typeof CampaignHome>[0]> = {}) {
  const props: Parameters<typeof CampaignHome>[0] = {
    identity, campaign: campaign(identity.id === "identity-kevin" ? "dm" : "player"), invitedIdentities: [], loading: false, openingCode: null, openingDestination: null, renamingCode: null, error: "", notice: "", creating: false, campaignMutationPending: false,
    onOpenEncounter: vi.fn(), onSetupEncounter: vi.fn(), onCreateEncounter: vi.fn(async () => true), onRenameEncounter: vi.fn(async () => true), onRenameCampaign: vi.fn(async () => true), onAddPlayer: vi.fn(async () => true), onSaveCombatAction: vi.fn(async () => true), onDeleteCombatAction: vi.fn(async () => true), onBackToCampaigns: vi.fn(), onSignOut: vi.fn(), ...overrides,
  };
  render(<CampaignHome {...props} />); return props;
}

describe("CampaignHome", () => {
  it("gives a player a personal landing page with encounter entry and no creation controls", async () => {
    const props = home(player);
    expect(screen.getByRole("heading", { name: "Force of Nature" })).toBeTruthy();
    expect(screen.getByText("Dar'eleth")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Dar'eleth portrait" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Combat actions" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Encounters" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage actions" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "+ Action" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Encounters" }).closest("section")?.nextElementSibling)
      .toBe(screen.getByRole("heading", { name: "Combat actions" }).closest("section"));
    expect(screen.queryByRole("button", { name: /New encounter/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Enter encounter/ }));
    expect(props.onOpenEncounter).toHaveBeenCalledWith("EMBER-KEEP");
  });

  it("uses plain language for attack effects that need a table ruling", async () => {
    home(player);
    await userEvent.click(screen.getByRole("button", { name: "Manage actions" }));
    await userEvent.click(screen.getByRole("button", { name: "+ Action" }));
    expect(screen.getByRole("checkbox", { name: "Has additional effect" })).toBeTruthy();
    expect(screen.queryByText(/manual rider/i)).toBeNull();
  });

  it("opens a compact named editor directly beneath the selected combat action", async () => {
    const moonbow: CombatActionProfile = {
      id: "action-moonbow", ownerType: "character", ownerId: "character-dareleth",
      applicableTokenIds: [], source: "character", enabled: true, sortOrder: 10,
      name: "Glimmering Moonbow, Shortbow", attackBonus: 10, attackKind: "ranged",
      damage: { count: 1, sides: 6, modifier: 6 }, damageType: "piercing",
      reachFeet: null, rangeFeet: 80, manualRider: true,
      manualRiderText: "The target glimmers until the next turn.", alternateDamage: null,
    };
    const playerCampaign = campaign("player");
    home(player, { campaign: { ...playerCampaign, characters: [{ ...playerCampaign.characters[0], combatActions: [moonbow] }] } });

    expect(screen.getByText("1 action for Dar'eleth")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Manage actions" }));
    const row = screen.getByText(moonbow.name).closest("article");
    await userEvent.click(screen.getByRole("button", { name: `Edit ${moonbow.name}` }));
    const editor = screen.getByRole("form", { name: `Editing ${moonbow.name}` });

    expect(row?.classList.contains("is-editing")).toBe(true);
    expect(row?.nextElementSibling).toBe(editor);
    expect(screen.getByRole("button", { name: `Editing ${moonbow.name}` })).toHaveProperty("disabled", true);
  });

  it("requires confirmation before deleting a combat action", async () => {
    const longsword: CombatActionProfile = {
      id: "action-longsword", ownerType: "character", ownerId: "character-dareleth",
      applicableTokenIds: [], source: "character", enabled: true, sortOrder: 10,
      name: "Longsword +1", attackBonus: 9, attackKind: "melee",
      damage: { count: 1, sides: 8, modifier: 5 }, damageType: "slashing",
      reachFeet: 5, rangeFeet: null, manualRider: false, manualRiderText: null, alternateDamage: null,
    };
    const playerCampaign = campaign("player");
    const onDeleteCombatAction = vi.fn(async () => true);
    home(player, {
      campaign: { ...playerCampaign, characters: [{ ...playerCampaign.characters[0], combatActions: [longsword] }] },
      onDeleteCombatAction,
    });

    await userEvent.click(screen.getByRole("button", { name: "Manage actions" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Longsword +1" }));
    expect(onDeleteCombatAction).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Delete Longsword +1?" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep action" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep action" }));
    expect(onDeleteCombatAction).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Delete Longsword +1" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete action" }));
    expect(onDeleteCombatAction).toHaveBeenCalledOnce();
    expect(onDeleteCombatAction).toHaveBeenCalledWith("action-longsword");
  });

  it("defaults to the most recently updated encounter and switches the nearby actions", async () => {
    const onOpenEncounter = vi.fn();
    home(player, { campaign: { ...campaign("player"), encounters: [...encounters].reverse() }, onOpenEncounter });

    const selector = screen.getByRole("combobox", { name: "Selected encounter" });
    expect(selector).toHaveProperty("value", "EMBER-KEEP");
    await userEvent.selectOptions(selector, "SUNLESS");
    await userEvent.click(screen.getByRole("button", { name: /Enter encounter/ }));
    expect(onOpenEncounter).toHaveBeenCalledWith("SUNLESS");
  });

  it("lets the DM create a fresh encounter from campaign home", async () => {
    const onCreateEncounter = vi.fn(async () => true);
    home(dm, { onCreateEncounter });
    expect(screen.getByRole("img", { name: "Kevin, Dungeon Master portrait" })).toBeTruthy();
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

    expect(screen.getByText("In combat")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(onSetupEncounter).toHaveBeenCalledWith("EMBER-KEEP");
    await userEvent.click(screen.getByRole("button", { name: "Battle map" }));
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
