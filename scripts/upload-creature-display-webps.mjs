#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [manifestArgument] = process.argv.slice(2);
const token = process.env.CATALOG_IMPORT_TOKEN;
const siteUrl = (process.env.BATTLE_MAP_SITE_URL ?? "https://dnd.fridaylunchcrew.com").replace(/\/$/, "");
if (!manifestArgument || !token) {
  console.error("Usage: CATALOG_IMPORT_TOKEN=… node scripts/upload-creature-display-webps.mjs path/to/manifest.json");
  process.exit(1);
}

const manifestPath = resolve(manifestArgument);
const manifestDirectory = dirname(manifestPath);
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
if (manifest?.formatVersion !== 1 || manifest?.encoder?.format !== "webp" || !Array.isArray(manifest?.objects) ||
    manifest.objects.length < 1 || manifest.objects.length > 2_000 || manifest.totals?.failed !== 0) {
  throw new Error("The display-asset manifest is invalid or incomplete.");
}
const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
const progressPath = resolve(manifestDirectory, "upload-progress.json");
let completedKeys = new Set();
try {
  const progress = JSON.parse(await readFile(progressPath, "utf8"));
  if (progress.manifestSha256 === manifestSha256 && Array.isArray(progress.completedKeys)) completedKeys = new Set(progress.completedKeys);
} catch {
  completedKeys = new Set();
}

const pending = manifest.objects.filter((entry) => !completedKeys.has(entry.displayKey));
let uploaded = 0;
let reused = 0;
for (let offset = 0; offset < pending.length; offset += 10) {
  const batch = pending.slice(offset, offset + 10);
  const assets = await Promise.all(batch.map(async (entry) => {
    if (!entry.sourceKey.startsWith("creature-catalog/original/") || !entry.displayKey.startsWith("creature-catalog/display/")) {
      throw new Error(`Unsafe creature asset keys in manifest: ${entry.displayKey}`);
    }
    const relativeDisplayPath = entry.displayKey.slice("creature-catalog/display/".length);
    const path = resolve(manifestDirectory, "r2/creature-catalog/display", relativeDisplayPath);
    const bytes = await readFile(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== entry.displayBytes || sha256 !== entry.displaySha256) {
      throw new Error(`Staged display asset failed local verification: ${entry.displayKey}`);
    }
    return {
      sourceKey: entry.sourceKey.slice("creature-catalog/original/".length),
      width: entry.width,
      height: entry.height,
      sha256,
      imageBase64: bytes.toString("base64"),
    };
  }));
  const response = await fetchWithRetry(`${siteUrl}/api/catalog/assets/display/import`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ assets }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Display-asset upload failed (${response.status}): ${result.error ?? "Unknown error"}`);
  if (!Array.isArray(result.assets) || result.assets.length !== batch.length) throw new Error("Display-asset upload returned an incomplete receipt.");
  for (const entry of batch) {
    const receipt = result.assets.find((asset) => asset.displayKey === entry.displayKey);
    if (!receipt || receipt.sha256 !== entry.displaySha256 || receipt.byteLength !== entry.displayBytes) {
      throw new Error(`Display-asset receipt did not match ${entry.displayKey}.`);
    }
    completedKeys.add(entry.displayKey);
  }
  uploaded += Number(result.imported) || 0;
  reused += Number(result.reused) || 0;
  await writeFile(progressPath, `${JSON.stringify({
    manifestSha256,
    updatedAt: new Date().toISOString(),
    completedKeys: [...completedKeys].sort(),
    lastTotal: result.total,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(`Uploaded ${completedKeys.size}/${manifest.objects.length}`);
}

const summaryResponse = await fetchWithRetry(`${siteUrl}/api/catalog/assets/display/import`, {
  headers: { authorization: `Bearer ${token}` },
});
const summary = await summaryResponse.json();
if (!summaryResponse.ok) throw new Error(`Could not verify display-asset totals (${summaryResponse.status}).`);
if (summary.objectCount !== manifest.objects.length || summary.byteCount !== manifest.totals.displayBytes) {
  throw new Error(`Production display-asset totals do not match the manifest: ${JSON.stringify(summary)}.`);
}
console.log(JSON.stringify({ uploaded, reused, verified: summary }, null, 2));

async function fetchWithRetry(url, init) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(url, init);
    if (response.status !== 429 && response.status !== 409 && response.status < 500) return response;
    if (attempt === 7) return response;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : Math.min(8_000, 500 * 2 ** attempt);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
  }
  throw new Error("Display-asset upload retry loop ended unexpectedly.");
}
