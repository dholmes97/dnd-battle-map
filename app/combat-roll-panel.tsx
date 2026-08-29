"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import IconActionButton from "@/app/icon-action-button";
import {
  DAMAGE_TYPES,
  SUPPORTED_DIE_SIDES,
  formatDiceFormula,
  hasBless,
  type CombatActionValues,
  type RollMode,
} from "@/shared/combat-rolling";
import type { CommandPayload, EncounterState, ParticipantSession, SharedToken } from "@/shared/contracts";

export type CombatRollResponse = {
  state: EncounterState;
  rollId: string;
  proposalId: string | null;
  result: {
    attackDice: number[];
    keptD20: number;
    blessDie: number | null;
    attackTotal: number;
    outcome: "miss" | "hit" | "critical" | "needs-ac";
    damageDice: number[];
    damageTotal: number | null;
  };
};

type CombatPanelPosition = {
  left: number;
  top: number;
  maxHeight: number;
  placement: "above" | "below";
};

const COMBAT_PANEL_GUTTER = 8;
const COMBAT_PANEL_ANCHOR_GAP = 10;

export function calculateCombatPanelPosition({
  anchor,
  containerWidth,
  containerHeight,
  panelWidth,
  panelHeight,
  visibleTop = 0,
  visibleBottom = containerHeight,
}: {
  anchor: { x: number; y: number };
  containerWidth: number;
  containerHeight: number;
  panelWidth: number;
  panelHeight: number;
  visibleTop?: number;
  visibleBottom?: number;
}): CombatPanelPosition {
  const boundedVisibleTop = Math.min(Math.max(0, visibleTop), containerHeight);
  const boundedVisibleBottom = Math.max(
    boundedVisibleTop,
    Math.min(containerHeight, visibleBottom),
  );
  const maxHeight = Math.max(
    0,
    boundedVisibleBottom - boundedVisibleTop - COMBAT_PANEL_GUTTER * 2,
  );
  const visiblePanelHeight = Math.min(panelHeight, maxHeight);
  const maximumLeft = Math.max(COMBAT_PANEL_GUTTER, containerWidth - panelWidth - COMBAT_PANEL_GUTTER);
  const left = Math.min(
    Math.max(COMBAT_PANEL_GUTTER, anchor.x - panelWidth / 2),
    maximumLeft,
  );
  const fitsBelow = anchor.y + COMBAT_PANEL_ANCHOR_GAP + visiblePanelHeight <=
    boundedVisibleBottom - COMBAT_PANEL_GUTTER;
  const placement = fitsBelow ? "below" : "above";
  const desiredTop = fitsBelow
    ? anchor.y + COMBAT_PANEL_ANCHOR_GAP
    : anchor.y - COMBAT_PANEL_ANCHOR_GAP - visiblePanelHeight;
  const minimumTop = boundedVisibleTop + COMBAT_PANEL_GUTTER;
  const maximumTop = Math.max(
    minimumTop,
    boundedVisibleBottom - visiblePanelHeight - COMBAT_PANEL_GUTTER,
  );

  return {
    left,
    top: Math.min(Math.max(minimumTop, desiredTop), maximumTop),
    maxHeight,
    placement,
  };
}

export function CombatRollPanel({
  participant,
  state,
  attacker,
  target,
  anchor,
  onClose,
  onRoll,
  onComplete,
}: {
  participant: ParticipantSession;
  state: EncounterState;
  attacker: SharedToken;
  target: SharedToken;
  anchor: { x: number; y: number };
  onClose(): void;
  onRoll(payload: CommandPayload<"roll-attack">): Promise<CombatRollResponse | null>;
  onComplete(response: CombatRollResponse): void;
}) {
  const actions = useMemo(
    () => state.combatActions.filter((action) => action.applicableTokenIds.includes(attacker.id)),
    [attacker.id, state.combatActions],
  );
  const [actionId, setActionId] = useState(actions[0]?.id ?? "");
  const [rollMode, setRollMode] = useState<RollMode>("normal");
  const [alternateDamage, setAlternateDamage] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitArmed, setSubmitArmed] = useState(false);
  const [generic, setGeneric] = useState({
    name: "Attack", attackBonus: "0", count: "1", sides: "6", modifier: "0", damageType: "slashing",
  });
  const panelRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<CombatPanelPosition | null>(null);
  const selectedAction = actions.find((action) => action.id === actionId) ?? actions[0] ?? null;
  const genericAvailable = participant.role === "dm" && actions.length === 0;
  const bless = hasBless(attacker.effects);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>(
      ".combat-action-picker select, .combat-generic-form input, .combat-roll-submit",
    )?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setSubmitArmed(true));
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const container = panel?.parentElement;
    if (!panel || !container) return;

    const reposition = () => {
      const containerRect = container.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const next = calculateCombatPanelPosition({
        anchor,
        containerWidth: containerRect.width,
        containerHeight: containerRect.height,
        panelWidth: panelRect.width,
        panelHeight: panelRect.height,
        visibleTop: Math.max(0, -containerRect.top),
        visibleBottom: Math.min(containerRect.height, window.innerHeight - containerRect.top),
      });
      setPosition((current) => current &&
        current.left === next.left && current.top === next.top &&
        current.maxHeight === next.maxHeight && current.placement === next.placement
        ? current
        : next);
    };

    reposition();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(reposition);
    resizeObserver?.observe(container);
    resizeObserver?.observe(panel);
    window.addEventListener("resize", reposition);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", reposition);
    };
  }, [anchor]);

  const genericAction = (): CombatActionValues | null => {
    const attackBonus = Number(generic.attackBonus);
    const count = Number(generic.count);
    const sides = Number(generic.sides);
    const modifier = Number(generic.modifier);
    if (![attackBonus, count, sides, modifier].every(Number.isInteger)) return null;
    return {
      name: generic.name.trim() || "Attack",
      attackBonus,
      attackKind: "melee",
      damage: { count, sides: sides as 4 | 6 | 8 | 10 | 12 | 20, modifier },
      damageType: generic.damageType as CombatActionValues["damageType"],
      reachFeet: 5,
      rangeFeet: null,
      manualRider: false,
      manualRiderText: null,
      alternateDamage: null,
    };
  };

  const submit = async () => {
    const adHocAction = genericAvailable ? genericAction() : undefined;
    if (!selectedAction && !adHocAction) return;
    setPending(true);
    try {
      const response = await onRoll({
        operationId: crypto.randomUUID(),
        attackerTokenId: attacker.id,
        targetTokenId: target.id,
        actionProfileId: selectedAction?.id,
        adHocAction: adHocAction ?? undefined,
        rollMode,
        alternateDamage: selectedAction?.alternateDamage ? alternateDamage : undefined,
      });
      if (response) onComplete(response);
    } finally {
      setPending(false);
    }
  };

  return <section
    ref={panelRef}
    className={`combat-roll-panel${position ? ` is-${position.placement}` : ""}`}
    role="dialog"
    aria-label={`${attacker.name} attacks ${target.name}`}
    style={{
      left: position?.left ?? anchor.x,
      top: position?.top ?? anchor.y,
      maxHeight: position ? `${position.maxHeight}px` : undefined,
      visibility: position ? "visible" : "hidden",
    }}
  >
    <header><div><small>Attack</small><strong><span>{attacker.name}</span><b aria-hidden="true">→</b><span>{target.name}</span></strong></div><IconActionButton variant="close" label="Close attack chooser" onClick={onClose} /></header>
    <div className="combat-roll-panel-body">
      {actions.length ? <label className="combat-action-picker"><span>Action</span><select value={selectedAction?.id ?? ""} onChange={(event) => { setActionId(event.target.value); setAlternateDamage(false); }}>{actions.map((action) => <option key={action.id} value={action.id}>{action.name} · {action.attackBonus >= 0 ? "+" : ""}{action.attackBonus} · {formatDiceFormula(action.damage)}</option>)}</select></label> : null}
      {genericAvailable ? <fieldset className="combat-generic-form"><legend>Unsaved generic Attack</legend><label>Name<input value={generic.name} maxLength={64} onChange={(event) => setGeneric((current) => ({ ...current, name: event.target.value }))} /></label><label>Attack bonus<input type="number" min="-20" max="30" value={generic.attackBonus} onChange={(event) => setGeneric((current) => ({ ...current, attackBonus: event.target.value }))} /></label><label>Damage dice<span><input aria-label="Damage die count" type="number" min="0" max="20" value={generic.count} onChange={(event) => setGeneric((current) => ({ ...current, count: event.target.value }))} /><select aria-label="Damage die size" value={generic.sides} onChange={(event) => setGeneric((current) => ({ ...current, sides: event.target.value }))}>{SUPPORTED_DIE_SIDES.map((side) => <option key={side} value={side}>d{side}</option>)}</select></span></label><label>Modifier<input type="number" min="-50" max="100" value={generic.modifier} onChange={(event) => setGeneric((current) => ({ ...current, modifier: event.target.value }))} /></label><label>Damage type<select value={generic.damageType} onChange={(event) => setGeneric((current) => ({ ...current, damageType: event.target.value }))}>{DAMAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label></fieldset> : null}
      {!actions.length && !genericAvailable ? <p className="combat-empty">This attacker has no maintained combat actions.</p> : null}
      <div className="combat-roll-mode" role="radiogroup" aria-label="Roll mode"><span>Roll</span><div>{(["normal", "advantage", "disadvantage"] as RollMode[]).map((mode) => <label key={mode} className={rollMode === mode ? "is-selected" : ""}><input type="radio" name="roll-mode" checked={rollMode === mode} onChange={() => setRollMode(mode)} /><span>{mode}</span></label>)}</div></div>
      <div className="combat-roll-options">
        {selectedAction?.alternateDamage ? <label className="combat-alternate"><input type="checkbox" checked={alternateDamage} onChange={(event) => setAlternateDamage(event.target.checked)} />Use {selectedAction.alternateDamage.label} ({formatDiceFormula(selectedAction.alternateDamage.formula)})</label> : null}
        {bless ? <p className="combat-bless">Bless +1d4 automatic</p> : null}
      </div>
      {selectedAction?.manualRider ? <p className="combat-rider-warning"><strong>Additional effect:</strong> {selectedAction.manualRiderText}</p> : null}
    </div>
    <footer><button className="combat-roll-submit" type="button" disabled={!submitArmed || pending || (!selectedAction && !genericAvailable)} onClick={() => void submit()}>{pending ? "Rolling…" : "Roll attack"}</button></footer>
  </section>;
}
