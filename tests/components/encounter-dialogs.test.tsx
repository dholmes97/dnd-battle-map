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

  it("does not present damage for a miss", () => {
    render(<CombatRollResultCard notice={{ roll: { ...damageRoll, outcome: "miss", damageDice: [7], damageTotal: 11 }, proposalId: null }} onDismiss={vi.fn()} />);
    expect(screen.getByRole("article", { name: "Dar'eleth is attacking Orc Warrior with Longsword +1." })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Attack result: Miss" })).toBeTruthy();
    expect(screen.queryByLabelText("Damage dice")).toBeNull();
    expect(screen.getByText("The attack missed. No damage proposal was created.")).toBeTruthy();
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

  it("reveals the completed result immediately when reduced motion is preferred", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
    const view = render(<CombatRollResultCard notice={{ roll: damageRoll, proposalId: damageProposal.id }} onDismiss={vi.fn()} />);

    expect(screen.getByRole("status", { name: "Attack result: Hit" }).classList.contains("is-revealed")).toBe(true);
    expect(screen.getByLabelText("slashing damage total 11").classList.contains("is-revealed")).toBe(true);
    expect(screen.getByText("Damage is pending DM approval.").classList.contains("is-revealed")).toBe(true);

    view.unmount();
    window.matchMedia = originalMatchMedia;
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

  it("shows a roll result and multiple DM damage reviews together without a modal", () => {
    const secondRoll = { ...damageRoll, id: "roll-review-2", targetTokenId: "target-2", targetName: "Goblin Raider" };
    const secondProposal = { ...damageProposal, id: "proposal-review-2", rollId: secondRoll.id, targetTokenId: secondRoll.targetTokenId, createdAt: 2 };
    render(<CombatActivityStack
      state={{ combatRolls: [damageRoll, secondRoll] } as EncounterState}
      rollResult={{ roll: damageRoll, proposalId: damageProposal.id }}
      damageNotifications={[]}
      damageReviewProposals={[damageProposal, secondProposal]}
      damageReviewPendingCount={2}
      onDismissRollResult={vi.fn()}
      onDismissDamageNotification={vi.fn()}
      onDismissDamageReview={vi.fn()}
      onAdjudicateDamage={vi.fn()}
    />);

    expect(screen.getByRole("complementary", { name: "Combat activity" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Dar'eleth is attacking Orc Warrior with Longsword +1." })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Apply damage to Orc Warrior?" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Apply damage to Goblin Raider?" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
