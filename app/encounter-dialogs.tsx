"use client";

import { useEffect, useMemo, useState } from "react";
import { HandoutLightbox } from "@/app/chat-handouts-ui";
import { ModalDialog } from "@/app/modal-dialog";
import type { DamageNotification } from "@/app/use-damage-notifications";
import type { DamageAdjudication } from "@/shared/combat-rolling";
import type { EncounterState, ParticipantSession, SharedCombatRoll, SharedDamageProposal } from "@/shared/contracts";

type LightboxHandout = Parameters<typeof HandoutLightbox>[0]["handout"];
export type ConcentrationReminder = { tokenId: string; tokenName: string };
export type CombatRollResultNotice = { roll: SharedCombatRoll; proposalId: string | null };

function damageSummary(notification: DamageNotification) {
  const temporaryHpLost = notification.temporaryHpBefore === null || notification.temporaryHpAfter === null
    ? 0
    : Math.max(0, notification.temporaryHpBefore - notification.temporaryHpAfter);
  const hpLost = notification.hpBefore === null || notification.hpAfter === null
    ? 0
    : Math.max(0, notification.hpBefore - notification.hpAfter);
  if (temporaryHpLost > 0 && hpLost === 0) {
    const remainingHp = notification.hpAfter !== null && notification.maxHp !== null
      ? ` ${notification.targetName} remains at ${notification.hpAfter}/${notification.maxHp} HP.`
      : "";
    return `${temporaryHpLost} temporary HP absorbed all of it.${remainingHp}`;
  }
  if (temporaryHpLost > 0 && notification.hpBefore !== null && notification.hpAfter !== null) {
    return `${temporaryHpLost} temporary HP absorbed part of it. HP fell from ${notification.hpBefore} to ${notification.hpAfter}.`;
  }
  if (notification.hpBefore !== null && notification.hpAfter !== null) {
    return `HP fell from ${notification.hpBefore} to ${notification.hpAfter}.`;
  }
  return "The updated hit points are now shown on the character card.";
}

export function DamageNotificationDialog({ notification, remainingCount, onDismiss }: {
  notification: DamageNotification;
  remainingCount: number;
  onDismiss: () => void;
}) {
  return <ModalDialog role="alertdialog" labelledBy="damage-notification-title" describedBy="damage-notification-description" backdropClassName="modal-shadowbox concentration-reminder-shadowbox damage-notification-shadowbox" dialogClassName="" closeOnBackdrop onDismiss={onDismiss}>
    <header>
      <span><small>Combat update</small><strong id="damage-notification-title">Damage applied</strong></span>
    </header>
    <div className="concentration-reminder-content">
      <div className="concentration-reminder-sigil damage-notification-sigil" aria-hidden="true"><span>−{notification.finalDamage}</span></div>
      <div className="damage-notification-copy" id="damage-notification-description">
        <p><strong>{notification.attackerName}</strong> hit <strong>{notification.targetName}</strong> with {notification.actionName} for <strong>{notification.finalDamage} {notification.damageType} damage</strong>.</p>
        <p>{damageSummary(notification)}</p>
        {remainingCount > 0 ? <small>{remainingCount} more combat {remainingCount === 1 ? "update" : "updates"} waiting</small> : null}
      </div>
    </div>
    <footer><button type="button" className="primary-button" data-dialog-initial-focus onClick={onDismiss}>Got it</button></footer>
  </ModalDialog>;
}

export function ConcentrationReminderDialog({ reminder, onDismiss }: {
  reminder: ConcentrationReminder;
  onDismiss: () => void;
}) {
  return <ModalDialog role="alertdialog" labelledBy="concentration-reminder-title" describedBy="concentration-reminder-description" backdropClassName="modal-shadowbox concentration-reminder-shadowbox" dialogClassName="" closeOnEscape={false}>
      <header>
        <span><small>Combat reminder</small><strong id="concentration-reminder-title">Concentration check required</strong></span>
      </header>
      <div className="concentration-reminder-content">
        <div className="concentration-reminder-sigil" aria-hidden="true"><span>◆</span></div>
        <p id="concentration-reminder-description"><strong>{reminder.tokenName}</strong> took damage while concentrating. Make the required Constitution saving throw now.</p>
      </div>
      <footer><button type="button" className="primary-button" data-dialog-initial-focus onClick={onDismiss}>Dismiss reminder</button></footer>
  </ModalDialog>;
}

function outcomeTitle(outcome: SharedCombatRoll["outcome"]) {
  if (outcome === "critical") return "Critical hit";
  if (outcome === "hit") return "Hit";
  if (outcome === "miss") return "Miss";
  return "DM review needed";
}

function signedModifier(modifier: number) {
  return modifier >= 0 ? `+${modifier}` : `${modifier}`;
}

type CombatRevealPlan = {
  attackTermSteps: number[];
  attackTotalStep: number;
  outcomeStep: number;
  damageTermSteps: number[];
  damageTotalStep: number | null;
  completeStep: number;
  delays: number[];
};

function createCombatRevealPlan(attackTermCount: number, damageTermCount: number): CombatRevealPlan {
  const delays: number[] = [];
  const addStep = (delay: number) => {
    delays.push(delay);
    return delays.length;
  };
  let cursor = 140;
  const attackTermSteps = Array.from({ length: attackTermCount }, () => {
    const step = addStep(cursor);
    cursor += 200;
    return step;
  });
  cursor += 80;
  const attackTotalStep = addStep(cursor);
  cursor += 1_000;
  const outcomeStep = addStep(cursor);
  const damageTermSteps: number[] = [];
  let damageTotalStep: number | null = null;
  if (damageTermCount > 0) {
    cursor += 280;
    for (let index = 0; index < damageTermCount; index += 1) {
      damageTermSteps.push(addStep(cursor));
      cursor += 200;
    }
    cursor += 80;
    damageTotalStep = addStep(cursor);
  }
  cursor += 160;
  const completeStep = addStep(cursor);
  return { attackTermSteps, attackTotalStep, outcomeStep, damageTermSteps, damageTotalStep, completeStep, delays };
}

export function CombatRollResultDialog({ notice, onDismiss }: {
  notice: CombatRollResultNotice;
  onDismiss: () => void;
}) {
  const { roll, proposalId } = notice;
  const damagingHit = (roll.outcome === "hit" || roll.outcome === "critical") && roll.damageTotal !== null;
  const attackTermCount = roll.attackDice.length + 1 + (roll.blessDie === null ? 0 : 1);
  const damageTermCount = damagingHit ? roll.damageDice.length + 1 : 0;
  const revealPlan = useMemo(
    () => createCombatRevealPlan(attackTermCount, damageTermCount),
    [attackTermCount, damageTermCount],
  );
  const reducedMotion = typeof window !== "undefined"
    && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [revealState, setRevealState] = useState(() => ({
    rollId: roll.id,
    step: reducedMotion ? revealPlan.completeStep : 0,
  }));

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timers = revealPlan.delays.map((delay, index) => window.setTimeout(
      () => setRevealState({ rollId: roll.id, step: index + 1 }),
      delay,
    ));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [revealPlan, roll.id]);

  const revealStep = revealState.rollId === roll.id
    ? revealState.step
    : reducedMotion ? revealPlan.completeStep : 0;
  const revealed = (step: number | null) => step !== null && revealStep >= step;
  const keptDieRevealed = roll.attackDice.length > 1
    && revealed(revealPlan.attackTermSteps[roll.attackDice.length]);
  const damageStageRevealed = revealPlan.damageTermSteps.some(revealed);
  return <ModalDialog labelledBy="combat-roll-result-title" describedBy="combat-roll-result-status" backdropClassName="modal-shadowbox combat-roll-result-shadowbox" dialogClassName={`combat-roll-result-dialog is-${roll.outcome}`} closeOnBackdrop onDismiss={onDismiss}>
    <header>
      <span><small>Combat roll</small><strong id="combat-roll-result-title"><span>{roll.attackerName}</span> is attacking <span>{roll.targetName}</span> with <span>{roll.action.name}</span>.</strong></span>
    </header>
    <div className="combat-roll-result-content">
      <div className="combat-roll-result-stage" aria-label={`Attack total ${roll.attackTotal}`}>
        <div className="combat-roll-dice" aria-label="Attack dice">
          {roll.attackDice.map((die, index) => <span className={`combat-roll-term${die === roll.keptD20 && keptDieRevealed ? " is-kept" : ""}${revealed(revealPlan.attackTermSteps[index]) ? " is-revealed" : ""}`} key={`${die}-${index}`}><small>d20</small><strong>{die}</strong></span>)}
          <span className={`combat-roll-term is-modifier${revealed(revealPlan.attackTermSteps[roll.attackDice.length]) ? " is-revealed" : ""}`}><small>Attack bonus</small><strong>{signedModifier(roll.action.attackBonus)}</strong></span>
          {roll.blessDie !== null ? <span className={`combat-roll-term is-bless${revealed(revealPlan.attackTermSteps[roll.attackDice.length + 1]) ? " is-revealed" : ""}`}><small>Bless d4</small><strong>{roll.blessDie}</strong></span> : null}
        </div>
        <div className={`combat-roll-total combat-roll-reveal${revealed(revealPlan.attackTotalStep) ? " is-revealed" : ""}`}><small>Attack total</small><strong>{roll.attackTotal}</strong></div>
      </div>
      <div className={`combat-roll-outcome combat-roll-reveal is-${roll.outcome}${revealed(revealPlan.outcomeStep) ? " is-revealed" : ""}`} role="status" aria-label={`Attack result: ${outcomeTitle(roll.outcome)}`}><span><small>Attack result</small><strong>{outcomeTitle(roll.outcome)}</strong></span></div>
      {damagingHit ? <div className={`combat-roll-result-stage combat-roll-damage-stage combat-roll-stage-reveal${damageStageRevealed ? " is-revealed" : ""}`} aria-label={`${roll.action.damageType} damage total ${roll.damageTotal}`}>
        <div className="combat-roll-dice" aria-label="Damage dice">
          {roll.damageDice.map((die, index) => <span className={`combat-roll-term is-damage${revealed(revealPlan.damageTermSteps[index]) ? " is-revealed" : ""}`} key={`${die}-${index}`}><small>d{roll.action.damage.sides}</small><strong>{die}</strong></span>)}
          <span className={`combat-roll-term is-modifier${revealed(revealPlan.damageTermSteps[roll.damageDice.length]) ? " is-revealed" : ""}`}><small>{roll.damageDice.length ? "Damage bonus" : "Flat damage"}</small><strong>{signedModifier(roll.action.damage.modifier)}</strong></span>
        </div>
        <div className={`combat-roll-total combat-roll-reveal${revealed(revealPlan.damageTotalStep) ? " is-revealed" : ""}`}><small>{roll.action.damageType} damage</small><strong>{roll.damageTotal}</strong></div>
      </div> : null}
      <p className={`combat-roll-result-status combat-roll-reveal${revealed(revealPlan.completeStep) ? " is-revealed" : ""}`} id="combat-roll-result-status">{roll.outcome === "miss"
        ? "The attack missed. No damage proposal was created."
        : roll.outcome === "needs-ac"
          ? "The target's armor class is unavailable. No damage proposal was created; the DM can resolve the attack from this roll."
          : proposalId
            ? "Damage is pending DM approval."
            : "The attack landed, but no damage proposal was created."}</p>
      {roll.action.manualRider ? <p className={`damage-review-rider combat-roll-reveal${revealed(revealPlan.completeStep) ? " is-revealed" : ""}`}><strong>Manual rider:</strong> {roll.action.manualRiderText}</p> : null}
    </div>
    <footer><button type="button" className="primary-button" data-dialog-initial-focus onClick={onDismiss}>Return to map</button></footer>
  </ModalDialog>;
}

export function DamageReviewDialog({ proposal, roll, pendingCount, onAdjudicate, onDismiss }: {
  proposal: SharedDamageProposal;
  roll: SharedCombatRoll | null;
  pendingCount: number;
  onAdjudicate: (proposalId: string, method: DamageAdjudication, adjustedDamage?: number) => void;
  onDismiss: () => void;
}) {
  const [adjustedDamage, setAdjustedDamage] = useState("");
  if (proposal.rolledDamage === null) return null;
  const adjustedValue = Number(adjustedDamage);
  const validAdjustment = adjustedDamage.trim() !== "" && Number.isInteger(adjustedValue) && adjustedValue >= 0 && adjustedValue <= 1000;
  const attackerName = roll?.attackerName ?? "Attacker";
  const targetName = roll?.targetName ?? "target";
  const actionName = roll?.action.name ?? "Attack";
  const damageType = roll?.action.damageType ?? "";
  const adjudicate = (method: DamageAdjudication, amount?: number) => onAdjudicate(proposal.id, method, amount);

  return <ModalDialog labelledBy="damage-review-title" describedBy="damage-review-description" backdropClassName="modal-shadowbox damage-review-shadowbox" dialogClassName="damage-review-dialog" closeOnBackdrop onDismiss={onDismiss}>
    <header>
      <span><small>DM damage approval</small><strong id="damage-review-title">Apply damage to {targetName}?</strong></span>
      <span className="damage-review-count">{pendingCount} pending</span>
    </header>
    <div className="damage-review-content">
      <p id="damage-review-description"><strong>{attackerName}</strong> hit <strong>{targetName}</strong> with {actionName}.</p>
      <div className="damage-review-total"><strong>{proposal.rolledDamage}</strong><span>{damageType || "damage"}<small>rolled damage</small></span></div>
      {roll?.action.manualRider ? <p className="damage-review-rider"><strong>Manual rider:</strong> {roll.action.manualRiderText}</p> : null}
      <div className="damage-review-decisions" role="group" aria-label="Damage rulings">
        <button type="button" className="is-primary" data-dialog-initial-focus onClick={() => adjudicate("apply")}><strong>Apply full</strong><span>{proposal.rolledDamage} damage</span></button>
        <button type="button" onClick={() => adjudicate("resistant")}><strong>Resistant</strong><span>{Math.floor(proposal.rolledDamage / 2)} damage</span></button>
        <button type="button" onClick={() => adjudicate("vulnerable")}><strong>Vulnerable</strong><span>{proposal.rolledDamage * 2} damage</span></button>
        <button type="button" onClick={() => adjudicate("immune")}><strong>Immune</strong><span>0 damage</span></button>
      </div>
      <div className="damage-review-adjust">
        <label htmlFor={`adjust-damage-${proposal.id}`}>Apply a different amount</label>
        <div><input id={`adjust-damage-${proposal.id}`} aria-label={`Adjusted damage for ${targetName}`} type="number" min="0" max="1000" inputMode="numeric" value={adjustedDamage} onChange={(event) => setAdjustedDamage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && validAdjustment) adjudicate("adjust", adjustedValue); }} /><button type="button" disabled={!validAdjustment} onClick={() => adjudicate("adjust", adjustedValue)}>Apply adjusted</button></div>
      </div>
    </div>
    <footer>
      <div><button type="button" className="text-button is-danger" onClick={() => adjudicate("reject")}>Reject attack</button><button type="button" className="text-button" onClick={() => adjudicate("cancel")}>Cancel proposal</button></div>
      <button type="button" className="secondary-button" onClick={onDismiss}>Decide later</button>
    </footer>
  </ModalDialog>;
}

export function EncounterDialogs({ participant, state, resetOpen, restartOpen, clearAnnotationsOpen, clearAnnotationCount, concentrationReminder, damageNotification, damageNotificationRemainingCount, combatRollResult, damageReviewProposal, damageReviewPendingCount, lightboxHandout, handoutFitMode, onResetOpen, onRestartOpen, onClearAnnotationsOpen, onReset, onRestart, onClearAnnotations, onDismissConcentrationReminder, onDismissDamageNotification, onDismissCombatRollResult, onDismissDamageReview, onAdjudicateDamage, onHandoutFitMode, onCloseLightbox }: {
  participant: ParticipantSession;
  state: EncounterState;
  resetOpen: boolean;
  restartOpen: boolean;
  clearAnnotationsOpen: boolean;
  clearAnnotationCount: number;
  concentrationReminder: ConcentrationReminder | null;
  damageNotification: DamageNotification | null;
  damageNotificationRemainingCount: number;
  combatRollResult: CombatRollResultNotice | null;
  damageReviewProposal: SharedDamageProposal | null;
  damageReviewPendingCount: number;
  lightboxHandout: LightboxHandout | null;
  handoutFitMode: boolean;
  onResetOpen: (open: boolean) => void;
  onRestartOpen: (open: boolean) => void;
  onClearAnnotationsOpen: (open: boolean) => void;
  onReset: () => void;
  onRestart: () => void;
  onClearAnnotations: () => void;
  onDismissConcentrationReminder: () => void;
  onDismissDamageNotification: () => void;
  onDismissCombatRollResult: () => void;
  onDismissDamageReview: () => void;
  onAdjudicateDamage: (proposalId: string, method: DamageAdjudication, adjustedDamage?: number) => void;
  onHandoutFitMode: (fit: boolean) => void;
  onCloseLightbox: () => void;
}) {
  if (participant.role !== "dm") return <>
    {lightboxHandout?.available ? <HandoutLightbox participant={participant} encounterCode={state.encounter.code} handout={lightboxHandout} fitMode={handoutFitMode} onFitModeChange={onHandoutFitMode} onClose={onCloseLightbox} /> : null}
    {concentrationReminder
      ? <ConcentrationReminderDialog reminder={concentrationReminder} onDismiss={onDismissConcentrationReminder} />
      : damageNotification
        ? <DamageNotificationDialog notification={damageNotification} remainingCount={damageNotificationRemainingCount} onDismiss={onDismissDamageNotification} />
        : combatRollResult
          ? <CombatRollResultDialog notice={combatRollResult} onDismiss={onDismissCombatRollResult} />
        : null}
  </>;
  const authoredDialogOpen = resetOpen || restartOpen || clearAnnotationsOpen;
  const damageReviewRoll = damageReviewProposal
    ? state.combatRolls.find((roll) => roll.id === damageReviewProposal.rollId) ?? null
    : null;
  return <>
    {resetOpen ? <ModalDialog labelledBy="reset-encounter-title" describedBy="reset-encounter-description" closeOnBackdrop onDismiss={() => onResetOpen(false)}><div className="eyebrow">Encounter control</div><h2 id="reset-encounter-title">Reset combat?</h2><p id="reset-encounter-description">This returns the encounter to setup, clears the current round, active turn, and movement tracking. The map, tokens, HP, effects, and entered initiative numbers stay intact.</p><div className="button-row"><button className="secondary-button" data-dialog-initial-focus onClick={() => onResetOpen(false)}>Cancel</button><button className="danger-button" onClick={onReset}>Reset combat</button></div></ModalDialog> : null}
    {restartOpen ? <ModalDialog labelledBy="restart-combat-title" describedBy="restart-combat-description" closeOnBackdrop onDismiss={() => onRestartOpen(false)}><div className="eyebrow">Encounter control</div><h2 id="restart-combat-title">Restart combat?</h2><p id="restart-combat-description">This returns combat to round 1 and rebuilds the turn order from the current initiative numbers. Movement and completed-turn tracking reset. The map, tokens, HP, and effects stay intact.</p><div className="button-row"><button className="secondary-button" data-dialog-initial-focus onClick={() => onRestartOpen(false)}>Cancel</button><button className="danger-button" onClick={onRestart}>Restart combat</button></div></ModalDialog> : null}
    {clearAnnotationsOpen ? <ModalDialog labelledBy="clear-annotations-title" describedBy="clear-annotations-description" closeOnBackdrop onDismiss={() => onClearAnnotationsOpen(false)}><div className="eyebrow">Map drawings</div><h2 id="clear-annotations-title">Clear {clearAnnotationCount} {clearAnnotationCount === 1 ? "drawing" : "drawings"}?</h2><p id="clear-annotations-description">This removes every durable line from the map. Temporary pings and DM spotlights keep their normal expiry, and Undo can restore the cleared drawings.</p><div className="button-row"><button className="secondary-button" data-dialog-initial-focus onClick={() => onClearAnnotationsOpen(false)}>Keep drawings</button><button className="danger-button" onClick={onClearAnnotations}>Clear drawings</button></div></ModalDialog> : null}
    {lightboxHandout?.available ? <HandoutLightbox participant={participant} encounterCode={state.encounter.code} handout={lightboxHandout} fitMode={handoutFitMode} onFitModeChange={onHandoutFitMode} onClose={onCloseLightbox} /> : null}
    {!authoredDialogOpen && concentrationReminder
      ? <ConcentrationReminderDialog reminder={concentrationReminder} onDismiss={onDismissConcentrationReminder} />
      : !authoredDialogOpen && combatRollResult
        ? <CombatRollResultDialog notice={combatRollResult} onDismiss={onDismissCombatRollResult} />
      : !authoredDialogOpen && damageReviewProposal
        ? <DamageReviewDialog key={damageReviewProposal.id} proposal={damageReviewProposal} roll={damageReviewRoll} pendingCount={damageReviewPendingCount} onAdjudicate={onAdjudicateDamage} onDismiss={onDismissDamageReview} />
        : null}
  </>;
}
