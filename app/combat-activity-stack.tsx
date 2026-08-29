"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import IconActionButton from "@/app/icon-action-button";
import type { DamageNotification } from "@/app/use-damage-notifications";
import type { DamageAdjudication } from "@/shared/combat-rolling";
import type { EncounterState, SharedCombatRoll, SharedDamageProposal } from "@/shared/contracts";

export type CombatRollResultNotice = { roll: SharedCombatRoll; proposalId: string | null };

const RESOLVED_ROLL_DISMISS_MS = 3_000;

function terminalProposalStatus(status: SharedDamageProposal["status"] | null) {
  return status !== null && status !== "pending";
}

function damageProposalMessage(proposalId: string | null, proposal: SharedDamageProposal | null) {
  if (!proposalId) return null;
  if (proposal?.status === "rejected" || proposal?.status === "cancelled") return "No damage was applied.";
  if (proposal && terminalProposalStatus(proposal.status)) return "Damage applied.";
  return "Damage is pending DM approval.";
}

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

export function DamageNotificationCard({ notification, remainingCount, onDismiss }: {
  notification: DamageNotification;
  remainingCount: number;
  onDismiss: () => void;
}) {
  const titleId = `damage-notification-title-${notification.id}`;
  const descriptionId = `damage-notification-description-${notification.id}`;
  return <article className="combat-activity-card damage-notification-card" role="status" aria-labelledby={titleId} aria-describedby={descriptionId}>
    <header>
      <span><small>Combat update</small><strong id={titleId}>Damage applied</strong></span>
      <IconActionButton label="Dismiss damage update" variant="close" onClick={onDismiss} />
    </header>
    <div className="damage-notification-card-content">
      <div className="damage-notification-sigil" aria-hidden="true"><span>−{notification.finalDamage}</span></div>
      <div className="damage-notification-copy" id={descriptionId}>
        <p><strong>{notification.attackerName}</strong> hit <strong>{notification.targetName}</strong> with {notification.actionName} for <strong>{notification.finalDamage} {notification.damageType} damage</strong>.</p>
        <p>{damageSummary(notification)}</p>
        {remainingCount > 0 ? <small>{remainingCount} more combat {remainingCount === 1 ? "update" : "updates"} waiting</small> : null}
      </div>
    </div>
    <footer><button type="button" className="combat-card-action" onClick={onDismiss}>{notification.concentrationCheckRequired ? "Continue to concentration check" : "Dismiss"}</button></footer>
  </article>;
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

export function CombatRollResultCard({ notice, proposal = null, onDismiss, onRollDamage }: {
  notice: CombatRollResultNotice;
  proposal?: SharedDamageProposal | null;
  onDismiss: () => void;
  onRollDamage?: () => Promise<void>;
}) {
  const { roll, proposalId } = notice;
  const damagePending = (roll.outcome === "hit" || roll.outcome === "critical") && roll.damageRolledAt === null;
  const damagingHit = (roll.outcome === "hit" || roll.outcome === "critical") && roll.damageTotal !== null;
  const attackTermCount = roll.attackDice.length + 1 + (roll.blessDie === null ? 0 : 1);
  const damageTermCount = damagingHit ? roll.damageDice.length + 1 : 0;
  const revealPlan = useMemo(
    () => createCombatRevealPlan(attackTermCount, damageTermCount),
    [attackTermCount, damageTermCount],
  );
  const reducedMotion = typeof window !== "undefined"
    && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const revealPhase = `${roll.id}:${roll.damageRolledAt ?? "attack"}`;
  const [initialRevealPhase] = useState(revealPhase);
  const phaseStartStep = initialRevealPhase === revealPhase || roll.damageRolledAt === null
    ? 0
    : revealPlan.outcomeStep;
  const [revealState, setRevealState] = useState(() => ({
    phase: revealPhase,
    step: reducedMotion ? revealPlan.completeStep : phaseStartStep,
  }));
  const [rollingDamage, setRollingDamage] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusedWithin, setFocusedWithin] = useState(false);
  const dismissRef = useRef(onDismiss);
  const remainingDismissMsRef = useRef(RESOLVED_ROLL_DISMISS_MS);
  const proposalStatus = proposal?.status ?? (proposalId ? "pending" : null);
  const proposalResolved = terminalProposalStatus(proposalStatus);
  const dismissalPaused = hovered || focusedWithin;

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    remainingDismissMsRef.current = RESOLVED_ROLL_DISMISS_MS;
  }, [proposalStatus, roll.id]);

  useEffect(() => {
    if (!proposalResolved || dismissalPaused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => dismissRef.current(), remainingDismissMsRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingDismissMsRef.current = Math.max(0, remainingDismissMsRef.current - (Date.now() - startedAt));
    };
  }, [dismissalPaused, proposalResolved, proposalStatus, roll.id]);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const phaseStartDelay = phaseStartStep > 0 ? revealPlan.delays[phaseStartStep - 1] : 0;
    const timers = revealPlan.delays.flatMap((delay, index) => index + 1 > phaseStartStep
      ? [window.setTimeout(
          () => setRevealState({ phase: revealPhase, step: index + 1 }),
          Math.max(0, delay - phaseStartDelay),
        )]
      : []);
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phaseStartStep, revealPhase, revealPlan]);

  const revealStep = revealState.phase === revealPhase
    ? revealState.step
    : reducedMotion ? revealPlan.completeStep : phaseStartStep;
  const revealed = (step: number | null) => step !== null && revealStep >= step;
  const keptDieRevealed = roll.attackDice.length > 1
    && revealed(revealPlan.attackTermSteps[roll.attackDice.length]);
  const damageStageRevealed = revealPlan.damageTermSteps.some(revealed);
  const titleId = `combat-roll-result-title-${roll.id}`;
  const statusId = `combat-roll-result-status-${roll.id}`;
  const proposalMessage = damageProposalMessage(proposalId, proposal);
  const statusKind = proposalResolved
    ? proposalStatus === "rejected" || proposalStatus === "cancelled" ? "not-applied" : "applied"
    : damagePending ? "waiting" : proposalId ? "pending" : roll.outcome;
  const requestDamageRoll = async () => {
    if (!onRollDamage || rollingDamage) return;
    setRollingDamage(true);
    try { await onRollDamage(); } finally { setRollingDamage(false); }
  };

  return <article
    className={`combat-activity-card combat-roll-result-card is-${roll.outcome}`}
    aria-labelledby={titleId}
    aria-describedby={statusId}
    onMouseEnter={() => setHovered(true)}
    onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocusedWithin(true)}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedWithin(false);
    }}
  >
    <header>
      <span><small>Combat roll</small><strong id={titleId}><span>{roll.attackerName}</span> is attacking <span>{roll.targetName}</span> with <span>{roll.action.name}</span>.</strong></span>
      <IconActionButton label="Dismiss roll result" variant="close" onClick={onDismiss} />
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
      {damagePending ? <div className={`combat-roll-damage-prompt combat-roll-reveal${revealed(revealPlan.completeStep) ? " is-revealed" : ""}`} id={statusId} role="status">
        {roll.canRollDamage && onRollDamage ? <>
          <span>The attack hit. Pause for reactions, then roll the damage.</span>
          <button type="button" className="combat-card-action" disabled={rollingDamage} onClick={() => void requestDamageRoll()}>{rollingDamage ? "Rolling damage…" : "Roll damage"}</button>
        </> : <span><strong>{roll.participantName}</strong> hit. Waiting for the damage roll.</span>}
      </div> : null}
      {damagingHit ? <div className={`combat-roll-result-stage combat-roll-damage-stage combat-roll-stage-reveal${damageStageRevealed ? " is-revealed" : ""}`} aria-label={`${roll.action.damageType} damage total ${roll.damageTotal}`}>
        <div className="combat-roll-dice" aria-label="Damage dice">
          {roll.damageDice.map((die, index) => <span className={`combat-roll-term is-damage${revealed(revealPlan.damageTermSteps[index]) ? " is-revealed" : ""}`} key={`${die}-${index}`}><small>d{roll.action.damage.sides}</small><strong>{die}</strong></span>)}
          <span className={`combat-roll-term is-modifier${revealed(revealPlan.damageTermSteps[roll.damageDice.length]) ? " is-revealed" : ""}`}><small>{roll.damageDice.length ? "Damage bonus" : "Flat damage"}</small><strong>{signedModifier(roll.action.damage.modifier)}</strong></span>
        </div>
        <div className={`combat-roll-total combat-roll-reveal${revealed(revealPlan.damageTotalStep) ? " is-revealed" : ""}`}><small>{roll.action.damageType} damage</small><strong>{roll.damageTotal}</strong></div>
      </div> : null}
      {damagePending ? null : <p className={`combat-roll-result-status combat-roll-reveal is-${statusKind}${revealed(revealPlan.completeStep) ? " is-revealed" : ""}`} id={statusId} role="status">{roll.outcome === "miss"
        ? "The attack missed. No damage proposal was created."
        : roll.outcome === "needs-ac"
          ? "The target's armor class is unavailable. No damage proposal was created; the DM can resolve the attack from this roll."
          : proposalMessage
            ? proposalMessage
            : "The attack landed, but no damage proposal was created."}</p>}
      {roll.action.manualRider ? <p className={`damage-review-rider combat-roll-reveal${revealed(revealPlan.completeStep) ? " is-revealed" : ""}`}><strong>Additional effect:</strong> {roll.action.manualRiderText}</p> : null}
    </div>
  </article>;
}

export function DamageReviewCard({ proposal, roll, pendingCount, onAdjudicate, onDismiss }: {
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
  const titleId = `damage-review-title-${proposal.id}`;
  const descriptionId = `damage-review-description-${proposal.id}`;

  return <article className="combat-activity-card damage-review-card" aria-labelledby={titleId} aria-describedby={descriptionId}>
    <header>
      <span><small>DM damage approval</small><strong id={titleId}>Apply damage to {targetName}?</strong></span>
      <span className="damage-review-count">{pendingCount} pending</span>
      <IconActionButton label={`Decide later for ${targetName}`} variant="close" onClick={onDismiss} />
    </header>
    <div className="damage-review-content">
      <p id={descriptionId}><strong>{attackerName}</strong> hit <strong>{targetName}</strong> with {actionName}.</p>
      <div className="damage-review-total"><strong>{proposal.rolledDamage}</strong><span>{damageType || "damage"}<small>rolled damage</small></span></div>
      {roll?.action.manualRider ? <p className="damage-review-rider"><strong>Additional effect:</strong> {roll.action.manualRiderText}</p> : null}
      <div className="damage-review-decisions" role="group" aria-label={`Damage rulings for ${targetName}`}>
        <button type="button" className="is-primary" onClick={() => adjudicate("apply")}><strong>Apply full</strong><span>{proposal.rolledDamage}</span></button>
        <button type="button" onClick={() => adjudicate("resistant")}><strong>Resistant</strong><span>{Math.floor(proposal.rolledDamage / 2)}</span></button>
        <button type="button" onClick={() => adjudicate("vulnerable")}><strong>Vulnerable</strong><span>{proposal.rolledDamage * 2}</span></button>
        <button type="button" onClick={() => adjudicate("immune")}><strong>Immune</strong><span>0</span></button>
      </div>
      <div className="damage-review-adjust">
        <label htmlFor={`adjust-damage-${proposal.id}`}>Different amount</label>
        <div><input id={`adjust-damage-${proposal.id}`} aria-label={`Adjusted damage for ${targetName}`} type="number" min="0" max="1000" inputMode="numeric" value={adjustedDamage} onChange={(event) => setAdjustedDamage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && validAdjustment) adjudicate("adjust", adjustedValue); }} /><button type="button" disabled={!validAdjustment} onClick={() => adjudicate("adjust", adjustedValue)}>Apply</button></div>
      </div>
    </div>
    <footer><button type="button" className="text-button is-danger" onClick={() => adjudicate("reject")}>Reject attack</button><button type="button" className="text-button" onClick={() => adjudicate("cancel")}>Cancel proposal</button></footer>
  </article>;
}

const MAX_VISIBLE_CARDS_PER_TYPE = 3;

export function CombatActivityStack({ state, rollResults, damageNotifications, damageReviewProposals, damageReviewPendingCount, onDismissRollResult, onRollDamage, onDismissDamageNotification, onDismissDamageReview, onAdjudicateDamage }: {
  state: EncounterState;
  rollResults: CombatRollResultNotice[];
  damageNotifications: DamageNotification[];
  damageReviewProposals: SharedDamageProposal[];
  damageReviewPendingCount: number;
  onDismissRollResult: (rollId: string) => void;
  onRollDamage: (rollId: string) => Promise<void>;
  onDismissDamageNotification: (notification: DamageNotification) => void;
  onDismissDamageReview: (proposalId: string) => void;
  onAdjudicateDamage: (proposalId: string, method: DamageAdjudication, adjustedDamage?: number) => void;
}) {
  const visibleRollResults = rollResults.slice(0, MAX_VISIBLE_CARDS_PER_TYPE);
  const visibleReviews = damageReviewProposals.slice(0, MAX_VISIBLE_CARDS_PER_TYPE);
  const visibleNotifications = damageNotifications.slice(0, MAX_VISIBLE_CARDS_PER_TYPE);
  const hiddenCount = Math.max(0, rollResults.length - visibleRollResults.length)
    + Math.max(0, damageReviewPendingCount - visibleReviews.length)
    + Math.max(0, damageNotifications.length - visibleNotifications.length);
  if (visibleRollResults.length === 0 && visibleReviews.length === 0 && visibleNotifications.length === 0) return null;

  return <aside className="combat-activity-stack" aria-label="Combat activity">
    {visibleRollResults.map((notice) => {
      const roll = state.combatRolls.find((item) => item.id === notice.roll.id) ?? notice.roll;
      const proposal = state.damageProposals.find((item) => item.rollId === roll.id) ?? null;
      return <CombatRollResultCard
        key={roll.id}
        notice={{ roll, proposalId: proposal?.id ?? notice.proposalId }}
        proposal={proposal}
        onDismiss={() => onDismissRollResult(roll.id)}
        onRollDamage={roll.canRollDamage ? () => onRollDamage(roll.id) : undefined}
      />;
    })}
    {visibleReviews.map((proposal) => <DamageReviewCard
      key={proposal.id}
      proposal={proposal}
      roll={state.combatRolls.find((roll) => roll.id === proposal.rollId) ?? null}
      pendingCount={damageReviewPendingCount}
      onAdjudicate={onAdjudicateDamage}
      onDismiss={() => onDismissDamageReview(proposal.id)}
    />)}
    {visibleNotifications.map((notification, index) => <DamageNotificationCard
      key={notification.id}
      notification={notification}
      remainingCount={Math.max(0, damageNotifications.length - index - 1)}
      onDismiss={() => onDismissDamageNotification(notification)}
    />)}
    {hiddenCount > 0 ? <div className="combat-activity-overflow" role="status">{hiddenCount} more combat {hiddenCount === 1 ? "card" : "cards"} queued</div> : null}
  </aside>;
}
