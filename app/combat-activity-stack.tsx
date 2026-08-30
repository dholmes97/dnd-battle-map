"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import IconActionButton from "@/app/icon-action-button";
import type { DamageNotification } from "@/app/use-damage-notifications";
import type { DamageAdjudication } from "@/shared/combat-rolling";
import type { EncounterState, SharedCombatRoll, SharedDamageProposal } from "@/shared/contracts";

export type CombatRollResultNotice = { roll: SharedCombatRoll; proposalId: string | null };

const RESOLVED_ROLL_DISMISS_MS = 3_000;
const MISSED_ROLL_DISMISS_MS = 10_000;

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

function useAutoDismissCountdown({ durationMs, paused, onDismiss }: {
  durationMs: number;
  paused: boolean;
  onDismiss: () => void;
}) {
  const dismissRef = useRef(onDismiss);
  const remainingMsRef = useRef(durationMs);
  const [remainingSeconds, setRemainingSeconds] = useState(Math.ceil(durationMs / 1_000));

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const startingRemainingMs = remainingMsRef.current;
    const updateCountdown = () => {
      const remainingMs = Math.max(0, startingRemainingMs - (Date.now() - startedAt));
      setRemainingSeconds(Math.max(0, Math.ceil(remainingMs / 1_000)));
    };
    updateCountdown();
    const countdown = window.setInterval(updateCountdown, 250);
    const dismissal = window.setTimeout(() => dismissRef.current(), startingRemainingMs);
    return () => {
      window.clearInterval(countdown);
      window.clearTimeout(dismissal);
      remainingMsRef.current = Math.max(0, startingRemainingMs - (Date.now() - startedAt));
    };
  }, [paused]);

  return remainingSeconds;
}

function AutoDismissCountdown({ durationMs, paused, onDismiss }: {
  durationMs: number;
  paused: boolean;
  onDismiss: () => void;
}) {
  const remainingSeconds = useAutoDismissCountdown({ durationMs, paused, onDismiss });
  return <footer className={`combat-auto-dismiss${paused ? " is-paused" : ""}`}>
    <small aria-live="off">{paused ? `Auto dismiss paused · ${remainingSeconds}` : `Auto dismiss in ${remainingSeconds}`}</small>
  </footer>;
}

export function CombatRollResultCard({ notice, proposal = null, onDismiss, onRollDamage, onReleaseOutcome, onFinalizeDamage }: {
  notice: CombatRollResultNotice;
  proposal?: SharedDamageProposal | null;
  onDismiss: () => void;
  onRollDamage?: () => Promise<void>;
  onReleaseOutcome?: (outcome: "miss" | "hit" | "critical") => Promise<void>;
  onFinalizeDamage?: (proposalId: string, method: DamageAdjudication, adjustedDamage?: number) => void;
}) {
  const { roll, proposalId } = notice;
  const privateDmRoll = roll.rollPrivacy === "dm-private";
  const summaryOnly = roll.rollPrivacy === "dm-summary";
  const calculatedOutcome = roll.calculatedOutcome ?? roll.outcome;
  const awaitingVerdictRelease = privateDmRoll && roll.releasedOutcome === null;
  const visibleOutcome = awaitingVerdictRelease ? calculatedOutcome : roll.outcome;
  const damagePending = !awaitingVerdictRelease && (roll.outcome === "hit" || roll.outcome === "critical") && roll.damageRolledAt === null;
  const damagingHit = (roll.outcome === "hit" || roll.outcome === "critical") && roll.damageTotal !== null;
  const attackTermCount = summaryOnly ? 0 : roll.attackDice.length + 1 + (roll.blessDie === null ? 0 : 1);
  const damageTermCount = damagingHit && !summaryOnly ? roll.damageDice.length + 1 : 0;
  const revealPlan = useMemo(
    () => createCombatRevealPlan(attackTermCount, damageTermCount),
    [attackTermCount, damageTermCount],
  );
  const reducedMotion = typeof window !== "undefined"
    && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const skipAnimation = reducedMotion || summaryOnly;
  const revealPhase = `${roll.id}:${roll.damageRolledAt ?? "attack"}`;
  const [initialRevealPhase] = useState(revealPhase);
  const phaseStartStep = initialRevealPhase === revealPhase || roll.damageRolledAt === null
    ? 0
    : revealPlan.outcomeStep;
  const [revealState, setRevealState] = useState(() => ({
    phase: revealPhase,
    step: skipAnimation ? revealPlan.completeStep : phaseStartStep,
  }));
  const [rollingDamage, setRollingDamage] = useState(false);
  const [releasingOutcome, setReleasingOutcome] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusedWithin, setFocusedWithin] = useState(false);
  const proposalStatus = proposal?.status ?? (proposalId ? "pending" : null);
  const proposalResolved = terminalProposalStatus(proposalStatus);
  const inlineDamageReview = damagingHit && proposal?.status === "pending" && Boolean(onFinalizeDamage);
  const dismissalPaused = hovered || focusedWithin;

  useEffect(() => {
    if (skipAnimation) return;
    const phaseStartDelay = phaseStartStep > 0 ? revealPlan.delays[phaseStartStep - 1] : 0;
    const timers = revealPlan.delays.flatMap((delay, index) => index + 1 > phaseStartStep
      ? [window.setTimeout(
          () => setRevealState({ phase: revealPhase, step: index + 1 }),
          Math.max(0, delay - phaseStartDelay),
        )]
      : []);
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phaseStartStep, revealPhase, revealPlan, skipAnimation]);

  const revealStep = revealState.phase === revealPhase
    ? revealState.step
    : skipAnimation ? revealPlan.completeStep : phaseStartStep;
  const revealed = (step: number | null) => step !== null && revealStep >= step;
  const keptDieRevealed = roll.attackDice.length > 1
    && revealed(revealPlan.attackTermSteps[roll.attackDice.length]);
  const damageStageRevealed = summaryOnly && damagingHit || revealPlan.damageTermSteps.some(revealed);
  const titleId = `combat-roll-result-title-${roll.id}`;
  const statusId = `combat-roll-result-status-${roll.id}`;
  const proposalMessage = damageProposalMessage(proposalId, proposal);
  const statusKind = proposalResolved
    ? proposalStatus === "rejected" || proposalStatus === "cancelled" ? "not-applied" : "applied"
    : damagePending ? "waiting" : proposalId ? "pending" : roll.outcome;
  const autoDismissDurationMs = proposalResolved
    ? RESOLVED_ROLL_DISMISS_MS
    : !awaitingVerdictRelease && roll.outcome === "miss" ? MISSED_ROLL_DISMISS_MS : null;
  const autoDismissEnabled = autoDismissDurationMs !== null && revealed(revealPlan.completeStep);
  const autoDismissKey = `${roll.id}:${proposalResolved ? proposalStatus : roll.outcome}`;
  const requestDamageRoll = async () => {
    if (!onRollDamage || rollingDamage) return;
    setRollingDamage(true);
    try { await onRollDamage(); } finally { setRollingDamage(false); }
  };
  const releaseOutcome = async (outcome: "miss" | "hit" | "critical") => {
    if (!onReleaseOutcome || releasingOutcome) return;
    setReleasingOutcome(true);
    try { await onReleaseOutcome(outcome); } finally { setReleasingOutcome(false); }
  };
  const acceptedOutcome = calculatedOutcome === "critical" ? "critical" : calculatedOutcome === "hit" ? "hit" : "miss";
  const overrideOutcome = acceptedOutcome === "miss" ? "hit" : "miss";
  const outcomeLabel = awaitingVerdictRelease ? "Calculated result" : privateDmRoll ? "Released result" : "Attack result";

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
      <span><small>{privateDmRoll ? "Private DM roll" : "Combat roll"}</small><strong id={titleId}><span>{roll.attackerName}</span> is attacking <span>{roll.targetName}</span> with <span>{roll.action.name}</span>.</strong></span>
      <IconActionButton label="Dismiss roll result" variant="close" onClick={onDismiss} />
    </header>
    <div className="combat-roll-result-content">
      {!summaryOnly ? <div className="combat-roll-result-stage" aria-label={`Attack total ${roll.attackTotal}`}>
        <div className="combat-roll-dice" aria-label="Attack dice">
          {roll.attackDice.map((die, index) => <span className={`combat-roll-term${die === roll.keptD20 && keptDieRevealed ? " is-kept" : ""}${revealed(revealPlan.attackTermSteps[index]) ? " is-revealed" : ""}`} key={`${die}-${index}`}><small>d20</small><strong>{die}</strong></span>)}
          <span className={`combat-roll-term is-modifier${revealed(revealPlan.attackTermSteps[roll.attackDice.length]) ? " is-revealed" : ""}`}><small>Attack bonus</small><strong>{signedModifier(roll.action.attackBonus)}</strong></span>
          {roll.blessDie !== null ? <span className={`combat-roll-term is-bless${revealed(revealPlan.attackTermSteps[roll.attackDice.length + 1]) ? " is-revealed" : ""}`}><small>Bless d4</small><strong>{roll.blessDie}</strong></span> : null}
        </div>
        <div className={`combat-roll-total combat-roll-reveal${revealed(revealPlan.attackTotalStep) ? " is-revealed" : ""}`}><small>Attack total</small><strong>{roll.attackTotal}</strong></div>
      </div> : null}
      <div className={`combat-roll-outcome combat-roll-reveal is-${visibleOutcome}${revealed(revealPlan.outcomeStep) ? " is-revealed" : ""}`} role="status" aria-label={`${outcomeLabel}: ${outcomeTitle(visibleOutcome)}`}><span><small>{outcomeLabel}</small><strong>{outcomeTitle(visibleOutcome)}</strong></span></div>
      {awaitingVerdictRelease ? <div className={`dm-attack-verdict combat-roll-reveal${revealed(revealPlan.completeStep) ? " is-revealed" : ""}`} id={statusId} role="group" aria-label={`Release attack result for ${roll.targetName}`}>
        <span>This roll is private. Release the calculated result or override what the table sees.</span>
        <div>
          <button type="button" className="combat-card-action is-primary" disabled={releasingOutcome} onClick={() => void releaseOutcome(acceptedOutcome)}>Release {outcomeTitle(acceptedOutcome)}</button>
          <button type="button" className="combat-card-action" disabled={releasingOutcome} onClick={() => void releaseOutcome(overrideOutcome)}>Override: {outcomeTitle(overrideOutcome)}</button>
        </div>
      </div> : null}
      {damagePending ? <div className={`combat-roll-damage-prompt combat-roll-reveal${revealed(revealPlan.completeStep) ? " is-revealed" : ""}`} id={statusId} role="status">
        {roll.canRollDamage && onRollDamage ? <>
          <span>The attack hit. Pause for reactions, then roll the damage.</span>
          <span className="combat-roll-damage-actions"><button type="button" className="combat-card-action is-primary" disabled={rollingDamage} onClick={() => void requestDamageRoll()}>{rollingDamage ? "Rolling damage…" : "Roll damage"}</button>{privateDmRoll && roll.canReleaseOutcome && onReleaseOutcome ? <button type="button" className="combat-card-action" disabled={releasingOutcome} onClick={() => void releaseOutcome("miss")}>Resolve as miss</button> : null}</span>
        </> : summaryOnly ? <span>The attack was released as a hit. Waiting for the DM to roll damage.</span> : <span><strong>{roll.participantName}</strong> hit. Waiting for the damage roll.</span>}
      </div> : null}
      {damagingHit ? <div className={`combat-roll-result-stage combat-roll-damage-stage combat-roll-stage-reveal${summaryOnly ? " is-summary" : ""}${damageStageRevealed ? " is-revealed" : ""}`} aria-label={`${roll.action.damageType} damage total ${roll.damageTotal}`}>
        {!summaryOnly ? <div className="combat-roll-dice" aria-label="Damage dice">
          {roll.damageDice.map((die, index) => <span className={`combat-roll-term is-damage${revealed(revealPlan.damageTermSteps[index]) ? " is-revealed" : ""}`} key={`${die}-${index}`}><small>d{roll.action.damage.sides}</small><strong>{die}</strong></span>)}
          <span className={`combat-roll-term is-modifier${revealed(revealPlan.damageTermSteps[roll.damageDice.length]) ? " is-revealed" : ""}`}><small>{roll.damageDice.length ? "Damage bonus" : "Flat damage"}</small><strong>{signedModifier(roll.action.damage.modifier)}</strong></span>
        </div> : null}
        <div className={`combat-roll-total combat-roll-reveal${summaryOnly || revealed(revealPlan.damageTotalStep) ? " is-revealed" : ""}`}><small>{roll.action.damageType} damage</small><strong>{roll.damageTotal}</strong></div>
      </div> : null}
      {inlineDamageReview && proposal && onFinalizeDamage ? <DmDamageFinalizer id={statusId} proposal={proposal} roll={roll} revealed={revealed(revealPlan.completeStep)} onFinalize={onFinalizeDamage} /> : null}
      {damagePending || awaitingVerdictRelease || inlineDamageReview ? null : <p className={`combat-roll-result-status combat-roll-reveal is-${statusKind}${revealed(revealPlan.completeStep) ? " is-revealed" : ""}`} id={statusId} role="status">{roll.outcome === "miss"
        ? "The attack missed. No damage proposal was created."
        : roll.outcome === "needs-ac"
          ? "The target's armor class is unavailable. No damage proposal was created; the DM can resolve the attack from this roll."
          : proposalMessage
            ? privateDmRoll && proposalResolved ? "Damage applied and released to the table." : proposalMessage
            : "The attack landed, but no damage proposal was created."}</p>}
      {roll.action.manualRider ? <p className={`damage-review-rider combat-roll-reveal${revealed(revealPlan.completeStep) ? " is-revealed" : ""}`}><strong>Additional effect:</strong> {roll.action.manualRiderText}</p> : null}
    </div>
    {autoDismissEnabled && autoDismissDurationMs !== null ? <AutoDismissCountdown key={autoDismissKey} durationMs={autoDismissDurationMs} paused={dismissalPaused} onDismiss={onDismiss} /> : null}
  </article>;
}

function DmDamageFinalizer({ id, proposal, roll, revealed, onFinalize }: {
  id: string;
  proposal: SharedDamageProposal;
  roll: SharedCombatRoll;
  revealed: boolean;
  onFinalize: (proposalId: string, method: DamageAdjudication, adjustedDamage?: number) => void;
}) {
  const [adjustedDamage, setAdjustedDamage] = useState("");
  if (proposal.rolledDamage === null) return null;
  const adjustedValue = Number(adjustedDamage);
  const validAdjustment = adjustedDamage.trim() !== "" && Number.isInteger(adjustedValue) && adjustedValue >= 0 && adjustedValue <= 1000;
  const finalize = (method: DamageAdjudication, amount?: number) => onFinalize(proposal.id, method, amount);
  const privateDmRoll = roll.rollPrivacy === "dm-private";
  return <section className={`dm-damage-finalizer combat-roll-reveal${revealed ? " is-revealed" : ""}`} id={id} aria-label={`Finalize damage against ${roll.targetName}`}>
    <p><strong>{privateDmRoll ? "Private damage roll." : "DM damage approval."}</strong> {privateDmRoll ? "Choose the final amount to apply and reveal to the table." : "Apply the rolled damage or choose a different result."}</p>
    <div className="damage-review-decisions" role="group" aria-label={`Final damage for ${roll.targetName}`}>
      <button type="button" className="is-primary" aria-label={privateDmRoll ? `Apply and reveal ${proposal.rolledDamage} damage` : `Apply full ${proposal.rolledDamage} damage`} onClick={() => finalize("apply")}><strong>{privateDmRoll ? "Apply & reveal" : "Apply full"}</strong><span>{proposal.rolledDamage}</span></button>
      <button type="button" onClick={() => finalize("resistant")}><strong>Resistant</strong><span>{Math.floor(proposal.rolledDamage / 2)}</span></button>
      <button type="button" onClick={() => finalize("vulnerable")}><strong>Vulnerable</strong><span>{Math.min(1000, proposal.rolledDamage * 2)}</span></button>
      <button type="button" onClick={() => finalize("immune")}><strong>{privateDmRoll ? "No damage" : "Immune"}</strong><span>0</span></button>
    </div>
    <div className="damage-review-adjust">
      <label htmlFor={`dm-final-damage-${proposal.id}`}>Different amount</label>
      <div><input id={`dm-final-damage-${proposal.id}`} aria-label={`Final damage for ${roll.targetName}`} type="number" min="0" max="1000" inputMode="numeric" value={adjustedDamage} onChange={(event) => setAdjustedDamage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && validAdjustment) finalize("adjust", adjustedValue); }} /><button type="button" disabled={!validAdjustment} onClick={() => finalize("adjust", adjustedValue)}>Apply &amp; reveal</button></div>
    </div>
    {!privateDmRoll ? <div className="dm-damage-finalizer-secondary"><button type="button" className="text-button is-danger" onClick={() => finalize("reject")}>Reject attack</button><button type="button" className="text-button" onClick={() => finalize("cancel")}>Cancel proposal</button></div> : null}
  </section>;
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

export function CombatActivityStack({ state, canAdjudicateDamage, rollResults, damageNotifications, damageReviewProposals, damageReviewPendingCount, onDismissRollResult, onRollDamage, onReleaseAttackOutcome, onDismissDamageNotification, onDismissDamageReview, onAdjudicateDamage }: {
  state: EncounterState;
  canAdjudicateDamage: boolean;
  rollResults: CombatRollResultNotice[];
  damageNotifications: DamageNotification[];
  damageReviewProposals: SharedDamageProposal[];
  damageReviewPendingCount: number;
  onDismissRollResult: (rollId: string) => void;
  onRollDamage: (rollId: string) => Promise<void>;
  onReleaseAttackOutcome: (rollId: string, outcome: "miss" | "hit" | "critical") => Promise<void>;
  onDismissDamageNotification: (notification: DamageNotification) => void;
  onDismissDamageReview: (proposalId: string) => void;
  onAdjudicateDamage: (proposalId: string, method: DamageAdjudication, adjustedDamage?: number) => void;
}) {
  const visibleRollResults = rollResults.slice(0, MAX_VISIBLE_CARDS_PER_TYPE);
  const visibleRollIds = new Set(visibleRollResults.map((notice) => notice.roll.id));
  const visibleReviews = damageReviewProposals
    .filter((proposal) => !visibleRollIds.has(proposal.rollId))
    .slice(0, MAX_VISIBLE_CARDS_PER_TYPE);
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
        onReleaseOutcome={roll.canReleaseOutcome ? (outcome) => onReleaseAttackOutcome(roll.id, outcome) : undefined}
        onFinalizeDamage={canAdjudicateDamage && proposal?.status === "pending" ? onAdjudicateDamage : undefined}
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
