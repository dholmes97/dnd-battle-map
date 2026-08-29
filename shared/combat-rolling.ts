import type { SharedEffect } from "./contracts.ts";

export const COMBAT_ROLLING_MODES = ["off", "qa", "all"] as const;
export type CombatRollingMode = (typeof COMBAT_ROLLING_MODES)[number];

export const ROLL_MODES = ["normal", "advantage", "disadvantage"] as const;
export type RollMode = (typeof ROLL_MODES)[number];

export const ATTACK_KINDS = ["melee", "ranged"] as const;
export type AttackKind = (typeof ATTACK_KINDS)[number];

export const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder", "untyped",
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export const SUPPORTED_DIE_SIDES = [4, 6, 8, 10, 12, 20] as const;
export type SupportedDieSides = (typeof SUPPORTED_DIE_SIDES)[number];

export type DiceFormula = {
  count: number;
  sides: SupportedDieSides;
  modifier: number;
};

export type AlternateDamage = {
  label: string;
  formula: DiceFormula;
};

export type CombatActionValues = {
  name: string;
  attackBonus: number;
  attackKind: AttackKind;
  damage: DiceFormula;
  damageType: DamageType;
  reachFeet: number | null;
  rangeFeet: number | null;
  manualRider: boolean;
  manualRiderText: string | null;
  alternateDamage: AlternateDamage | null;
};

export type CombatActionProfile = CombatActionValues & {
  id: string;
  ownerType: "character" | "creature";
  ownerId: string;
  applicableTokenIds: string[];
  source: "character" | "creature-catalog";
  enabled: boolean;
  sortOrder: number;
};

export type AttackResolution = {
  attackDice: number[];
  keptD20: number;
  attackBonus: number;
  blessDie: number | null;
  attackTotal: number;
  outcome: "miss" | "hit" | "critical" | "needs-ac";
  damageDice: number[];
  damageModifier: number;
  damageTotal: number;
};

export type DamageAdjudication = "apply" | "resistant" | "vulnerable" | "immune" | "adjust" | "reject" | "cancel";
export type DamageProposalStatus = "pending" | "applied" | "adjusted" | "immune" | "rejected" | "cancelled";

export function projectDamageAdjudication(input: {
  status: DamageProposalStatus;
  adjudicationMethod: DamageAdjudication | null;
  adjudicationNote: string | null;
  canSeePrivateAdjudication: boolean;
}): Pick<typeof input, "status" | "adjudicationMethod" | "adjudicationNote"> {
  if (input.canSeePrivateAdjudication) return {
    status: input.status,
    adjudicationMethod: input.adjudicationMethod,
    adjudicationNote: input.adjudicationNote,
  };
  return {
    status: input.status === "adjusted" || input.status === "immune" ? "applied" : input.status,
    adjudicationMethod: null,
    adjudicationNote: null,
  };
}

export function projectCombatDamageValues(input: {
  damageDice: readonly number[];
  rolledDamage: number;
  finalDamage: number | null;
  proposalStatus: DamageProposalStatus | null;
  canSeePrivateAdjudication: boolean;
  initiatedRoll: boolean;
  controlsTarget: boolean;
}): {
  damageDice: number[];
  damageTotal: number | null;
  proposalRolledDamage: number | null;
  proposalFinalDamage: number | null;
} {
  if (input.canSeePrivateAdjudication) return {
    damageDice: [...input.damageDice],
    damageTotal: input.rolledDamage,
    proposalRolledDamage: input.rolledDamage,
    proposalFinalDamage: input.finalDamage,
  };
  if (input.initiatedRoll) return {
    damageDice: [...input.damageDice],
    damageTotal: input.rolledDamage,
    proposalRolledDamage: input.rolledDamage,
    proposalFinalDamage: null,
  };
  const appliedDamage = input.controlsTarget && input.proposalStatus !== null && input.proposalStatus !== "pending"
    ? input.finalDamage
    : null;
  return {
    damageDice: [],
    damageTotal: appliedDamage,
    proposalRolledDamage: appliedDamage,
    proposalFinalDamage: appliedDamage,
  };
}

export function parseCombatRollingMode(value: unknown): CombatRollingMode {
  return value === "qa" || value === "all" ? value : "off";
}

export function combatRollingEnabled(mode: CombatRollingMode, isQaCampaign: boolean): boolean {
  return mode === "all" || (mode === "qa" && isQaCampaign);
}

export function normalizeEffectName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function hasBless(effects: readonly Pick<SharedEffect, "name">[]): boolean {
  return effects.some((effect) => normalizeEffectName(effect.name) === "bless");
}

export function d20CountForMode(mode: RollMode): number {
  return mode === "normal" ? 1 : 2;
}

export function keptD20ForMode(mode: RollMode, dice: readonly number[]): number | null {
  const expected = d20CountForMode(mode);
  if (dice.length !== expected || dice.some((die) => !integerBetween(die, 1, 20))) return null;
  return mode === "advantage" ? Math.max(...dice)
    : mode === "disadvantage" ? Math.min(...dice)
      : dice[0];
}

export function damageDiceCount(formula: DiceFormula, critical: boolean): number {
  return formula.count * (critical ? 2 : 1);
}

export function resolveAttack(input: {
  rollMode: RollMode;
  attackDice: readonly number[];
  attackBonus: number;
  blessDie?: number | null;
  targetArmorClass: number | null;
  damageFormula: DiceFormula;
  damageDice: readonly number[];
}): AttackResolution | null {
  const keptD20 = keptD20ForMode(input.rollMode, input.attackDice);
  if (keptD20 === null || !integerBetween(input.attackBonus, -20, 30)) return null;
  const blessDie = input.blessDie ?? null;
  if (blessDie !== null && !integerBetween(blessDie, 1, 4)) return null;
  const critical = keptD20 === 20;
  const expectedDamageDice = damageDiceCount(input.damageFormula, critical);
  if (!validDiceFormula(input.damageFormula) || input.damageDice.length !== expectedDamageDice ||
      input.damageDice.some((die) => !integerBetween(die, 1, input.damageFormula.sides))) return null;
  const attackTotal = keptD20 + input.attackBonus + (blessDie ?? 0);
  const damageTotal = Math.max(0, input.damageDice.reduce((sum, die) => sum + die, 0) + input.damageFormula.modifier);
  const outcome = keptD20 === 1
    ? "miss"
    : critical
      ? "critical"
      : input.targetArmorClass === null
        ? "needs-ac"
        : attackTotal >= input.targetArmorClass
          ? "hit"
          : "miss";
  return {
    attackDice: [...input.attackDice],
    keptD20,
    attackBonus: input.attackBonus,
    blessDie,
    attackTotal,
    outcome,
    damageDice: [...input.damageDice],
    damageModifier: input.damageFormula.modifier,
    damageTotal,
  };
}

export function adjudicatedDamage(input: {
  rolledDamage: number;
  method: DamageAdjudication;
  adjustedDamage?: number;
}): number | null {
  if (!integerBetween(input.rolledDamage, 0, 1_000)) return null;
  switch (input.method) {
    case "apply": return input.rolledDamage;
    case "resistant": return Math.floor(input.rolledDamage / 2);
    case "vulnerable": return Math.min(1_000, input.rolledDamage * 2);
    case "immune":
    case "reject":
    case "cancel": return 0;
    case "adjust": return integerBetween(input.adjustedDamage, 0, 1_000) ? input.adjustedDamage! : null;
  }
}

export function transitionDamageWithTemporaryHp(input: {
  hp: number | null;
  maxHp: number;
  temporaryHp: number;
  damage: number;
}): { hp: number; temporaryHp: number; hpDamage: number; temporaryHpDamage: number } | null {
  if (!integerBetween(input.maxHp, 1, 100_000) || !integerBetween(input.temporaryHp, 0, 100_000) ||
      !integerBetween(input.damage, 0, 1_000)) return null;
  const currentHp = input.hp === null ? input.maxHp : Math.min(input.maxHp, Math.max(0, Math.trunc(input.hp)));
  const temporaryHpDamage = Math.min(input.temporaryHp, input.damage);
  const hpDamage = Math.min(currentHp, input.damage - temporaryHpDamage);
  return {
    hp: currentHp - hpDamage,
    temporaryHp: input.temporaryHp - temporaryHpDamage,
    hpDamage,
    temporaryHpDamage,
  };
}

export const LEGACY_MANUAL_RIDER_TEXT = "Consult the source stat block for this attack's additional effects.";

export function validateCombatActionValues(
  value: unknown,
  options: { requireManualRiderText?: boolean } = {},
): CombatActionValues | null {
  if (!isRecord(value)) return null;
  const name = cleanText(value.name, 64);
  const attackBonus = integer(value.attackBonus);
  const attackKind = value.attackKind === "melee" || value.attackKind === "ranged" ? value.attackKind : null;
  const damage = validateDiceFormula(value.damage);
  const damageType = DAMAGE_TYPES.includes(value.damageType as DamageType) ? value.damageType as DamageType : null;
  const reachFeet = nullableBoundedInteger(value.reachFeet, 0, 1_000);
  const rangeFeet = nullableBoundedInteger(value.rangeFeet, 0, 10_000);
  const manualRider = typeof value.manualRider === "boolean" ? value.manualRider : null;
  const suppliedManualRiderText = value.manualRiderText === null || value.manualRiderText === undefined
    ? null
    : cleanText(value.manualRiderText, 320);
  const manualRiderText = manualRider
    ? suppliedManualRiderText || (options.requireManualRiderText ? null : LEGACY_MANUAL_RIDER_TEXT)
    : null;
  const alternateDamage = value.alternateDamage === null || value.alternateDamage === undefined
    ? null
    : validateAlternateDamage(value.alternateDamage);
  if (!name || !integerBetween(attackBonus, -20, 30) || !attackKind || !damage || !damageType ||
      reachFeet === undefined || rangeFeet === undefined || manualRider === null ||
      (manualRider && !manualRiderText) ||
      (value.alternateDamage !== null && value.alternateDamage !== undefined && !alternateDamage)) return null;
  return { name, attackBonus, attackKind, damage, damageType, reachFeet, rangeFeet, manualRider, manualRiderText, alternateDamage };
}

export function validateDiceFormula(value: unknown): DiceFormula | null {
  if (!isRecord(value)) return null;
  const count = integer(value.count);
  const sides = integer(value.sides);
  const modifier = integer(value.modifier);
  if (!integerBetween(count, 0, 20) || !SUPPORTED_DIE_SIDES.includes(sides as SupportedDieSides) ||
      !integerBetween(modifier, -50, 100) || (count === 0 && modifier < 0)) return null;
  return { count, sides: sides as SupportedDieSides, modifier };
}

export function validDiceFormula(value: DiceFormula): boolean {
  return validateDiceFormula(value) !== null;
}

export function formatDiceFormula(formula: DiceFormula): string {
  if (formula.count === 0) return String(formula.modifier);
  const modifier = formula.modifier === 0 ? "" : formula.modifier > 0 ? `+${formula.modifier}` : String(formula.modifier);
  return `${formula.count}d${formula.sides}${modifier}`;
}

function validateAlternateDamage(value: unknown): AlternateDamage | null {
  if (!isRecord(value)) return null;
  const label = cleanText(value.label, 32);
  const formula = validateDiceFormula(value.formula);
  return label && formula ? { label, formula } : null;
}

function nullableBoundedInteger(value: unknown, min: number, max: number): number | null | undefined {
  if (value === null || value === undefined) return null;
  const parsed = integer(value);
  return integerBetween(parsed, min, max) ? parsed : undefined;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return cleaned || null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function integerBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
