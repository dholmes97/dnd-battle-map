import assert from "node:assert/strict";
import test from "node:test";

import {
  adjudicatedDamage,
  combatRollDisclosure,
  formatDiceFormula,
  hasBless,
  projectCombatDamageValues,
  projectCombatAttackDetails,
  projectDamageAdjudication,
  resolveAttack,
  transitionDamageWithTemporaryHp,
  validateCombatActionValues,
} from "../shared/combat-rolling.ts";

const damage = { count: 1, sides: 8, modifier: 5 };

test("normal, advantage, disadvantage, and Bless resolve deterministically", () => {
  const normal = resolveAttack({ rollMode: "normal", attackDice: [10], attackBonus: 4, targetArmorClass: 15, damageFormula: damage, damageDice: [6] });
  assert.equal(normal?.outcome, "miss");
  const advantage = resolveAttack({ rollMode: "advantage", attackDice: [4, 16], attackBonus: 4, blessDie: 3, targetArmorClass: 22, damageFormula: damage, damageDice: [5] });
  assert.deepEqual(advantage, {
    attackDice: [4, 16], keptD20: 16, attackBonus: 4, blessDie: 3, attackTotal: 23,
    outcome: "hit", damageDice: [5], damageModifier: 5, damageTotal: 10,
  });
  const disadvantage = resolveAttack({ rollMode: "disadvantage", attackDice: [18, 8], attackBonus: 5, blessDie: 2, targetArmorClass: 15, damageFormula: damage, damageDice: [1] });
  assert.equal(disadvantage?.keptD20, 8);
  assert.equal(disadvantage?.attackTotal, 15);
  assert.equal(disadvantage?.outcome, "hit");
});

test("natural one and twenty override totals while Bless never changes critical damage", () => {
  const one = resolveAttack({ rollMode: "normal", attackDice: [1], attackBonus: 30, blessDie: 4, targetArmorClass: 1, damageFormula: damage, damageDice: [8] });
  assert.equal(one?.outcome, "miss");
  const twenty = resolveAttack({ rollMode: "normal", attackDice: [20], attackBonus: -20, blessDie: 1, targetArmorClass: 40, damageFormula: damage, damageDice: [2, 7] });
  assert.equal(twenty?.outcome, "critical");
  assert.equal(twenty?.damageTotal, 14);
  assert.equal(twenty?.blessDie, 1);
});

test("a missing armor class produces a review outcome without leaking a guessed value", () => {
  const result = resolveAttack({ rollMode: "normal", attackDice: [12], attackBonus: 5, targetArmorClass: null, damageFormula: damage, damageDice: [3] });
  assert.equal(result?.outcome, "needs-ac");
});

test("Bless uses one canonical case-insensitive effect regardless of duplicates", () => {
  assert.equal(hasBless([{ name: " Bless " }, { name: "BLESS" }]), true);
  assert.equal(hasBless([{ name: "Haste" }]), false);
});

test("damage adjudication applies standard adjustments and rejects invalid values", () => {
  assert.equal(adjudicatedDamage({ rolledDamage: 11, method: "apply" }), 11);
  assert.equal(adjudicatedDamage({ rolledDamage: 11, method: "resistant" }), 5);
  assert.equal(adjudicatedDamage({ rolledDamage: 11, method: "vulnerable" }), 22);
  assert.equal(adjudicatedDamage({ rolledDamage: 11, method: "immune" }), 0);
  assert.equal(adjudicatedDamage({ rolledDamage: 11, method: "reject" }), 0);
  assert.equal(adjudicatedDamage({ rolledDamage: 11, method: "adjust", adjustedDamage: 7 }), 7);
  assert.equal(adjudicatedDamage({ rolledDamage: 11, method: "adjust" }), null);
});

test("player projections conceal private damage adjudication details", () => {
  const ruling = { status: "adjusted", adjudicationMethod: "adjust", adjudicationNote: "Ease the encounter" };
  assert.deepEqual(projectDamageAdjudication({ ...ruling, canSeePrivateAdjudication: false }), {
    status: "applied", adjudicationMethod: null, adjudicationNote: null,
  });
  assert.deepEqual(projectDamageAdjudication({ ...ruling, canSeePrivateAdjudication: true }), ruling);
  assert.equal(projectDamageAdjudication({
    status: "immune", adjudicationMethod: "immune", adjudicationNote: null, canSeePrivateAdjudication: false,
  }).status, "applied");
});

test("private DM attacks reveal only released verdicts and finalized damage to players", () => {
  assert.deepEqual(combatRollDisclosure({
    dmPrivate: true, viewerRole: "player", outcomeReleased: false, proposalStatus: null,
  }), {
    includeRoll: false,
    revealAttackDetails: false,
    includeDamageProposal: false,
    revealDamageDetails: false,
  });
  assert.deepEqual(combatRollDisclosure({
    dmPrivate: true, viewerRole: "player", outcomeReleased: true, proposalStatus: "pending",
  }), {
    includeRoll: true,
    revealAttackDetails: false,
    includeDamageProposal: false,
    revealDamageDetails: false,
  });
  assert.deepEqual(combatRollDisclosure({
    dmPrivate: true, viewerRole: "player", outcomeReleased: true, proposalStatus: "adjusted",
  }), {
    includeRoll: true,
    revealAttackDetails: false,
    includeDamageProposal: true,
    revealDamageDetails: true,
  });
  assert.deepEqual(combatRollDisclosure({
    dmPrivate: true, viewerRole: "dm", outcomeReleased: false, proposalStatus: "pending",
  }), {
    includeRoll: true,
    revealAttackDetails: true,
    includeDamageProposal: true,
    revealDamageDetails: true,
  });
});

test("private DM attack projections remove dice, modifiers, range, and additional effects", () => {
  const action = {
    name: "Bite", attackBonus: 8, attackKind: "melee",
    damage: { count: 2, sides: 6, modifier: 5 }, damageType: "piercing",
    reachFeet: 10, rangeFeet: null, manualRider: true,
    manualRiderText: "The target is grappled.",
    alternateDamage: { label: "Enraged", formula: { count: 3, sides: 6, modifier: 5 } },
  };
  const player = projectCombatAttackDetails({
    dmPrivate: true, viewerRole: "player", action,
    attackDice: [17], keptD20: 17, blessDie: 3, attackTotal: 28,
  });
  assert.deepEqual(player.attackDice, []);
  assert.equal(player.attackTotal, 0);
  assert.equal(player.action.attackBonus, 0);
  assert.deepEqual(player.action.damage, { count: 0, sides: 6, modifier: 0 });
  assert.equal(player.action.reachFeet, null);
  assert.equal(player.action.manualRider, false);
  assert.equal(player.action.manualRiderText, null);
  assert.equal(player.action.alternateDamage, null);

  const dm = projectCombatAttackDetails({
    dmPrivate: true, viewerRole: "dm", action,
    attackDice: [17], keptD20: 17, blessDie: 3, attackTotal: 28,
  });
  assert.deepEqual(dm, {
    action, attackDice: [17], keptD20: 17, blessDie: 3, attackTotal: 28,
  });
});

test("damage projections make the roll public without revealing private adjudication", () => {
  const ruling = {
    damageDice: [6, 5], rolledDamage: 14, finalDamage: 7, proposalStatus: "adjusted",
    canSeePrivateAdjudication: false,
  };
  assert.deepEqual(projectCombatDamageValues({ ...ruling, canSeeRolledDamage: true, controlsTarget: false }), {
    damageDice: [6, 5], damageTotal: 14, proposalRolledDamage: 14, proposalFinalDamage: null,
  });
  assert.deepEqual(projectCombatDamageValues({ ...ruling, canSeeRolledDamage: false, controlsTarget: false }), {
    damageDice: [], damageTotal: null, proposalRolledDamage: null, proposalFinalDamage: null,
  });
  assert.deepEqual(projectCombatDamageValues({
    ...ruling, finalDamage: null, proposalStatus: null,
    canSeePrivateAdjudication: true, canSeeRolledDamage: false, controlsTarget: false,
  }), {
    damageDice: [], damageTotal: null, proposalRolledDamage: null, proposalFinalDamage: null,
  });
  assert.deepEqual(projectCombatDamageValues({ ...ruling, canSeeRolledDamage: true, controlsTarget: true }), {
    damageDice: [6, 5], damageTotal: 14, proposalRolledDamage: 14, proposalFinalDamage: 7,
  });
  assert.deepEqual(projectCombatDamageValues({
    ...ruling, finalDamage: null, proposalStatus: "pending", canSeeRolledDamage: true, controlsTarget: true,
  }), {
    damageDice: [6, 5], damageTotal: 14, proposalRolledDamage: 14, proposalFinalDamage: null,
  });
  assert.deepEqual(projectCombatDamageValues({
    ...ruling, canSeePrivateAdjudication: true, canSeeRolledDamage: true, controlsTarget: false,
  }), {
    damageDice: [6, 5], damageTotal: 14, proposalRolledDamage: 14, proposalFinalDamage: 7,
  });
});

test("damage consumes temporary HP before current HP", () => {
  assert.deepEqual(transitionDamageWithTemporaryHp({ hp: 20, maxHp: 30, temporaryHp: 6, damage: 10 }), {
    hp: 16, temporaryHp: 0, hpDamage: 4, temporaryHpDamage: 6,
  });
  assert.deepEqual(transitionDamageWithTemporaryHp({ hp: 20, maxHp: 30, temporaryHp: 20, damage: 10 }), {
    hp: 20, temporaryHp: 10, hpDamage: 0, temporaryHpDamage: 10,
  });
});

test("combat action values are structured, bounded, and preserve manual riders", () => {
  const action = validateCombatActionValues({
    name: "  Longsword   +1 ", attackBonus: 9, attackKind: "melee",
    damage: { count: 1, sides: 8, modifier: 5 }, damageType: "slashing",
    reachFeet: 5, rangeFeet: null, manualRider: true,
    alternateDamage: { label: "Two-handed", formula: { count: 1, sides: 10, modifier: 5 } },
  });
  assert.equal(action?.name, "Longsword +1");
  assert.equal(action?.manualRider, true);
  assert.match(action?.manualRiderText ?? "", /Consult the source stat block/);
  assert.equal(validateCombatActionValues({
    ...action, manualRiderText: null,
  }, { requireManualRiderText: true }), null);
  assert.equal(formatDiceFormula(action.damage), "1d8+5");
  assert.equal(formatDiceFormula({ count: 0, sides: 4, modifier: 5 }), "5");
  assert.equal(validateCombatActionValues({ ...action, damage: "1d8+5" }), null);
});
