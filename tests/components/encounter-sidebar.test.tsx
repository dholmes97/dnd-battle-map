import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EncounterSidebar } from "@/app/encounter-sidebar";
import type { TokenControls } from "@/app/use-token-controls";
import type { EncounterState, ParticipantSession, SharedToken } from "@/shared/contracts";
import { spellEffectById, type SpellEffectDefinition } from "@/shared/spell-effects";

const participant: ParticipantSession = { id: "player-dan", name: "Dan", role: "player", sessionSecret: "session-secret" };

function tokenWithInitiative(initiative: number | null): SharedToken {
  return {
    id: "token-dar",
    name: "Dar'eleth",
    artAsset: null,
    kind: "character",
    size: "medium",
    speed: 30,
    flySpeed: null,
    swimSpeed: null,
    climbSpeed: null,
    burrowSpeed: null,
    armorClass: 18,
    hp: 42,
    maxHp: 42,
    temporaryHp: 0,
    healthState: "unharmed",
    hidden: false,
    summonerTokenId: null,
    initiative,
    initiativeGroupId: null,
    initiativeOrder: initiative === null ? null : 0,
    turnComplete: false,
    altitude: 0,
    movementUsed: 0,
    movementOrigin: null,
    effects: [],
    controller: { name: "Dan" },
    controlledByViewer: true,
    x: 4,
    y: 4,
  };
}

function tokenControls(hpAmount = "5") {
  return {
    initiativeDrafts: {}, setInitiativeDrafts: vi.fn(), initiativeStatuses: {}, setInitiativeStatuses: vi.fn(),
    tokenDrafts: {}, setTokenDrafts: vi.fn(), altitudeDrafts: {}, setAltitudeDrafts: vi.fn(), hpAmount, setHpAmount: vi.fn(), temporaryHpDrafts: {}, setTemporaryHpDrafts: vi.fn(), saveTemporaryHp: vi.fn(),
    effectName: "", setEffectName: vi.fn(), effectType: "condition", setEffectType: vi.fn(), effectDuration: "1", setEffectDuration: vi.fn(),
    effectReminder: "end", setEffectReminder: vi.fn(), effectEditorTokenId: null, setEffectEditorTokenId: vi.fn(),
    tokenEditorTokenId: null, setTokenEditorTokenId: vi.fn(), pendingDeleteTokenId: null, setPendingDeleteTokenId: vi.fn(),
    concentrationReminder: null, dismissConcentrationReminder: vi.fn(), requireConcentrationCheck: vi.fn(), saveInitiative: vi.fn(), splitInitiativePack: vi.fn(),
    saveInitiativeGroup: vi.fn(), addEffectToToken: vi.fn(), applyHpToToken: vi.fn(), removeEffectFromToken: vi.fn(),
    discardTokenDetails: vi.fn(), saveTokenDetails: vi.fn(), resizeSpellEffect: vi.fn(), saveAltitude: vi.fn(),
  } as unknown as TokenControls;
}

function renderSidebar(initiative: number | null, controlledByViewer = true, selectedOverride: SharedToken | null = null, selectedSpell: SpellEffectDefinition | null = null, hpAmount = "5") {
  const token = { ...tokenWithInitiative(initiative), controlledByViewer };
  const selectedToken = selectedOverride ?? token;
  const state = {
    encounter: { code: "TEST", name: "Test", dmBriefing: null, version: 1, status: "setup", mapPackage: null, mapDraft: null, draftUpdatedAt: null, currentRound: 0, activeInitiativeOrder: null, strictMovement: false, fogVisibility: { mode: "off", polygons: [] }, updatedAt: 1 },
    grid: { width: 24, height: 16, feetPerCell: 5 }, viewer: { id: participant.id, role: participant.role }, features: { combatRolling: { mode: "off", enabled: false, draining: false } }, combatActions: [], combatRolls: [], damageProposals: [], undo: { available: 0, redoAvailable: 0, lastAction: null, nextRedoAction: null },
    tokens: selectedToken.id === token.id ? [token] : [token, selectedToken], annotations: [], chatMessages: [], handouts: [], mapImages: [], availableArt: [],
  } as EncounterState;
  const controls = tokenControls(hpAmount);
  const onSelectToken = vi.fn();
  const props: Parameters<typeof EncounterSidebar>[0] = {
    participant, state, hidden: false, inCombat: false, rosterRows: [{ type: "token", token, grouped: false }], selectedToken, selectedSpell, selectedMapNote: null,
    activeOwnTurnToken: null, activeOwnTurnIsGroup: false, initiativeTokens: [], encounterAction: null, controls,
    onToggleGroup: vi.fn(), onSelectToken, onBeginAttack: vi.fn(), onCloseMapNote: vi.fn(), onResizeSpell: vi.fn(), onDeleteToken: vi.fn(), canMoveToken: () => true,
    onHideToken: vi.fn(), onEndTurn: vi.fn(), onStartOrRestart: vi.fn(), onAdvanceTurn: vi.fn(), onPauseOrResume: vi.fn(), onRequestReset: vi.fn(), onCorrectTurn: vi.fn(),
  };
  render(<EncounterSidebar {...props} />);
  return { controls, onSelectToken, token };
}

function dmSidebarProps(tokens: SharedToken[], selectedToken: SharedToken | null = tokens[0] ?? null): Parameters<typeof EncounterSidebar>[0] {
  const dm: ParticipantSession = { id: "dm-kevin", name: "Kevin", role: "dm", sessionSecret: "session-secret" };
  const state = {
    encounter: { code: "TEST", name: "Test", dmBriefing: null, version: 1, status: "active", mapPackage: null, mapDraft: null, draftUpdatedAt: null, currentRound: 1, activeInitiativeOrder: 0, strictMovement: false, fogVisibility: { mode: "off", polygons: [] }, updatedAt: 1 },
    grid: { width: 24, height: 16, feetPerCell: 5 }, viewer: { id: dm.id, role: dm.role }, features: { combatRolling: { mode: "off", enabled: false, draining: false } }, combatActions: [], combatRolls: [], damageProposals: [], undo: { available: 0, redoAvailable: 0, lastAction: null, nextRedoAction: null },
    tokens, annotations: [], chatMessages: [], handouts: [], mapImages: [], availableArt: [],
  } as EncounterState;
  return {
    participant: dm, state, hidden: false, inCombat: true, rosterRows: tokens.map((token) => ({ type: "token" as const, token, grouped: false })), selectedToken, selectedSpell: null, selectedMapNote: null,
    activeOwnTurnToken: null, activeOwnTurnIsGroup: false, initiativeTokens: tokens, encounterAction: null, controls: tokenControls(),
    onToggleGroup: vi.fn(), onSelectToken: vi.fn(), onBeginAttack: vi.fn(), onCloseMapNote: vi.fn(), onResizeSpell: vi.fn(), onDeleteToken: vi.fn(), canMoveToken: () => true,
    onHideToken: vi.fn(), onEndTurn: vi.fn(), onStartOrRestart: vi.fn(), onAdvanceTurn: vi.fn(), onPauseOrResume: vi.fn(), onRequestReset: vi.fn(), onCorrectTurn: vi.fn(),
  };
}

describe("EncounterSidebar initiative disclosure", () => {
  it("shows the selected owned token's AC in the compact stat row", () => {
    renderSidebar(17);
    const detail = screen.getByRole("region", { name: "Dar'eleth details" });
    expect(within(detail).getByText("AC")).toBeTruthy();
    expect(within(detail).getByText("18")).toBeTruthy();
    expect(within(detail).queryByText("Size")).toBeNull();
    expect(within(detail).getByText("character: Dan")).toBeTruthy();
    expect(within(detail).queryByText(/controlled by/i)).toBeNull();
  });

  it("offers an inline altitude editor on a controlled token card", () => {
    const { controls } = renderSidebar(17);
    const input = screen.getByRole("textbox", { name: "Dar'eleth altitude" });
    expect((input as HTMLInputElement).value).toBe("0");
    fireEvent.change(input, { target: { value: "20" } });
    expect(controls.setAltitudeDrafts).toHaveBeenCalled();
    fireEvent.blur(input);
    expect(controls.saveAltitude).toHaveBeenCalled();
  });

  it("keeps temporary HP available while combat rolling is off", () => {
    renderSidebar(17);
    const input = screen.getByRole("textbox", { name: "Dar'eleth temporary HP" });
    expect(input.closest(".token-meta")).toBeTruthy();
    expect(input.closest(".hp-row")).toBeNull();
    expect(input.closest("label")?.textContent).toContain("Temp HP");
    expect(screen.queryByRole("button", { name: "Attack…" })).toBeNull();
  });

  it("keeps the add-effect action on the same wrapping line as existing effects", () => {
    const blessed = {
      ...tokenWithInitiative(17), id: "blessed", name: "Blessed Hero",
      effects: [{ id: "effect-1", name: "Bless", type: "concentration", durationRounds: 10, expiresRound: 11, reminderTiming: "end", due: false }],
    };
    renderSidebar(17, true, blessed);
    const detail = screen.getByRole("region", { name: "Blessed Hero details" });
    const effect = within(detail).getByText(/Bless · R11/);
    const addEffect = within(detail).getByRole("button", { name: "+ Effect" });

    expect(effect.closest(".effect-list")?.contains(addEffect)).toBe(true);
  });

  it("keeps secondary movement speeds in a restrained speed tooltip", () => {
    const flyer = { ...tokenWithInitiative(17), id: "dragon", name: "Dragon", flySpeed: 60, swimSpeed: 30 };
    renderSidebar(17, true, flyer);
    const detail = screen.getByRole("region", { name: "Dragon details" });
    const speed = within(detail).getByText("30 ft");
    expect(speed.getAttribute("title")).toBe("Fly 60 ft · Swim 30 ft");
    expect(speed.getAttribute("aria-label")).toBe("Walk 30 ft. Fly 60 ft. Swim 30 ft.");
  });

  it("defaults the player's character lock below a selection and lets the player replace it", async () => {
    const wolf = {
      ...tokenWithInitiative(12), id: "wolf", name: "Wolf", kind: "monster",
      controller: { name: "Kevin" }, controlledByViewer: false,
    };
    renderSidebar(17, true, wolf);

    const stack = screen.getByRole("group", { name: "Locked card and selection" });
    const cards = within(stack).getAllByRole("region");
    expect(cards).toHaveLength(2);
    expect(cards[0].getAttribute("aria-label")).toBe("Wolf details");
    expect(cards[1].getAttribute("aria-label")).toBe("Dar'eleth details");
    expect(stack.lastElementChild?.contains(cards[1])).toBe(true);
    expect(within(stack).getByRole("button", { name: "Unlock Dar'eleth card" })).toBeTruthy();

    await userEvent.click(within(stack).getByRole("button", { name: "Lock Wolf card" }));
    expect(screen.queryByRole("region", { name: "Dar'eleth details" })).toBeNull();
    expect(screen.getByRole("button", { name: "Unlock Wolf card" })).toBeTruthy();
  });

  it("layers a selected spell card above the persistent character card", () => {
    const moonbeam = spellEffectById("moonbeam")!;
    const spell = {
      ...tokenWithInitiative(17), id: "spell", name: "Moonbeam", kind: "spell-effect",
      artAsset: moonbeam.artAsset, hp: null, maxHp: null, healthState: null,
    };
    renderSidebar(17, true, spell, moonbeam);

    const stack = screen.getByRole("group", { name: "Locked card and selection" });
    const cards = within(stack).getAllByRole("region");
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "Moonbeam spell effect details",
      "Dar'eleth details",
    ]);
  });

  it("lets the DM lock one card at the bottom while later selections stack above it", async () => {
    const villain = { ...tokenWithInitiative(18), id: "villain", name: "Strahd", kind: "monster" as const, controller: { name: "Kevin" }, controlledByViewer: true };
    const wolf = { ...tokenWithInitiative(12), id: "wolf", name: "Dire Wolf", kind: "monster" as const, controller: { name: "Kevin" }, controlledByViewer: true };
    const props = dmSidebarProps([villain, wolf], villain);
    const view = render(<EncounterSidebar {...props} />);

    await userEvent.click(screen.getByRole("button", { name: "Lock Strahd card" }));
    expect(screen.getByRole("button", { name: "Unlock Strahd card" }).getAttribute("aria-pressed")).toBe("true");

    view.rerender(<EncounterSidebar {...dmSidebarProps([villain, wolf], wolf)} />);
    const stack = screen.getByRole("group", { name: "Locked card and selection" });
    expect(within(stack).getAllByRole("region").map((card) => card.getAttribute("aria-label"))).toEqual([
      "Dire Wolf details",
      "Strahd details",
    ]);

    await userEvent.click(within(stack).getByRole("button", { name: "Lock Dire Wolf card" }));
    expect(screen.queryByRole("region", { name: "Strahd details" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Unlock Dire Wolf card" }));
    expect(screen.queryByRole("group", { name: "Locked card and selection" })).toBeNull();
    expect(screen.getByRole("region", { name: "Dire Wolf details" })).toBeTruthy();
  });

  it("replaces token filtering with the four DM combat actions above the roster", () => {
    render(<EncounterSidebar {...dmSidebarProps([tokenWithInitiative(17)])} />);
    const controls = screen.getByRole("group", { name: "Combat controls" });
    const roster = screen.getByRole("list", { name: "Turn order" });
    expect(screen.queryByRole("searchbox", { name: "Filter tokens" })).toBeNull();
    expect(controls.compareDocumentPosition(roster) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(controls).getAllByRole("button")).toHaveLength(4);
    expect(within(controls).getByRole("button", { name: "Restart combat" }).getAttribute("data-tooltip")).toContain("round 1");
    expect(within(controls).getByRole("button", { name: "Advance turn" }).getAttribute("data-tooltip")).toContain("next turn");
    expect(within(controls).getByRole("button", { name: "Pause combat" }).getAttribute("data-tooltip")).toContain("preserving");
    expect(within(controls).getByRole("button", { name: "Reset combat" }).getAttribute("data-tooltip")).toContain("return to setup");
  });

  it("does not show transient destination or distance details in token cards", () => {
    renderSidebar(17);
    expect(screen.queryByText("Destination")).toBeNull();
    expect(screen.queryByText("Direct / remaining")).toBeNull();
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

  it("does not apply HP changes when the amount is empty", () => {
    const { controls } = renderSidebar(17, true, null, null, "");
    const amount = screen.getByRole("textbox", { name: "HP change amount" });
    const damage = screen.getByRole("button", { name: "Enter an HP amount before damaging Dar'eleth" }) as HTMLButtonElement;
    const healing = screen.getByRole("button", { name: "Enter an HP amount before healing Dar'eleth" }) as HTMLButtonElement;
    expect(damage.disabled).toBe(true);
    expect(healing.disabled).toBe(true);
    fireEvent.keyDown(amount, { key: "Enter" });
    expect(controls.applyHpToToken).not.toHaveBeenCalled();
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
      encounter: { code: "TEST", name: "Test", dmBriefing: null, version: 1, status: "setup", mapPackage: null, mapDraft: null, draftUpdatedAt: null, currentRound: 0, activeInitiativeOrder: null, strictMovement: false, fogVisibility: { mode: "off", polygons: [] }, updatedAt: 1 },
      grid: { width: 24, height: 16, feetPerCell: 5 }, viewer: { id: "dm-kevin", role: "dm" }, features: { combatRolling: { mode: "off", enabled: false, draining: false } }, combatActions: [], combatRolls: [], damageProposals: [], undo: { available: 0, redoAvailable: 0, lastAction: null, nextRedoAction: null },
      tokens: [first, second], annotations: [], chatMessages: [], handouts: [], mapImages: [], availableArt: [],
    } as EncounterState;
    const props: Parameters<typeof EncounterSidebar>[0] = {
      participant: { id: "dm-kevin", name: "Kevin", role: "dm", sessionSecret: "session-secret" }, state, hidden: false, inCombat: false, rosterRows: [{ type: "group", key: "cave-bat", label: "Cave Bat", tokens: [first, second], expanded: false }], selectedToken: null, selectedSpell: null, selectedMapNote: null,
      activeOwnTurnToken: null, activeOwnTurnIsGroup: false, initiativeTokens: [], encounterAction: null, controls: tokenControls(),
      onToggleGroup: vi.fn(), onSelectToken: vi.fn(), onBeginAttack: vi.fn(), onCloseMapNote: vi.fn(), onResizeSpell: vi.fn(), onDeleteToken: vi.fn(), canMoveToken: () => true,
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

  it("does not offer pause or reset while combat is still in setup", () => {
    const token = tokenWithInitiative(17);
    const state = {
      encounter: { code: "TEST", name: "Test", dmBriefing: null, version: 1, status: "setup", mapPackage: null, mapDraft: null, draftUpdatedAt: null, currentRound: 0, activeInitiativeOrder: null, strictMovement: false, fogVisibility: { mode: "off", polygons: [] }, updatedAt: 1 },
      grid: { width: 24, height: 16, feetPerCell: 5 }, viewer: { id: "dm-kevin", role: "dm" }, features: { combatRolling: { mode: "off", enabled: false, draining: false } }, combatActions: [], combatRolls: [], damageProposals: [], undo: { available: 0, redoAvailable: 0, lastAction: null, nextRedoAction: null },
      tokens: [token], annotations: [], chatMessages: [], handouts: [], mapImages: [], availableArt: [],
    } as EncounterState;
    const props: Parameters<typeof EncounterSidebar>[0] = {
      participant: { id: "dm-kevin", name: "Kevin", role: "dm", sessionSecret: "session-secret" },
      state, hidden: false, inCombat: false,
      rosterRows: [{ type: "token", token, grouped: false }], selectedToken: null,
      selectedSpell: null, selectedMapNote: null, activeOwnTurnToken: null,
      activeOwnTurnIsGroup: false, initiativeTokens: [], encounterAction: null,
      controls: tokenControls(), onToggleGroup: vi.fn(),
      onSelectToken: vi.fn(), onBeginAttack: vi.fn(), onCloseMapNote: vi.fn(), onResizeSpell: vi.fn(),
      onDeleteToken: vi.fn(), canMoveToken: () => true, onHideToken: vi.fn(),
      onEndTurn: vi.fn(), onStartOrRestart: vi.fn(), onAdvanceTurn: vi.fn(),
      onPauseOrResume: vi.fn(), onRequestReset: vi.fn(), onCorrectTurn: vi.fn(),
    };
    render(<EncounterSidebar {...props} />);
    expect((screen.getByRole("button", { name: "Pause combat" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reset combat" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
