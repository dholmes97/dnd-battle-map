import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CombatRollResultDialog, ConcentrationReminderDialog, DamageNotificationDialog, DamageReviewDialog, EncounterDialogs } from "@/app/encounter-dialogs";
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
  action: { name: "Longsword +1", attackBonus: 7, attackKind: "melee", damage: { count: 1, sides: 8, modifier: 4 }, damageType: "slashing", reachFeet: 5, rangeFeet: null, manualRider: false, alternateDamage: null },
  actionSource: "character",
  rollMode: "normal",
  attackDice: [15],
  keptD20: 15,
  blessDie: null,
  attackTotal: 22,
  outcome: "hit",
  damageDice: [7],
  damageTotal: 11,
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

describe("DamageNotificationDialog", () => {
  it("explains temporary HP absorption and permits ordinary dismissal", () => {
    const onDismiss = vi.fn();
    const { container } = render(<DamageNotificationDialog notification={{
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

    expect(screen.getByRole("alertdialog", { name: "Damage applied" })).toBeTruthy();
    expect(screen.getByText(/5 temporary HP absorbed all of it/)).toBeTruthy();
    expect(container.querySelector("#damage-notification-description p")?.textContent).toBe("QA Goblin Raider hit QA Champion with Scimitar for 5 slashing damage.");
    expect(screen.getByText("1 more combat update waiting")).toBeTruthy();

    fireEvent.mouseDown(container.querySelector(".damage-notification-shadowbox")!);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("DamageReviewDialog", () => {
  it("makes the standard rulings prominent and submits the selected result", () => {
    const onAdjudicate = vi.fn();
    render(<DamageReviewDialog proposal={damageProposal} roll={damageRoll} pendingCount={2} onAdjudicate={onAdjudicate} onDismiss={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Apply damage to Orc Warrior?" })).toBeTruthy();
    expect(screen.getByText("2 pending")).toBeTruthy();
    expect(screen.getByText("Dar'eleth")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Resistant/ }));
    expect(onAdjudicate).toHaveBeenCalledWith("proposal-review-1", "resistant", undefined);
  });

  it("supports an explicit adjustment and defers without resolving the proposal", () => {
    const onAdjudicate = vi.fn();
    const onDismiss = vi.fn();
    render(<DamageReviewDialog proposal={damageProposal} roll={damageRoll} pendingCount={1} onAdjudicate={onAdjudicate} onDismiss={onDismiss} />);

    const applyAdjusted = screen.getByRole("button", { name: "Apply adjusted" });
    expect((applyAdjusted as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Adjusted damage for Orc Warrior" }), { target: { value: "8" } });
    fireEvent.click(applyAdjusted);
    expect(onAdjudicate).toHaveBeenCalledWith("proposal-review-1", "adjust", 8);

    fireEvent.click(screen.getByRole("button", { name: "Decide later" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("CombatRollResultDialog", () => {
  it("presents authoritative dice and damage in a dedicated result surface", () => {
    const onDismiss = vi.fn();
    render(<CombatRollResultDialog notice={{ roll: damageRoll, proposalId: damageProposal.id }} onDismiss={onDismiss} />);

    expect(screen.getByRole("dialog", { name: "Dar'eleth is attacking Orc Warrior with Longsword +1." })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Return to map" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not present damage for a miss", () => {
    render(<CombatRollResultDialog notice={{ roll: { ...damageRoll, outcome: "miss", damageDice: [7], damageTotal: 11 }, proposalId: null }} onDismiss={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Dar'eleth is attacking Orc Warrior with Longsword +1." })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Attack result: Miss" })).toBeTruthy();
    expect(screen.queryByLabelText("Damage dice")).toBeNull();
    expect(screen.getByText("The attack missed. No damage proposal was created.")).toBeTruthy();
  });

  it("shows every die in a multi-die damage roll independently", () => {
    render(<CombatRollResultDialog notice={{ roll: {
      ...damageRoll,
      action: { ...damageRoll.action, name: "Guiding Bolt", damage: { count: 4, sides: 6, modifier: 0 }, damageType: "radiant", manualRider: true },
      damageDice: [2, 5, 1, 6],
      damageTotal: 14,
    }, proposalId: damageProposal.id }} onDismiss={vi.fn()} />);

    const dice = screen.getByLabelText("Damage dice");
    expect(Array.from(dice.querySelectorAll(".is-damage"), (tile) => tile.textContent)).toEqual(["d62", "d65", "d61", "d66"]);
    expect(screen.getByText("+0")).toBeTruthy();
    expect(screen.getByLabelText("radiant damage total 14")).toBeTruthy();
  });

  it("reveals authoritative attack, verdict, and damage results in story order", () => {
    vi.useFakeTimers();
    const view = render(<CombatRollResultDialog notice={{ roll: damageRoll, proposalId: damageProposal.id }} onDismiss={vi.fn()} />);
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
    const view = render(<CombatRollResultDialog notice={{ roll: {
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

  it("reveals the completed result immediately when reduced motion is preferred", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
    const view = render(<CombatRollResultDialog notice={{ roll: damageRoll, proposalId: damageProposal.id }} onDismiss={vi.fn()} />);

    expect(screen.getByRole("status", { name: "Attack result: Hit" }).classList.contains("is-revealed")).toBe(true);
    expect(screen.getByLabelText("slashing damage total 11").classList.contains("is-revealed")).toBe(true);
    expect(screen.getByText("Damage is pending DM approval.").classList.contains("is-revealed")).toBe(true);

    view.unmount();
    window.matchMedia = originalMatchMedia;
  });
});

describe("EncounterDialogs combat event ordering", () => {
  it("shows the blocking concentration check instead of stacking it over a queued damage update", () => {
    const participant: ParticipantSession = { id: "player", name: "Player", role: "player", sessionSecret: "secret" };
    render(<EncounterDialogs
      participant={participant}
      state={{ encounter: { code: "TEST" } } as EncounterState}
      resetOpen={false}
      restartOpen={false}
      clearAnnotationsOpen={false}
      clearAnnotationCount={0}
      concentrationReminder={{ tokenId: "target-1", tokenName: "QA Champion" }}
      damageNotification={{
        id: "proposal-2",
        targetTokenId: "target-1",
        targetName: "QA Champion",
        attackerName: "QA Skeleton Archer",
        actionName: "Shortbow",
        damageType: "piercing",
        finalDamage: 4,
        hpBefore: 30,
        hpAfter: 26,
        maxHp: 30,
        temporaryHpBefore: 0,
        temporaryHpAfter: 0,
        concentrationCheckRequired: false,
      }}
      damageNotificationRemainingCount={0}
      combatRollResult={null}
      damageReviewProposal={null}
      damageReviewPendingCount={0}
      lightboxHandout={null}
      handoutFitMode
      onResetOpen={vi.fn()}
      onRestartOpen={vi.fn()}
      onClearAnnotationsOpen={vi.fn()}
      onReset={vi.fn()}
      onRestart={vi.fn()}
      onClearAnnotations={vi.fn()}
      onDismissConcentrationReminder={vi.fn()}
      onDismissDamageNotification={vi.fn()}
      onDismissCombatRollResult={vi.fn()}
      onDismissDamageReview={vi.fn()}
      onAdjudicateDamage={vi.fn()}
      onHandoutFitMode={vi.fn()}
      onCloseLightbox={vi.fn()}
    />);

    expect(screen.getByRole("alertdialog", { name: "Concentration check required" })).toBeTruthy();
    expect(screen.queryByRole("alertdialog", { name: "Damage applied" })).toBeNull();
  });

  it("shows the initiating DM's roll result before its pending damage approval", () => {
    const participant: ParticipantSession = { id: "dm", name: "DM", role: "dm", sessionSecret: "secret" };
    render(<EncounterDialogs
      participant={participant}
      state={{ encounter: { code: "TEST" }, combatRolls: [damageRoll] } as EncounterState}
      resetOpen={false}
      restartOpen={false}
      clearAnnotationsOpen={false}
      clearAnnotationCount={0}
      concentrationReminder={null}
      damageNotification={null}
      damageNotificationRemainingCount={0}
      combatRollResult={{ roll: damageRoll, proposalId: damageProposal.id }}
      damageReviewProposal={damageProposal}
      damageReviewPendingCount={1}
      lightboxHandout={null}
      handoutFitMode
      onResetOpen={vi.fn()}
      onRestartOpen={vi.fn()}
      onClearAnnotationsOpen={vi.fn()}
      onReset={vi.fn()}
      onRestart={vi.fn()}
      onClearAnnotations={vi.fn()}
      onDismissConcentrationReminder={vi.fn()}
      onDismissDamageNotification={vi.fn()}
      onDismissCombatRollResult={vi.fn()}
      onDismissDamageReview={vi.fn()}
      onAdjudicateDamage={vi.fn()}
      onHandoutFitMode={vi.fn()}
      onCloseLightbox={vi.fn()}
    />);

    expect(screen.getByRole("dialog", { name: "Dar'eleth is attacking Orc Warrior with Longsword +1." })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Apply damage to Orc Warrior?" })).toBeNull();
  });
});
