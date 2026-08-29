import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const argumentsList = process.argv.slice(2);
const apply = argumentsList.includes("--apply");
const manifestArgument = argumentsList.find((argument) => !argument.startsWith("--"));
const token = process.env.CATALOG_IMPORT_TOKEN;
const siteUrl = (process.env.BATTLE_MAP_SITE_URL ?? "https://dnd.fridaylunchcrew.com").replace(/\/$/, "");

if (!manifestArgument || !token) {
  console.error("Usage: CATALOG_IMPORT_TOKEN=… node scripts/import-creature-actions.mjs path/to/manifest.json [--apply]");
  process.exitCode = 1;
} else {
  const manifestPath = resolve(manifestArgument);
  const manifestDirectory = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.batches) || manifest.batches.length < 1) {
    throw new Error("The action manifest must list at least one batch.");
  }
  const batches = [];
  for (const entry of manifest.batches) {
    const batchPath = resolve(manifestDirectory, entry.filename);
    const bytes = await readFile(batchPath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== entry.sha256) throw new Error(`Checksum mismatch for ${entry.filename}.`);
    const batch = JSON.parse(bytes.toString("utf8"));
    if (!Array.isArray(batch.creatures) || batch.creatures.length < 1 || batch.creatures.length > 10) {
      throw new Error(`${entry.filename} must contain one to ten creatures.`);
    }
    batches.push({ filename: entry.filename, creatures: batch.creatures });
  }

  const submit = async (batch, dryRun) => {
    const payload = {
      mode: "replace",
      dryRun,
      creatures: batch.creatures.map((creature) => ({
        creatureId: creature.creatureId,
        actions: creature.actions.map((action) => ({
          sourceActionIndex: action.sourceActionIndex,
          sourceRef: action.sourceRef,
          values: {
            name: action.name,
            attackBonus: action.attackBonus,
            attackKind: action.attackKind,
            damage: action.damage,
            damageType: action.damageType,
            reachFeet: action.reachFeet,
            rangeFeet: action.rangeFeet,
            manualRider: action.manualRider,
            manualRiderText: action.manualRiderText,
            alternateDamage: action.alternateDamage,
          },
        })),
      })),
    };
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const response = await fetch(`${siteUrl}/api/catalog/actions/import`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) return result;
      if (response.status !== 429 && result.code !== "operation_in_progress") {
        throw new Error(`${batch.filename} failed (${response.status}): ${result.error ?? "Unknown error"}`);
      }
      const retryAfterSeconds = Math.max(1, Number(response.headers.get("retry-after")) || 5);
      await new Promise((resolveWait) => setTimeout(resolveWait, retryAfterSeconds * 1_000));
    }
    throw new Error(`${batch.filename} remained rate-limited or busy after bounded retries.`);
  };

  let checkedCreatures = 0;
  let checkedActions = 0;
  for (const batch of batches) {
    const result = await submit(batch, true);
    checkedCreatures += result.creatureCount;
    checkedActions += result.actionCount;
    console.log(`Checked ${batch.filename}: ${result.creatureCount} creatures, ${result.actionCount} actions`);
  }
  if (checkedCreatures !== manifest.creatureCount || checkedActions !== manifest.actionCount) {
    throw new Error(`Dry-run totals ${checkedCreatures}/${checkedActions} do not match manifest ${manifest.creatureCount}/${manifest.actionCount}.`);
  }

  if (apply) {
    let importedCreatures = 0;
    let importedActions = 0;
    for (const batch of batches) {
      const result = await submit(batch, false);
      importedCreatures += result.creatureCount;
      importedActions += result.actionCount;
      console.log(`Imported ${batch.filename}: ${result.creatureCount} creatures, ${result.actionCount} actions`);
    }
    if (importedCreatures !== manifest.creatureCount || importedActions !== manifest.actionCount) {
      throw new Error(`Import totals ${importedCreatures}/${importedActions} do not match the manifest.`);
    }
    console.log(`Imported ${importedActions} actions for ${importedCreatures} creatures.`);
  } else {
    console.log(`Dry run passed for ${checkedActions} actions across ${checkedCreatures} creatures. Use --apply only after a verified production backup.`);
  }
}
