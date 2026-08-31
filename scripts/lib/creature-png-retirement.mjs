import { createHash } from "node:crypto";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { inspectCatalogPng, inspectCatalogWebp } from "../../shared/catalog-image.ts";

export const CREATURE_PNG_RETIREMENT_OPERATION = "retire-creature-catalog-original-pngs";
export const CREATURE_ORIGINAL_PREFIX = "creature-catalog/original/";
export const CREATURE_DISPLAY_PREFIX = "creature-catalog/display/";

const ORIGINAL_KEY_PATTERN = /^creature-catalog\/original\/tokens\/(?:catalog|creatures|monsters)\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.png$/;
const DISPLAY_KEY_PATTERN = /^creature-catalog\/display\/tokens\/(?:catalog|creatures|monsters)\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.webp$/;
const CREATURE_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export async function createCreaturePngRetirementManifest({
  backupDirectory,
  conversionManifestPath,
  generatedAt = new Date().toISOString(),
}) {
  const backupRoot = resolve(backupDirectory);
  const backupManifestPath = resolve(backupRoot, "manifest.json");
  const backupManifestBytes = await readFile(backupManifestPath);
  const backupManifest = parseJson(backupManifestBytes, "production backup manifest");
  const conversionManifest = parseJson(
    await readFile(resolve(conversionManifestPath)),
    "creature WebP conversion manifest",
  );
  validateBackupManifest(backupManifest);
  validateConversionManifest(conversionManifest);

  const [catalogRows, variantRows] = await Promise.all([
    readNdjson(resolve(backupRoot, "d1/tables/creature_catalog.ndjson")),
    readNdjson(resolve(backupRoot, "d1/tables/creature_asset_variants.ndjson")),
  ]);
  const catalogByTokenAsset = new Map(catalogRows.map((row) => [row.token_asset, row]));
  const variantsByKey = new Map(variantRows
    .filter((row) => row.variant === "display" && Number(row.version) === 1)
    .map((row) => [row.r2_key, row]));
  const objectsByKey = new Map(backupManifest.r2.objects.map((object) => [object.key, object]));
  const candidates = [];

  for (const conversion of conversionManifest.objects) {
    validateConversionEntry(conversion);
    const originalObject = objectsByKey.get(conversion.sourceKey);
    const displayObject = objectsByKey.get(conversion.displayKey);
    const relativeSourceKey = conversion.sourceKey.slice(CREATURE_ORIGINAL_PREFIX.length);
    const catalog = catalogByTokenAsset.get(`/creature-assets/${relativeSourceKey}`);
    const variant = variantsByKey.get(conversion.displayKey);
    if (!originalObject || !displayObject || !catalog || !variant) {
      throw new Error(`Retirement evidence is incomplete for ${conversion.sourceKey}.`);
    }
    if (variant.creature_catalog_id !== catalog.id || variant.r2_key !== conversion.displayKey ||
        Number(variant.byte_length) !== conversion.displayBytes || variant.sha256 !== conversion.displaySha256) {
      throw new Error(`Display variant metadata does not match ${conversion.displayKey}.`);
    }
    assertObjectMatches(originalObject, conversion.sourceBytes, conversion.sourceSha256, "original");
    assertObjectMatches(displayObject, conversion.displayBytes, conversion.displaySha256, "display");
    const [originalBytes, displayBytes] = await Promise.all([
      readVerifiedBackupObject(backupRoot, originalObject),
      readVerifiedBackupObject(backupRoot, displayObject),
    ]);
    if (!inspectCatalogPng(originalBytes, "original")) {
      throw new Error(`Retirement source is not a valid catalog PNG: ${conversion.sourceKey}.`);
    }
    if (!inspectCatalogWebp(displayBytes)) {
      throw new Error(`Retirement replacement is not a valid catalog WebP: ${conversion.displayKey}.`);
    }
    candidates.push({
      creatureId: catalog.id,
      original: {
        key: conversion.sourceKey,
        byteLength: conversion.sourceBytes,
        sha256: conversion.sourceSha256,
      },
      replacement: {
        key: conversion.displayKey,
        byteLength: conversion.displayBytes,
        sha256: conversion.displaySha256,
      },
    });
  }
  candidates.sort((left, right) => left.original.key.localeCompare(right.original.key));
  const manifest = {
    formatVersion: 1,
    operation: CREATURE_PNG_RETIREMENT_OPERATION,
    generatedAt,
    source: {
      siteUrl: backupManifest.source.siteUrl,
      projectId: backupManifest.source.projectId,
      snapshot: backupRoot.split(sep).at(-1),
      backupCompletedAt: backupManifest.completedAt,
      backupManifestSha256: sha256Bytes(backupManifestBytes),
      conversionManifestSha256: sha256Bytes(await readFile(resolve(conversionManifestPath))),
    },
    scope: {
      allowedPrefix: CREATURE_ORIGINAL_PREFIX,
      protectedPrefixes: [
        "creature-catalog/thumbnails/",
        "scenario-provisioning/",
        "handouts/",
      ],
    },
    totals: {
      candidateCount: candidates.length,
      originalBytes: candidates.reduce((sum, candidate) => sum + candidate.original.byteLength, 0),
      replacementBytes: candidates.reduce((sum, candidate) => sum + candidate.replacement.byteLength, 0),
    },
    candidates,
  };
  validateCreaturePngRetirementManifest(manifest);
  if (manifest.totals.candidateCount !== conversionManifest.totals.converted ||
      manifest.totals.candidateCount !== conversionManifest.totals.discovered ||
      conversionManifest.totals.failed !== 0) {
    throw new Error("The retirement manifest does not cover the complete successful conversion set.");
  }
  return manifest;
}

export function validateCreaturePngRetirementManifest(manifest) {
  if (!manifest || manifest.formatVersion !== 1 || manifest.operation !== CREATURE_PNG_RETIREMENT_OPERATION ||
      !Array.isArray(manifest.candidates) || manifest.candidates.length < 1 || manifest.candidates.length > 2_000) {
    throw new Error("Invalid creature PNG retirement manifest.");
  }
  if (manifest.scope?.allowedPrefix !== CREATURE_ORIGINAL_PREFIX ||
      !Array.isArray(manifest.scope?.protectedPrefixes) ||
      !manifest.scope.protectedPrefixes.includes("creature-catalog/thumbnails/") ||
      !manifest.scope.protectedPrefixes.includes("scenario-provisioning/")) {
    throw new Error("The retirement manifest does not preserve protected asset namespaces.");
  }
  if (!SHA256_PATTERN.test(manifest.source?.backupManifestSha256 ?? "") ||
      !SHA256_PATTERN.test(manifest.source?.conversionManifestSha256 ?? "")) {
    throw new Error("The retirement manifest is not bound to verified source manifests.");
  }
  const originalKeys = new Set();
  const replacementKeys = new Set();
  let originalBytes = 0;
  let replacementBytes = 0;
  for (const candidate of manifest.candidates) {
    if (!candidate || !CREATURE_ID_PATTERN.test(candidate.creatureId ?? "") ||
        !ORIGINAL_KEY_PATTERN.test(candidate.original?.key ?? "") ||
        !DISPLAY_KEY_PATTERN.test(candidate.replacement?.key ?? "") ||
        candidate.replacement.key !== replacementKeyFor(candidate.original.key) ||
        !safeByteLength(candidate.original.byteLength) || !safeByteLength(candidate.replacement.byteLength) ||
        !SHA256_PATTERN.test(candidate.original.sha256 ?? "") ||
        !SHA256_PATTERN.test(candidate.replacement.sha256 ?? "") ||
        originalKeys.has(candidate.original.key) || replacementKeys.has(candidate.replacement.key)) {
      throw new Error("The retirement manifest contains an invalid or duplicate candidate.");
    }
    if (manifest.scope.protectedPrefixes.some((prefix) => candidate.original.key.startsWith(prefix))) {
      throw new Error(`The retirement manifest includes a protected object: ${candidate.original.key}.`);
    }
    originalKeys.add(candidate.original.key);
    replacementKeys.add(candidate.replacement.key);
    originalBytes += candidate.original.byteLength;
    replacementBytes += candidate.replacement.byteLength;
  }
  if (manifest.totals?.candidateCount !== manifest.candidates.length ||
      manifest.totals?.originalBytes !== originalBytes ||
      manifest.totals?.replacementBytes !== replacementBytes) {
    throw new Error("The retirement manifest totals do not match its candidates.");
  }
  return manifest;
}

export async function restoreCreaturePngRetirement({ backupDirectory, manifest, storage }) {
  validateCreaturePngRetirementManifest(manifest);
  if (!storage || typeof storage.put !== "function" || typeof storage.head !== "function") {
    throw new Error("Restoration requires storage with put and head operations.");
  }
  const backupRoot = resolve(backupDirectory);
  const backupManifestBytes = await readFile(resolve(backupRoot, "manifest.json"));
  if (sha256Bytes(backupManifestBytes) !== manifest.source.backupManifestSha256) {
    throw new Error("The selected backup does not match the retirement manifest.");
  }
  const backupManifest = parseJson(backupManifestBytes, "production backup manifest");
  validateBackupManifest(backupManifest);
  const objectsByKey = new Map(backupManifest.r2.objects.map((object) => [object.key, object]));
  let restoredBytes = 0;
  for (const candidate of manifest.candidates) {
    const object = objectsByKey.get(candidate.original.key);
    if (!object) throw new Error(`The backup is missing ${candidate.original.key}.`);
    assertObjectMatches(object, candidate.original.byteLength, candidate.original.sha256, "restore source");
    const bytes = await readVerifiedBackupObject(backupRoot, object);
    if (!inspectCatalogPng(bytes, "original")) {
      throw new Error(`The restore source is not a valid catalog PNG: ${candidate.original.key}.`);
    }
    await storage.put(candidate.original.key, bytes, {
      contentType: "image/png",
      cacheControl: "public, max-age=31536000, immutable",
      sha256: candidate.original.sha256,
    });
    const restored = await storage.head(candidate.original.key);
    if (!restored || restored.byteLength !== candidate.original.byteLength || restored.sha256 !== candidate.original.sha256) {
      throw new Error(`Restored object failed verification: ${candidate.original.key}.`);
    }
    restoredBytes += candidate.original.byteLength;
  }
  return { restoredCount: manifest.candidates.length, restoredBytes };
}

export function createDirectoryRestoreStorage(rootDirectory) {
  const root = resolve(rootDirectory);
  return {
    async put(key, bytes) {
      const path = safeObjectPath(root, key);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const file = await open(path, "wx", 0o600);
      try {
        await file.writeFile(bytes);
      } finally {
        await file.close();
      }
    },
    async head(key) {
      const path = safeObjectPath(root, key);
      try {
        const file = await stat(path);
        return { byteLength: file.size, sha256: sha256Bytes(await readFile(path)) };
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    },
  };
}

function validateBackupManifest(manifest) {
  if (manifest?.formatVersion !== 1 || !manifest.source?.siteUrl || !manifest.source?.projectId ||
      !manifest.completedAt || !Array.isArray(manifest.r2?.objects)) {
    throw new Error("Invalid production backup manifest.");
  }
}

function validateConversionManifest(manifest) {
  if (manifest?.formatVersion !== 1 || manifest.encoder?.format !== "webp" ||
      !Array.isArray(manifest.objects) || manifest.objects.length < 1 || manifest.totals?.failed !== 0) {
    throw new Error("Invalid creature WebP conversion manifest.");
  }
}

function validateConversionEntry(entry) {
  if (!entry || !ORIGINAL_KEY_PATTERN.test(entry.sourceKey ?? "") ||
      !DISPLAY_KEY_PATTERN.test(entry.displayKey ?? "") ||
      entry.displayKey !== replacementKeyFor(entry.sourceKey) ||
      !safeByteLength(entry.sourceBytes) || !safeByteLength(entry.displayBytes) ||
      !SHA256_PATTERN.test(entry.sourceSha256 ?? "") || !SHA256_PATTERN.test(entry.displaySha256 ?? "")) {
    throw new Error("The conversion manifest contains an invalid retirement candidate.");
  }
}

function replacementKeyFor(originalKey) {
  return `${CREATURE_DISPLAY_PREFIX}${originalKey.slice(CREATURE_ORIGINAL_PREFIX.length).replace(/\.png$/i, ".webp")}`;
}

function assertObjectMatches(object, byteLength, sha256, label) {
  if (Number(object.size) !== byteLength || object.sha256 !== sha256) {
    throw new Error(`The ${label} object metadata does not match ${object.key}.`);
  }
}

async function readVerifiedBackupObject(backupRoot, object) {
  const path = safeBackupPath(backupRoot, object.path);
  const bytes = await readFile(path);
  if (bytes.byteLength !== Number(object.size) || sha256Bytes(bytes) !== object.sha256) {
    throw new Error(`Backup object failed verification: ${object.key}.`);
  }
  return bytes;
}

async function readNdjson(path) {
  const text = await readFile(path, "utf8");
  return text.trim() ? text.trimEnd().split("\n").map((line) => JSON.parse(line)) : [];
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
}

function safeBackupPath(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.startsWith("/") ||
      relativePath.replaceAll("\\", "/").split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Unsafe backup object path.");
  }
  const path = resolve(root, relativePath);
  if (!path.startsWith(`${resolve(root)}${sep}`)) throw new Error("Unsafe backup object path.");
  return path;
}

function safeObjectPath(root, key) {
  if (!ORIGINAL_KEY_PATTERN.test(key)) throw new Error(`Unsafe restore object key: ${key}.`);
  const path = resolve(root, ...key.split("/"));
  if (!path.startsWith(`${resolve(root)}${sep}`)) throw new Error(`Unsafe restore object key: ${key}.`);
  return path;
}

function safeByteLength(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
