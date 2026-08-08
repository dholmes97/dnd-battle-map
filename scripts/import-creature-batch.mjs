import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const [, , manifestArgument] = process.argv;
const token = process.env.CATALOG_IMPORT_TOKEN;
const siteUrl = (process.env.BATTLE_MAP_SITE_URL ?? "https://dnd-battle-map-poc.danholmes346.chatgpt.site").replace(/\/$/, "");

if (!manifestArgument || !token) {
  console.error("Usage: CATALOG_IMPORT_TOKEN=… node scripts/import-creature-batch.mjs path/to/batch.json");
  process.exitCode = 1;
} else {
  const manifestPath = resolve(manifestArgument);
  const manifestDirectory = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.creatures) || manifest.creatures.length < 1 || manifest.creatures.length > 10) {
    throw new Error("A batch manifest must contain one to ten creatures.");
  }
  const creatures = await Promise.all(manifest.creatures.map(async (creature) => ({
    ...creature,
    imageBase64: (await readFile(resolve(manifestDirectory, creature.image))).toString("base64"),
    thumbnailBase64: (await readFile(resolve(manifestDirectory, creature.thumbnail))).toString("base64"),
  })));
  const response = await fetch(`${siteUrl}/api/catalog/import`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ creatures }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Catalog import failed (${response.status}): ${result.error ?? "Unknown error"}`);
  console.log(JSON.stringify(result, null, 2));
}
