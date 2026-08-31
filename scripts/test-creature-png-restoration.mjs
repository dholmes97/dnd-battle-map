#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDirectoryRestoreStorage,
  restoreCreaturePngRetirement,
  validateCreaturePngRetirementManifest,
} from "./lib/creature-png-retirement.mjs";

const [backupArgument, manifestArgument, targetArgument] = process.argv.slice(2);
if (!backupArgument || !manifestArgument || !targetArgument) {
  console.error("Usage: node scripts/test-creature-png-restoration.mjs backup-directory retirement-manifest.json new-target-directory");
  process.exit(1);
}

const backupDirectory = resolve(backupArgument);
const manifestPath = resolve(manifestArgument);
const targetDirectory = resolve(targetArgument);
await verifyBackup(backupDirectory);
const manifest = validateCreaturePngRetirementManifest(JSON.parse(await readFile(manifestPath, "utf8")));
await mkdir(targetDirectory, { recursive: false, mode: 0o700 });
const result = await restoreCreaturePngRetirement({
  backupDirectory,
  manifest,
  storage: createDirectoryRestoreStorage(targetDirectory),
});
const receipt = {
  formatVersion: 1,
  operation: "test-creature-catalog-original-png-restoration",
  completedAt: new Date().toISOString(),
  sourceManifest: manifestPath,
  ...result,
};
const receiptPath = resolve(targetDirectory, "RESTORE-COMPLETE.json");
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
console.log(`Restoration test complete: ${result.restoredCount} objects (${result.restoredBytes} bytes).`);
console.log(`Receipt: ${receiptPath}`);

function verifyBackup(path) {
  const verifier = fileURLToPath(new URL("./verify-production-backup.mjs", import.meta.url));
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [verifier, path], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`Backup verification failed with exit code ${code}.`)));
  });
}
