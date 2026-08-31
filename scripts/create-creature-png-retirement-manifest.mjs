#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCreaturePngRetirementManifest } from "./lib/creature-png-retirement.mjs";

const [backupArgument, conversionManifestArgument, outputArgument] = process.argv.slice(2);
if (!backupArgument || !conversionManifestArgument || !outputArgument) {
  console.error("Usage: node scripts/create-creature-png-retirement-manifest.mjs backup-directory conversion-manifest.json output.json");
  process.exit(1);
}

const backupDirectory = resolve(backupArgument);
const conversionManifestPath = resolve(conversionManifestArgument);
const outputPath = resolve(outputArgument);
await verifyBackup(backupDirectory);
const manifest = await createCreaturePngRetirementManifest({ backupDirectory, conversionManifestPath });
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
console.log(`Wrote ${manifest.totals.candidateCount} retirement candidates to ${outputPath}.`);
console.log(`Original bytes: ${manifest.totals.originalBytes}; replacement bytes: ${manifest.totals.replacementBytes}.`);

function verifyBackup(path) {
  const verifier = fileURLToPath(new URL("./verify-production-backup.mjs", import.meta.url));
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [verifier, path], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`Backup verification failed with exit code ${code}.`)));
  });
}

