import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CampaignHome } from "@/app/campaign-home";
import type { JoinIdentity } from "@/app/join-screen";

const encounters = [
  { code: "EMBER-KEEP", name: "Ember Keep", status: "active" as const, updatedAt: 1_782_000_000_000 },
  { code: "SUNLESS", name: "The Sunless Hall", status: "setup" as const, updatedAt: 1_781_000_000_000 },
];
const player: JoinIdentity = { participantName: "Dan", label: "Dar'eleth · Paladin", role: "player" };
const dm: JoinIdentity = { participantName: "Kevin", label: "Dungeon Master", role: "dm" };

function home(identity: JoinIdentity, overrides: Partial<Parameters<typeof CampaignHome>[0]> = {}) {
  const props: Parameters<typeof CampaignHome>[0] = {
    identity, encounters, loading: false, openingCode: null, error: "", notice: "", creating: false,
    onOpenScenario: vi.fn(), onCreateScenario: vi.fn(async () => true), onSignOut: vi.fn(), ...overrides,
  };
  render(<CampaignHome {...props} />); return props;
}

describe("CampaignHome", () => {
  it("gives a player a personal landing page with scenario entry and no creation controls", async () => {
    const props = home(player);
    expect(screen.getByRole("heading", { name: "Welcome back, Dan." })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Scenarios" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create scenario" })).toBeNull();
    await userEvent.click(screen.getAllByRole("button", { name: /Enter scenario/ })[0]);
    expect(props.onOpenScenario).toHaveBeenCalledWith("EMBER-KEEP");
  });

  it("lets the DM create a fresh scenario from campaign home", async () => {
    const onCreateScenario = vi.fn(async () => true);
    home(dm, { onCreateScenario });
    await userEvent.click(screen.getByRole("button", { name: "Create scenario" }));
    await userEvent.type(screen.getByLabelText("Scenario name"), "Ashes Below");
    await userEvent.click(screen.getByRole("button", { name: "Create scenario" }));
    expect(onCreateScenario).toHaveBeenCalledWith({ name: "Ashes Below", mode: "party", sourceCode: "EMBER-KEEP" });
  });

  it("offers an existing scenario as the source for duplication", async () => {
    const onCreateScenario = vi.fn(async () => true);
    home(dm, { onCreateScenario });
    await userEvent.click(screen.getByRole("button", { name: "Create scenario" }));
    await userEvent.type(screen.getByLabelText("Scenario name"), "Ember Keep II");
    await userEvent.selectOptions(screen.getByLabelText("Starting point"), "duplicate");
    await userEvent.selectOptions(screen.getByLabelText("Scenario to duplicate"), "SUNLESS");
    await userEvent.click(screen.getByRole("button", { name: "Create scenario" }));
    expect(onCreateScenario).toHaveBeenCalledWith({ name: "Ember Keep II", mode: "duplicate", sourceCode: "SUNLESS" });
  });
});
