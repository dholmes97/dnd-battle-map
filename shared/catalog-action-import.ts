import { validateCombatActionValues, type CombatActionValues } from "./combat-rolling.ts";
import { MAX_COMBAT_ACTIONS_PER_OWNER } from "./resource-limits.ts";

export const MAX_CATALOG_ACTION_IMPORT_CREATURES = 10;

export type PreparedCatalogAction = {
  id: string;
  sourceActionIndex: number;
  sourceRef: string;
  values: CombatActionValues;
};

export type PreparedCatalogActionCreature = {
  creatureId: string;
  actions: PreparedCatalogAction[];
};

export type PreparedCatalogActionImport = {
  dryRun: boolean;
  creatures: PreparedCatalogActionCreature[];
};

export function validateCatalogActionImport(value: unknown): PreparedCatalogActionImport | null {
  if (!isRecord(value) || value.mode !== "replace" || typeof value.dryRun !== "boolean" ||
      !Array.isArray(value.creatures) || value.creatures.length < 1 ||
      value.creatures.length > MAX_CATALOG_ACTION_IMPORT_CREATURES) return null;
  const creatureIds = new Set<string>();
  const creatures: PreparedCatalogActionCreature[] = [];
  for (const rawCreature of value.creatures) {
    if (!isRecord(rawCreature) || !Array.isArray(rawCreature.actions) ||
        rawCreature.actions.length > MAX_COMBAT_ACTIONS_PER_OWNER) return null;
    const creatureId = cleanId(rawCreature.creatureId, 64);
    if (!creatureId || creatureIds.has(creatureId)) return null;
    creatureIds.add(creatureId);
    const actionIds = new Set<string>();
    const sourceIndexes = new Set<number>();
    const actions: PreparedCatalogAction[] = [];
    for (const rawAction of rawCreature.actions) {
      if (!isRecord(rawAction)) return null;
      const sourceActionIndex = Number(rawAction.sourceActionIndex);
      const sourceRef = cleanText(rawAction.sourceRef, 160);
      const values = validateCombatActionValues(rawAction.values ?? rawAction, { requireManualRiderText: true });
      if (!Number.isInteger(sourceActionIndex) || sourceActionIndex < 0 || sourceActionIndex > 999 ||
          sourceIndexes.has(sourceActionIndex) || !sourceRef || !values) return null;
      sourceIndexes.add(sourceActionIndex);
      const actionId = catalogActionId(creatureId, values.name, sourceActionIndex);
      if (actionIds.has(actionId)) return null;
      actionIds.add(actionId);
      actions.push({ id: actionId, sourceActionIndex, sourceRef, values });
    }
    actions.sort((left, right) => left.sourceActionIndex - right.sourceActionIndex || left.id.localeCompare(right.id));
    creatures.push({ creatureId, actions });
  }
  return { dryRun: value.dryRun, creatures };
}

export function catalogActionId(creatureId: string, name: string, sourceActionIndex: number): string {
  const actionSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "action";
  return `catalog-${creatureId}-${actionSlug}-${sourceActionIndex + 1}`.slice(0, 96);
}

function cleanId(value: unknown, maximum: number): string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value) && value.length <= maximum ? value : "";
}

function cleanText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
