import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CombatActivityStack, CombatRollResultCard, DamageNotificationCard, DamageReviewCard } from "@/app/combat-activity-stack";
import { ConcentrationReminderDialog, EncounterDialogs } from "@/app/encounter-dialogs";
import type { EncounterState, ParticipantSession, SharedCombatRoll, SharedDamageProposal } from "@/shared/contracts";

const damageProposal: SharedDamageProposal = {
  id: "proposal-review-1",
  rollId: "roll-review-1",
  targetTokenId: "target-1",
  status: "pending",
  rolledDamage: 11,
  finalDamage: null,
  adjudicationMethod: null,
  adjudicationNote: null,
  concentrationCheckRequired: false,
  createdAt: 1,
  resolvedAt: null,
};

const damageRoll: SharedCombatRoll = {
  id: "roll-review-1",
  attackerTokenId: "attacker-1",
  attackerName: "Dar'eleth",
  targetTokenId: "target-1",
  targetName: "Orc Warrior",
  participantName: "Dan",
  action: { name: "Longsword +1", attackBonus: 7, attackKind: "melee", damage: { count: 1, sides: 8, modifier: 4 }, damageType: "slashing", reachFeet: 5, rangeFeet: null, manualRider: false, manualRiderText: null, alternateDamage: null },
  actionSource: "character",
  rollMode: "normal",
  attackDice: [15],
  keptD20: 15,
  blessDie: null,
  attackTotal: 22,
  outcome: "hit",
  calculatedOutcome: null,
  releasedOutcome: "hit",
  rollPrivacy: "public",
  damageDice: [7],
  damageTotal: 11,
  damageRolledAt: 2,
  canRollDamage: false,
  canReleaseOutcome: false,
  inTurn: true,
  createdAt: 1,
};

describe("ConcentrationReminderDialog", () => {
  it("requires an explicit dismissal from its blocking shadowbox", () => {
    const onDismiss = vi.fn();
    const { container } = render(<ConcentrationReminderDialog reminder={{ tokenId: "token-1", tokenName: "Dar'eleth" }} onDismiss={onDismiss} />);

    expect(screen.getByRole("alertdialog", { name: "Concentration check required" })).toBeTruthy();
    expect(screen.getByText("Dar'eleth")).toBeTruthy();

    fireEvent.mouseDown(container.querySelector(".concentration-reminder-shadowbox")!);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss reminder" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("DamageNotificationCard", () => {
  it("explains temporary HP absorption and permits ordinary dismissal", () => {
    const onDismiss = vi.fn();
    render(<DamageNotificationCard notification={{
      id: "proposal-1",
      targetTokenId: "target-1",
      targetName: "QA Champion",
      attackerName: "QA Goblin Raider",
      actionName: "Scimitar",
      damageType: "slashing",
      finalDamage: 5,
      hpBefore: 30,
      hpAfter: 30,
      maxHp: 30,
      temporaryHpBefore: 5,
      temporaryHpAfter: 0,
      concentrationCheckRequired: true,
    }} remainingCount={1} onDismiss={onDismiss} />);

    expect(screen.getByRole("status", { name: "Damage applied" })).toBeTruthy();
    expect(screen.getByText(/5 temporary HP absorbed all of it/)).toBeTruthy();
    expect(screen.getByText(/QA Goblin Raider/).closest("p")?.textContent).toBe("QA Goblin Raider hit QA Champion with Scimitar for 5 slashing damage.");
    expect(screen.getByText("1 more combat update waiting")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue to concentration check" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("DamageReviewCard", () => {
  it("makes the standard rulings prominent and submits the selected result", () => {
    const onAdjudicate = vi.fn();
    render(<DamageReviewCard proposal={damageProposal} roll={damageRoll} pendingCount={2} onAdjudicate={onAdjudicate} onDismiss={vi.fn()} />);

    expect(screen.getByRole("article", { name: "Apply damage to Orc Warrior?" })).toBeTruthy();
    expect(screen.getByText("2 pending")).toBeTruthy();
    expect(screen.getByText("Dar'eleth")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Resistant/ }));
    expect(onAdjudicate).toHaveBeenCalledWith("proposal-review-1", "resistant", undefined);
  });

  it("supports an explicit adjustment and defers without resolving the proposal", () => {
    const onAdjudicate = vi.fn();
    const onDismiss = vi.fn();
    render(<DamageReviewCard proposal={damageProposal} roll={damageRoll} pendingCount={1} onAdjudicate={onAdjudicate} onDismiss={onDismiss} />);

    const applyAdjusted = screen.getByRole("button", { name: "Apply" });
    expect((applyAdjusted as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Adjusted damage for Orc Warrior" }), { target: { value: "8" } });
    fireEvent.click(applyAdjusted);
    expect(onAdjudicate).toHaveBeenCalledWith("proposal-review-1", "adjust", 8);

    fireEvent.click(screen.getByRole("button", { name: "Decide later for Orc Warrior" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("CombatRollResultCard", () => {
  it("pauses after a hit until the original roller explicitly rolls damage", async () => {
    vi.useFakeTimers();
    const onRollDamage = vi.fn(async () => undefined);
    const pendingDamageRoll: SharedCombatRoll = {
      ...damageRoll,
      damageDice: [],
      damageTotal: null,
      damageRolledAt: null,
      canRollDamage: true,
    };
    const view = render(<CombatRollResultCard
      notice={{ roll: pendingDamageRoll, proposalId: null }}
      onDismiss={vi.fn()}
      onRollDamage={onRollDamage}
    />);

    expect(screen.queryByLabelText("Damage dice")).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss roll result" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1_780));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Roll damage" })));
    expect(onRollDamage).toHaveBeenCalledOnce();

    view.rerender(<CombatRollResultCard
      notice={{ roll: damageRoll, proposalId: damageProposal.id }}
      proposal={damageProposal}
      onDismiss={vi.fn()}
      onRollDamage={onRollDamage}
    />);
    const damageTerms = screen.getByLabelText("Damage dice").querySelectorAll(".combat-roll-term");
    expect(damageTerms[0].classList.contains("is-revealed")).toBe(false);
    act(() => vi.advanceTimersByTime(280));
    expect(damageTerms[0].classList.contains("is-revealed")).toBe(true);

    view.unmount();
    vi.useRealTimers();
  });

  it("shows observers that damage is waiting without giving them the roll action", () => {
    render(<CombatRollResultCard notice={{ roll: {
      ...damageRoll,
      damageDice: [],
      damageTotal: null,
      damageRolledAt: null,
      canRollDamage: false,
    }, proposalId: null }} onDismiss={vi.fn()} />);

    expect(screen.getByText("Dan").closest("span")?.textContent).toContain("Waiting for the damage roll.");
    expect(screen.queryByRole("button", { name: "Roll damage" })).toBeNull();
  });

  it("presents authoritative dice and damage in a dedicated result surface", () => {
    const onDismiss = vi.fn();
    render(<CombatRollResultCard notice={{ roll: damageRoll, proposalId: damageProposal.id }} onDismiss={onDismiss} />);

    expect(screen.getByRole("article", { name: "Dar'eleth is attacking Orc Warrior with Longsword +1." })).toBeTruthy();
    const attackRoll = screen.getByLabelText("Attack total 22");
    const outcome = screen.getByRole("status", { name: "Attack result: Hit" });
    expect(screen.getByText("Attack bonus")).toBeTruthy();
    expect(screen.getByText("+7")).toBeTruthy();
    expect(screen.getByText("Damage bonus")).toBeTruthy();
    expect(screen.getByText("+4")).toBeTruthy();
    const damageRollResult = screen.getByLabelText("slashing damage total 11");
    expect(attackRoll.compareDocumentPosition(outcome) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(outcome.compareDocumentPosition(damageRollResult) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText("Damage dice").textContent).toContain("d8");
    expect(screen.getByText("Damage is pending DM approval.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss roll result" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("changes a resolved proposal in place and dismisses it after three seconds", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const view = render(<CombatRollResultCard notice={{ roll: damageRoll, proposalId: damageProposal.id }} proposal={damageProposal} onDismiss={onDismiss} />);

    expect(screen.getByText("Damage is pending DM approval.")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2_540));
    view.rerender(<CombatRollResultCard
      notice={{ roll: damageRoll, proposalId: damageProposal.id }}
      proposal={{ ...damageProposal, status: "applied", resolvedAt: 2 }}
      onDismiss={onDismiss}
    />);
    expect(screen.getByText("Damage applied.")).toBeTruthy();
    expect(screen.getByText("Auto dismiss in 3")).toBeTruthy();

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("Auto dismiss in 2")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1_999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledOnce();

    view.unmount();
    vi.useRealTimers();
  });

  it("reports rejection without exposing an adjudication detail", () => {
    render(<CombatRollResultCard
      notice={{ roll: damageRoll, proposalId: damageProposal.id }}
      proposal={{ ...damageProposal, status: "rejected", resolvedAt: 2 }}
      onDismiss={vi.fn()}
    />);

    expect(screen.getByText("No damage was applied.")).toBeTruthy();
    expect(screen.queryByText(/resistant|adjusted|immune/i)).toBeNull();
  });

  it("pauses the resolved-card countdown for hover and keyboard focus", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const view = render(<CombatRollResultCard
      notice={{ roll: damageRoll, proposalId: damageProposal.id }}
      proposal={{ ...damageProposal, status: "applied", resolvedAt: 2 }}
      onDismiss={onDismiss}
    />);
    const card = screen.getByRole("article", { name: "Dar'eleth is attacking Orc Warrior with Longsword +1." });
    const close = screen.getByRole("button", { name: "Dismiss roll result" });

    fireEvent.mouseEnter(card);
    act(() => vi.advanceTimersByTime(3_000));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseLeave(card);
    act(() => vi.advanceTimersByTime(1_000));
    fireEvent.focus(close);
    act(() => vi.advanceTimersByTime(3_000));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.blur(close, { relatedTarget: null });
    act(() => vi.advanceTimersByTime(1_999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledOnce();

    view.unmount();
    vi.useRealTimers();
  });

  it("does not present damage for a miss and visibly counts down its dismissal", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const view = render(<CombatRollResultCard notice={{ roll: { ...damageRoll, outcome: "miss", damageDice: [7], damageTotal: 11 }, proposalId: null }} onDismiss={onDismiss} />);
    expect(screen.getByRole("article", { name: "Dar'eleth is attacking Orc Warrior with Longsword +1." })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Attack result: Miss" })).toBeTruthy();
    expect(screen.queryByLabelText("Damage dice")).toBeNull();
    expect(screen.getByText("The attack missed. No damage proposal was created.")).toBeTruthy();
    expect(screen.queryByText(/Auto dismiss/)).toBeNull();

    act(() => vi.advanceTimersByTime(1_780));
    expect(screen.getByText("Auto dismiss in 10")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByText("Auto dismiss in 9")).toBeTruthy();
    act(() => vi.advanceTimersByTime(8_999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledOnce();

    view.unmount();
    vi.useRealTimers();
  });

  it("shows every die in a multi-die damage roll independently", () => {
    render(<CombatRollResultCard notice={{ roll: {
      ...damageRoll,
      action: { ...damageRoll.action, name: "Guiding Bolt", damage: { count: 4, sides: 6, modifier: 0 }, damageType: "radiant", manualRider: true, manualRiderText: "The next attack against the target has advantage." },
      damageDice: [2, 5, 1, 6],
      damageTotal: 14,
    }, proposalId: damageProposal.id }} onDismiss={vi.fn()} />);

    const dice = screen.getByLabelText("Damage dice");
    expect(Array.from(dice.querySelectorAll(".is-damage"), (tile) => tile.textContent)).toEqual(["d62", "d65", "d61", "d66"]);
    expect(screen.getByText("+0")).toBeTruthy();
    expect(screen.getByLabelText("radiant damage total 14")).toBeTruthy();
    expect(screen.getByText("Additional effect:")).toBeTruthy();
    expect(screen.queryByText(/manual rider/i)).toBeNull();
  });

  it("reveals authoritative attack, verdict, and damage results in story order", () => {
    vi.useFakeTimers();
    const view = render(<CombatRollResultCard notice={{ roll: damageRoll, proposalId: damageProposal.id }} onDismiss={vi.fn()} />);
    const attackTerms = screen.getByLabelText("Attack dice").querySelectorAll(".combat-roll-term");
    const attackTotal = screen.getByLabelText("Attack total 22").querySelector(".combat-roll-total")!;
    const outcome = screen.getByRole("status", { name: "Attack result: Hit" });
    const damageStage = screen.getByLabelText("slashing damage total 11");
    const damageTerms = screen.getByLabelText("Damage dice").querySelectorAll(".combat-roll-term");
    const damageTotal = damageStage.querySelector(".combat-roll-total")!;

    expect(attackTerms[0].classList.contains("is-revealed")).toBe(false);
    act(() => vi.advanceTimersByTime(140));
    expect(attackTerms[0].classList.contains("is-revealed")).toBe(true);
    expect(attackTerms[1].classList.contains("is-revealed")).toBe(false);
    act(() => vi.advanceTimersByTime(480));
    expect(attackTerms[1].classList.contains("is-revealed")).toBe(true);
    expect(attackTotal.classList.contains("is-revealed")).toBe(true);
    expect(outcome.classList.contains("is-revealed")).toBe(false);
    act(() => vi.advanceTimersByTime(999));
    expect(outcome.classList.contains("is-revealed")).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(outcome.classList.contains("is-revealed")).toBe(true);
    expect(damageStage.classList.contains("is-revealed")).toBe(false);
    act(() => vi.advanceTimersByTime(280));
    expect(damageStage.classList.contains("is-revealed")).toBe(true);
    expect(damageTerms[0].classList.contains("is-revealed")).toBe(true);
    expect(damageTerms[1].classList.contains("is-revealed")).toBe(false);
    act(() => vi.advanceTimersByTime(480));
    expect(damageTerms[1].classList.contains("is-revealed")).toBe(true);
    expect(damageTotal.classList.contains("is-revealed")).toBe(true);

    view.unmount();
    vi.useRealTimers();
  });

  it("waits until both advantage dice land before identifying the kept die", () => {
    vi.useFakeTimers();
    const view = render(<CombatRollResultCard notice={{ roll: {
      ...damageRoll,
      rollMode: "advantage",
      attackDice: [7, 5],
      keptD20: 7,
      attackTotal: 14,
    }, proposalId: damageProposal.id }} onDismiss={vi.fn()} />);
    const dice = screen.getByLabelText("Attack dice").querySelectorAll(".combat-roll-term");

    act(() => vi.advanceTimersByTime(140));
    expect(dice[0].classList.contains("is-revealed")).toBe(true);
    expect(dice[0].classList.contains("is-kept")).toBe(false);
    act(() => vi.advanceTimersByTime(200));
    expect(dice[1].classList.contains("is-revealed")).toBe(true);
    expect(dice[0].classList.contains("is-kept")).toBe(false);
    act(() => vi.advanceTimersByTime(200));
    expect(dice[0].classList.contains("is-kept")).toBe(true);

    view.unmount();
    vi.useRealTimers();
  });

  it("reveals immediately but preserves resolved reading time when reduced motion is preferred", () => {
    vi.useFakeTimers();
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
    const onDismiss = vi.fn();
    const view = render(<CombatRollResultCard
      notice={{ roll: damageRoll, proposalId: damageProposal.id }}
      proposal={{ ...damageProposal, status: "applied", resolvedAt: 2 }}
      onDismiss={onDismiss}
    />);

    expect(screen.getByRole("status", { name: "Attack result: Hit" }).classList.contains("is-revealed")).toBe(true);
    expect(screen.getByLabelText("slashing damage total 11").classList.contains("is-revealed")).toBe(true);
    expect(screen.getByText("Damage applied.").classList.contains("is-revealed")).toBe(true);
    act(() => vi.advanceTimersByTime(2_999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledOnce();

    view.unmount();
    window.matchMedia = originalMatchMedia;
    vi.useRealTimers();
  });

  it("keeps a DM attack private until the DM releases or overrides its verdict", async () => {
    const onReleaseOutcome = vi.fn(async () => undefined);
    const privateRoll: SharedCombatRoll = {
      ...damageRoll,
      rollPrivacy: "dm-private",
      calculatedOutcome: "hit",
      releasedOutcome: null,
      damageDice: [],
      damageTotal: null,
      damageRolledAt: null,
      canRollDamage: false,
      canReleaseOutcome: true,
    };
    render(<CombatRollResultCard
      notice={{ roll: privateRoll, proposalId: null }}
      onDismiss={vi.fn()}
      onReleaseOutcome={onReleaseOutcome}
    />);

    expect(screen.getByText("Private DM roll")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Calculated result: Hit" })).toBeTruthy();
    expect(screen.getByLabelText("Attack dice")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Release Hit" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Override: Miss" })));
    expect(onReleaseOutcome).toHaveBeenNthCalledWith(1, "hit");
    expect(onReleaseOutcome).toHaveBeenNthCalledWith(2, "miss");
  });

  it("shows players only the released DM verdict until final damage is released", () => {
    const summaryRoll: SharedCombatRoll = {
      ...damageRoll,
      rollPrivacy: "dm-summary",
      calculatedOutcome: null,
      releasedOutcome: "hit",
      action: {
        ...damageRoll.action,
        attackBonus: 0,
        damage: { ...damageRoll.action.damage, count: 0, modifier: 0 },
      },
      attackDice: [],
      keptD20: 0,
      blessDie: null,
      attackTotal: 0,
      damageDice: [],
      damageTotal: null,
      damageRolledAt: null,
      canRollDamage: false,
      canReleaseOutcome: false,
    };
    render(<CombatRollResultCard notice={{ roll: summaryRoll, proposalId: null }} onDismiss={vi.fn()} />);

    expect(screen.getByRole("status", { name: "Attack result: Hit" })).toBeTruthy();
    expect(screen.getByText("The attack was released as a hit. Waiting for the DM to roll damage.")).toBeTruthy();
    expect(screen.queryByLabelText("Attack dice")).toBeNull();
    expect(screen.queryByText("Attack total")).toBeNull();
    expect(screen.queryByText("Attack bonus")).toBeNull();
  });

  it("lets the DM apply and reveal private damage without a second review card", () => {
    const onFinalizeDamage = vi.fn();
    render(<CombatRollResultCard
      notice={{ roll: {
        ...damageRoll,
        rollPrivacy: "dm-private",
        calculatedOutcome: "hit",
        releasedOutcome: "hit",
        canReleaseOutcome: false,
      }, proposalId: damageProposal.id }}
      proposal={damageProposal}
      onDismiss={vi.fn()}
      onFinalizeDamage={onFinalizeDamage}
    />);

    expect(screen.getByLabelText("Finalize damage against Orc Warrior")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply and reveal 11 damage" }));
    expect(onFinalizeDamage).toHaveBeenCalledWith(damageProposal.id, "apply", undefined);
    expect(screen.queryByText("Damage is pending DM approval.")).toBeNull();
  });

  it("reveals only the DM's finalized damage total to players", () => {
    render(<CombatRollResultCard
      notice={{ roll: {
        ...damageRoll,
        rollPrivacy: "dm-summary",
        calculatedOutcome: null,
        releasedOutcome: "hit",
        action: {
          ...damageRoll.action,
          attackBonus: 0,
          damage: { ...damageRoll.action.damage, count: 0, modifier: 0 },
        },
        attackDice: [],
        keptD20: 0,
        attackTotal: 0,
        damageDice: [],
        damageTotal: 6,
        damageRolledAt: 3,
      }, proposalId: damageProposal.id }}
      proposal={{ ...damageProposal, status: "applied", rolledDamage: 6, finalDamage: 6, resolvedAt: 3 }}
      onDismiss={vi.fn()}
    />);

    expect(screen.getByLabelText("slashing damage total 6").classList.contains("is-revealed")).toBe(true);
    expect(screen.getByText("slashing damage")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.queryByLabelText("Damage dice")).toBeNull();
    expect(screen.queryByText("Damage bonus")).toBeNull();
  });
});

describe("combat surface separation", () => {
  it("keeps the concentration check as a blocking authored dialog", () => {
    const participant: ParticipantSession = { id: "player", name: "Player", role: "player", sessionSecret: "secret" };
    render(<EncounterDialogs
      participant={participant}
      state={{ encounter: { code: "TEST" } } as EncounterState}
      resetOpen={false}
      restartOpen={false}
      clearAnnotationsOpen={false}
      clearAnnotationCount={0}
      concentrationReminder={{ tokenId: "target-1", tokenName: "QA Champion" }}
      lightboxHandout={null}
      handoutFitMode
      onResetOpen={vi.fn()}
      onRestartOpen={vi.fn()}
      onClearAnnotationsOpen={vi.fn()}
      onReset={vi.fn()}
      onRestart={vi.fn()}
      onClearAnnotations={vi.fn()}
      onDismissConcentrationReminder={vi.fn()}
      onHandoutFitMode={vi.fn()}
      onCloseLightbox={vi.fn()}
    />);

    expect(screen.getByRole("alertdialog", { name: "Concentration check required" })).toBeTruthy();
  });

  it("keeps each live DM damage review inside its matching roll card", () => {
    const onAdjudicateDamage = vi.fn();
    const secondRoll = { ...damageRoll, id: "roll-review-2", targetTokenId: "target-2", targetName: "Goblin Raider" };
    const secondProposal = { ...damageProposal, id: "proposal-review-2", rollId: secondRoll.id, targetTokenId: secondRoll.targetTokenId, createdAt: 2 };
    render(<CombatActivityStack
      state={{ combatRolls: [damageRoll, secondRoll], damageProposals: [damageProposal, secondProposal] } as EncounterState}
      canAdjudicateDamage
      rollResults={[
        { roll: damageRoll, proposalId: damageProposal.id },
        { roll: secondRoll, proposalId: secondProposal.id },
      ]}
      damageNotifications={[]}
      damageReviewProposals={[damageProposal, secondProposal]}
      damageReviewPendingCount={2}
      onDismissRollResult={vi.fn()}
      onRollDamage={vi.fn(async () => undefined)}
      onReleaseAttackOutcome={vi.fn(async () => undefined)}
      onDismissDamageNotification={vi.fn()}
      onDismissDamageReview={vi.fn()}
      onAdjudicateDamage={onAdjudicateDamage}
    />);

    expect(screen.getByRole("complementary", { name: "Combat activity" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Dar'eleth is attacking Orc Warrior with Longsword +1." })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Dar'eleth is attacking Goblin Raider with Longsword +1." })).toBeTruthy();
    expect(screen.getByLabelText("Finalize damage against Orc Warrior")).toBeTruthy();
    expect(screen.getByLabelText("Finalize damage against Goblin Raider")).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Apply damage to Orc Warrior?" })).toBeNull();
    expect(screen.queryByRole("article", { name: "Apply damage to Goblin Raider?" })).toBeNull();
    expect(screen.queryByText("Damage is pending DM approval.")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Apply full 11 damage" })[0]);
    expect(onAdjudicateDamage).toHaveBeenCalledWith(damageProposal.id, "apply", undefined);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the standalone damage review as a fallback after its roll card is unavailable", () => {
    render(<CombatActivityStack
      state={{ combatRolls: [damageRoll], damageProposals: [damageProposal] } as EncounterState}
      canAdjudicateDamage
      rollResults={[]}
      damageNotifications={[]}
      damageReviewProposals={[damageProposal]}
      damageReviewPendingCount={1}
      onDismissRollResult={vi.fn()}
      onRollDamage={vi.fn(async () => undefined)}
      onReleaseAttackOutcome={vi.fn(async () => undefined)}
      onDismissDamageNotification={vi.fn()}
      onDismissDamageReview={vi.fn()}
      onAdjudicateDamage={vi.fn()}
    />);

    expect(screen.getByRole("article", { name: "Apply damage to Orc Warrior?" })).toBeTruthy();
  });
});
