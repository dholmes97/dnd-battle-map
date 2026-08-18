import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EncounterSidebar } from "@/app/encounter-sidebar";
import type { TokenControls } from "@/app/use-token-controls";
import type { EncounterState, ParticipantSession, SharedToken } from "@/shared/contracts";

const participant: ParticipantSession = { id: "player-dan", name: "Dan", role: "player", sessionSecret: "session-secret" };

function tokenWithInitiative(initiative: number | null): SharedToken {
  return {
    id: "token-dar",
    name: "Dar'eleth",
    artAsset: null,
    kind: "character",
    size: "medium",
    speed: 30,
    armorClass: 18,
    hp: 42,
    maxHp: 42,
    healthState: "unharmed",
    hidden: false,
    summonerTokenId: null,
    initiative,
    initiativeGroupId: null,
    initiativeOrder: initiative === null ? null : 0,
    turnComplete: false,
    movementUsed: 0,
    movementOrigin: null,
    effects: [],
    controller: { name: "Dan" },
    controlledByViewer: true,
    x: 4,
    y: 4,
  };
}

function tokenControls() {
  return {
    initiativeDrafts: {}, setInitiativeDrafts: vi.fn(), initiativeStatuses: {}, setInitiativeStatuses: vi.fn(),
    tokenDrafts: {}, setTokenDrafts: vi.fn(), hpAmount: "5", setHpAmount: vi.fn(),
    effectName: "", setEffectName: vi.fn(), effectType: "condition", setEffectType: vi.fn(), effectDuration: "1", setEffectDuration: vi.fn(),
    effectReminder: "end", setEffectReminder: vi.fn(), effectEditorTokenId: null, setEffectEditorTokenId: vi.fn(),
    tokenEditorTokenId: null, setTokenEditorTokenId: vi.fn(), pendingDeleteTokenId: null, setPendingDeleteTokenId: vi.fn(),
    concentrationReminder: null, dismissConcentrationReminder: vi.fn(), saveInitiative: vi.fn(), splitInitiativePack: vi.fn(),
    saveInitiativeGroup: vi.fn(), addEffectToToken: vi.fn(), applyHpToToken: vi.fn(), removeEffectFromToken: vi.fn(),
    discardTokenDetails: vi.fn(), saveTokenDetails: vi.fn(), resizeSpellEffect: vi.fn(),
  } as unknown as TokenControls;
}

function renderSidebar(initiative: number | null, controlledByViewer = true) {
  const token = { ...tokenWithInitiative(initiative), controlledByViewer };
  const state = {
    encounter: { code: "TEST", name: "Test", dmBriefing: null, version: 1, status: "setup", mapPackage: null, activeMapPresetId: null, currentRound: 0, activeInitiativeOrder: null, strictMovement: false, fogVisibility: { mode: "off", polygons: [] }, updatedAt: 1 },
    grid: { width: 24, height: 16, feetPerCell: 5 }, viewer: { id: participant.id, role: participant.role }, undo: { available: 0, redoAvailable: 0, lastAction: null, nextRedoAction: null },
    tokens: [token], annotations: [], chatMessages: [], handouts: [], savedMapPresets: [], availableArt: [],
  } as EncounterState;
  const controls = tokenControls();
  const onSelectToken = vi.fn();
  const props: Parameters<typeof EncounterSidebar>[0] = {
    participant, state, hidden: false, inCombat: false, rosterFilter: "", rosterRows: [{ type: "token", token, grouped: false }], selectedToken: token, selectedSpell: null, selectedMapNote: null,
    preview: null, distance: 0, remainingMovement: 30, overMovement: false, activeOwnTurnToken: null, activeOwnTurnIsGroup: false, initiativeTokens: [], encounterAction: null, controls,
    onRosterFilterChange: vi.fn(), onToggleGroup: vi.fn(), onSelectToken, onCloseMapNote: vi.fn(), onResizeSpell: vi.fn(), onDeleteToken: vi.fn(), canMoveToken: () => true,
    onHideToken: vi.fn(), onEndTurn: vi.fn(), onStartOrRestart: vi.fn(), onAdvanceTurn: vi.fn(), onPauseOrResume: vi.fn(), onRequestReset: vi.fn(), onCorrectTurn: vi.fn(),
  };
  render(<EncounterSidebar {...props} />);
  return { controls, onSelectToken, token };
}

describe("EncounterSidebar initiative disclosure", () => {
  it("shows the selected owned token's AC in the compact stat row", () => {
    renderSidebar(17);
    const detail = screen.getByRole("region", { name: "Dar'eleth details" });
    expect(within(detail).getByText("AC")).toBeTruthy();
    expect(within(detail).getByText("18")).toBeTruthy();
  });

  it("lets a player open details for their own token only", async () => {
    const owned = renderSidebar(17);
    await userEvent.click(screen.getByRole("button", { name: "Edit details" }));
    expect(owned.controls.setTokenEditorTokenId).toHaveBeenCalledWith(owned.token.id);

    cleanup();
    renderSidebar(17, false);
    expect(screen.queryByRole("button", { name: "Edit details" })).toBeNull();
  });

  it("uses one typed HP amount with compact damage and healing actions", async () => {
    const { controls } = renderSidebar(17);
    expect(screen.queryByRole("button", { name: "Decrease amount" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Increase amount" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Apply 5 damage to Dar'eleth" }));
    expect(controls.applyHpToToken).toHaveBeenCalledWith(expect.objectContaining({ id: "token-dar" }), -5);
    await userEvent.click(screen.getByRole("button", { name: "Heal Dar'eleth for 5" }));
    expect(controls.applyHpToToken).toHaveBeenCalledWith(expect.objectContaining({ id: "token-dar" }), 5);
  });

  it("selects the complete HP amount whenever the field is entered", async () => {
    renderSidebar(17);
    const amount = screen.getByRole("textbox", { name: "HP change amount" }) as HTMLInputElement;
    await userEvent.click(amount);
    expect(amount.selectionStart).toBe(0);
    expect(amount.selectionEnd).toBe(amount.value.length);
  });

  it("keeps a missing initiative editable only from the roster", async () => {
    renderSidebar(null);
    expect(screen.queryByRole("textbox", { name: "Initiative" })).toBeNull();
    expect(screen.getByRole("button", { name: "Enter initiative for Dar'eleth" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Enter initiative for Dar'eleth" }));
    expect(screen.getByRole("textbox", { name: "Initiative for Dar'eleth" })).toBeTruthy();
  });

  it("edits and saves initiative directly in the roster", async () => {
    const { controls, onSelectToken, token } = renderSidebar(17);
    expect(screen.queryByRole("textbox", { name: "Initiative" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Edit initiative for Dar'eleth, currently 17" }));
    const editor = screen.getByRole("textbox", { name: "Initiative for Dar'eleth" }) as HTMLInputElement;
    expect(editor.value).toBe("17");
    expect(onSelectToken).not.toHaveBeenCalled();

    fireEvent.blur(editor);
    expect(controls.saveInitiative).toHaveBeenCalledWith(token);
    expect(screen.queryByRole("textbox", { name: "Initiative for Dar'eleth" })).toBeNull();
  });

  it("does not repeat a grouped initiative beneath the roster row", async () => {
    const first = { ...tokenWithInitiative(6), id: "bat-1", name: "Cave Bat" };
    const second = { ...tokenWithInitiative(6), id: "bat-2", name: "Cave Bat" };
    const state = {
      encounter: { code: "TEST", name: "Test", dmBriefing: null, version: 1, status: "setup", mapPackage: null, activeMapPresetId: null, currentRound: 0, activeInitiativeOrder: null, strictMovement: false, fogVisibility: { mode: "off", polygons: [] }, updatedAt: 1 },
      grid: { width: 24, height: 16, feetPerCell: 5 }, viewer: { id: "dm-kevin", role: "dm" }, undo: { available: 0, redoAvailable: 0, lastAction: null, nextRedoAction: null },
      tokens: [first, second], annotations: [], chatMessages: [], handouts: [], savedMapPresets: [], availableArt: [],
    } as EncounterState;
    const props: Parameters<typeof EncounterSidebar>[0] = {
      participant: { id: "dm-kevin", name: "Kevin", role: "dm", sessionSecret: "session-secret" }, state, hidden: false, inCombat: false, rosterFilter: "", rosterRows: [{ type: "group", key: "cave-bat", label: "Cave Bat", tokens: [first, second], expanded: false }], selectedToken: null, selectedSpell: null, selectedMapNote: null,
      preview: null, distance: 0, remainingMovement: 30, overMovement: false, activeOwnTurnToken: null, activeOwnTurnIsGroup: false, initiativeTokens: [], encounterAction: null, controls: tokenControls(),
      onRosterFilterChange: vi.fn(), onToggleGroup: vi.fn(), onSelectToken: vi.fn(), onCloseMapNote: vi.fn(), onResizeSpell: vi.fn(), onDeleteToken: vi.fn(), canMoveToken: () => true,
      onHideToken: vi.fn(), onEndTurn: vi.fn(), onStartOrRestart: vi.fn(), onAdvanceTurn: vi.fn(), onPauseOrResume: vi.fn(), onRequestReset: vi.fn(), onCorrectTurn: vi.fn(),
    };

    render(<EncounterSidebar {...props} />);

    await userEvent.click(screen.getByRole("button", { name: "Edit initiative for Cave Bat group, currently 6" }));
    const editor = screen.getByRole("textbox", { name: "Initiative for Cave Bat group" }) as HTMLInputElement;
    expect(editor.value).toBe("6");
    fireEvent.blur(editor);
    expect(props.controls.saveInitiativeGroup).toHaveBeenCalledWith("cave-bat", [first, second]);
    expect(screen.queryByRole("textbox", { name: "Initiative for all Cave Bat creatures" })).toBeNull();
  });
});
