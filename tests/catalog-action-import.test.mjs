import assert from "node:assert/strict";
import test from "node:test";

import { catalogActionId, validateCatalogActionImport } from "../shared/catalog-action-import.ts";

const action = {
  sourceActionIndex: 2,
  sourceRef: "srd-5.1:wolf#bite",
  values: {
    name: "Bite", attackBonus: 4, attackKind: "melee",
    damage: { count: 2, sides: 4, modifier: 2 }, damageType: "piercing",
    reachFeet: 5, rangeFeet: null, manualRider: true,
    manualRiderText: "The target must save or fall prone.", alternateDamage: null,
  },
};

test("catalog action imports require replacement mode and preserve stable source ordering", () => {
  const result = validateCatalogActionImport({
    mode: "replace", dryRun: true,
    creatures: [{ creatureId: "srd-wolf", actions: [action] }],
  });
  assert.equal(result?.dryRun, true);
  assert.equal(result?.creatures[0].actions[0].id, "catalog-srd-wolf-bite-3");
  assert.equal(result?.creatures[0].actions[0].values.manualRiderText, "The target must save or fall prone.");
  assert.equal(catalogActionId("srd-wolf", "Bite", 2), "catalog-srd-wolf-bite-3");
});

test("catalog action imports reject missing rider explanations and duplicate creatures", () => {
  const missingText = { ...action, values: { ...action.values, manualRiderText: null } };
  assert.equal(validateCatalogActionImport({
    mode: "replace", dryRun: true, creatures: [{ creatureId: "srd-wolf", actions: [missingText] }],
  }), null);
  assert.equal(validateCatalogActionImport({
    mode: "replace", dryRun: false,
    creatures: [{ creatureId: "srd-wolf", actions: [] }, { creatureId: "srd-wolf", actions: [] }],
  }), null);
});

test("catalog action imports allow an explicit empty replacement for unsupported creatures", () => {
  const result = validateCatalogActionImport({
    mode: "replace", dryRun: false, creatures: [{ creatureId: "srd-awakened-shrub", actions: [] }],
  });
  assert.deepEqual(result?.creatures[0].actions, []);
});
