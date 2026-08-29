import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  CombatRollPanel,
  calculateCombatPanelPosition,
  type CombatRollResponse,
} from "@/app/combat-roll-panel";
import type { CombatActionProfile } from "@/shared/combat-rolling";
import type { CommandPayload, EncounterState, ParticipantSession, SharedToken } from "@/shared/contracts";

function token(id: string, overrides: Partial<SharedToken> = {}): SharedToken {
  return {
    id, name: id, artAsset: null, kind: "character", size: "medium", speed: 30,
    flySpeed: null, swimSpeed: null, climbSpeed: null, burrowSpeed: null,
    armorClass: 16, hp: 20, maxHp: 20, temporaryHp: 0, healthState: "unharmed",
    hidden: false, summonerTokenId: null, initiative: 10, initiativeGroupId: null,
    initiativeOrder: 0, turnComplete: false, altitude: 0, movementUsed: 0,
    movementOrigin: null, effects: [], controller: { name: "Player" },
    controlledByViewer: true, x: 2, y: 2, ...overrides,
  };
}

const action: CombatActionProfile = {
  id: "longsword", ownerType: "character", ownerId: "character", applicableTokenIds: ["attacker"],
  source: "character", enabled: true, sortOrder: 0, name: "Longsword", attackBonus: 7,
  attackKind: "melee", damage: { count: 1, sides: 8, modifier: 4 }, damageType: "slashing",
  reachFeet: 5, rangeFeet: null, manualRider: true, manualRiderText: "The target must save or fall prone.",
  alternateDamage: { label: "Two-handed", formula: { count: 1, sides: 10, modifier: 4 } },
};

function state(actions: CombatActionProfile[] = [action]): EncounterState {
  return {
    encounter: { code: "TEST", name: "Test", dmBriefing: null, version: 1, status: "active", mapPackage: null, mapDraft: null, draftUpdatedAt: null, currentRound: 1, activeInitiativeOrder: 0, strictMovement: false, fogVisibility: { mode: "off", polygons: [] }, updatedAt: 1 },
    grid: { width: 20, height: 20, feetPerCell: 5 }, viewer: { id: "participant", role: "player" },
    combatActions: actions, combatRolls: [], damageProposals: [],
    undo: { available: 0, redoAvailable: 0, lastAction: null, nextRedoAction: null },
    tokens: [], annotations: [], chatMessages: [], handouts: [], mapImages: [], availableArt: [],
  };
}

const player: ParticipantSession = { id: "participant", name: "Player", role: "player", sessionSecret: "secret" };
const dm: ParticipantSession = { id: "dm", name: "DM", role: "dm", sessionSecret: "secret" };
const attacker = token("attacker", { name: "Blessed Hero", effects: [{ id: "bless", name: " Bless ", type: "concentration", durationRounds: 10, expiresRound: 11, reminderTiming: "end", due: false }] });
const target = token("target", { name: "Goblin", controlledByViewer: false });

function result(): CombatRollResponse {
  return {
    state: state(), rollId: "roll", proposalId: null,
    result: { attackDice: [16, 4], keptD20: 16, blessDie: 3, attackTotal: 26, outcome: "hit", damageDice: [], damageTotal: null },
  };
}

describe("CombatRollPanel", () => {
  it("cannot submit from the target click that mounted the chooser", () => {
    let armSubmit: FrameRequestCallback | null = null;
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      armSubmit = callback;
      return 17;
    });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const onRoll = vi.fn();
    const view = render(<CombatRollPanel participant={player} state={state()} attacker={attacker} target={target} anchor={{ x: 10, y: 10 }} onClose={vi.fn()} onRoll={onRoll} onComplete={vi.fn()} />);
    const submit = screen.getByRole("button", { name: "Roll attack" }) as HTMLButtonElement;

    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onRoll).not.toHaveBeenCalled();
    act(() => armSubmit?.(1));
    expect(submit.disabled).toBe(false);

    view.unmount();
    expect(cancelFrame).toHaveBeenCalledWith(17);
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it("places low-map attacks above the target and keeps the panel inside the map", () => {
    expect(calculateCombatPanelPosition({
      anchor: { x: 490, y: 430 },
      containerWidth: 500,
      containerHeight: 600,
      panelWidth: 300,
      panelHeight: 280,
    })).toEqual({ left: 192, top: 140, maxHeight: 584, placement: "above" });
  });

  it("places upper-map attacks below the target and constrains oversized panels", () => {
    expect(calculateCombatPanelPosition({
      anchor: { x: 160, y: 100 },
      containerWidth: 500,
      containerHeight: 600,
      panelWidth: 300,
      panelHeight: 280,
    })).toEqual({ left: 10, top: 110, maxHeight: 584, placement: "below" });
    expect(calculateCombatPanelPosition({
      anchor: { x: 250, y: 300 },
      containerWidth: 500,
      containerHeight: 400,
      panelWidth: 300,
      panelHeight: 900,
    })).toEqual({ left: 100, top: 8, maxHeight: 384, placement: "above" });
  });

  it("keeps the attack controls inside the browser viewport when the map extends below it", () => {
    expect(calculateCombatPanelPosition({
      anchor: { x: 250, y: 500 },
      containerWidth: 500,
      containerHeight: 900,
      panelWidth: 300,
      panelHeight: 250,
      visibleTop: 0,
      visibleBottom: 600,
    })).toEqual({ left: 100, top: 240, maxHeight: 584, placement: "above" });
  });

  it("shows automatic Bless and plain-language additional-effect guidance", () => {
    render(<CombatRollPanel participant={player} state={state()} attacker={attacker} target={target} anchor={{ x: 10, y: 10 }} onClose={vi.fn()} onRoll={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByText("Bless +1d4 automatic")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /Bless/i })).toBeNull();
    expect(screen.getByText("Additional effect:")).toBeTruthy();
    expect(screen.queryByText(/manual rider/i)).toBeNull();
    expect(screen.getByText(/The target must save or fall prone/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Action" }));
  });

  it("presents roll mode as visible native radio selectors", () => {
    render(<CombatRollPanel participant={player} state={state()} attacker={attacker} target={target} anchor={{ x: 10, y: 10 }} onClose={vi.fn()} onRoll={vi.fn()} onComplete={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: "Roll mode" });
    const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios).toHaveLength(3);
    expect(radios.every((radio) => !radio.classList.contains("visually-hidden"))).toBe(true);
    expect((screen.getByRole("radio", { name: "normal" }) as HTMLInputElement).checked).toBe(true);
  });

  it("submits roll options and hands the authoritative result to the modal owner", async () => {
    const onRoll = vi.fn(async (payload: CommandPayload<"roll-attack">) => { void payload; return result(); });
    const onComplete = vi.fn();
    render(<CombatRollPanel participant={player} state={state()} attacker={attacker} target={target} anchor={{ x: 10, y: 10 }} onClose={vi.fn()} onRoll={onRoll} onComplete={onComplete} />);
    await userEvent.click(screen.getByRole("radio", { name: "advantage" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Use Two-handed/ }));
    await userEvent.click(screen.getByRole("button", { name: "Roll attack" }));
    await waitFor(() => expect(onRoll).toHaveBeenCalledTimes(1));
    expect(onRoll.mock.calls[0][0]).toMatchObject({ rollMode: "advantage", alternateDamage: true, actionProfileId: "longsword" });
    expect(onComplete).toHaveBeenCalledWith(result());
    expect(screen.queryByText("d20 16, 4 + Bless 3 = 26")).toBeNull();
  });

  it("offers the structured unsaved fallback only to the DM when no profile exists", async () => {
    const onRoll = vi.fn(async (payload: CommandPayload<"roll-attack">) => { void payload; return result(); });
    const { unmount } = render(<CombatRollPanel participant={player} state={state([])} attacker={attacker} target={target} anchor={{ x: 10, y: 10 }} onClose={vi.fn()} onRoll={onRoll} onComplete={vi.fn()} />);
    expect(screen.getByText("This attacker has no maintained combat actions.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Unsaved generic Attack" })).toBeNull();
    expect((screen.getByRole("button", { name: "Roll attack" }) as HTMLButtonElement).disabled).toBe(true);
    unmount();

    render(<CombatRollPanel participant={dm} state={state([])} attacker={attacker} target={target} anchor={{ x: 10, y: 10 }} onClose={vi.fn()} onRoll={onRoll} onComplete={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Unsaved generic Attack" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Attack bonus"), { target: { value: "5" } });
    await userEvent.click(screen.getByRole("button", { name: "Roll attack" }));
    await waitFor(() => expect(onRoll).toHaveBeenCalledTimes(1));
    expect(onRoll.mock.calls[0][0]).toMatchObject({ actionProfileId: undefined, adHocAction: { attackBonus: 5 } });
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<CombatRollPanel participant={player} state={state()} attacker={attacker} target={target} anchor={{ x: 10, y: 10 }} onClose={onClose} onRoll={vi.fn()} onComplete={vi.fn()} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
