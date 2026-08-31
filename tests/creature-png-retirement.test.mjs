import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import sharp from "sharp";

import {
  createCreaturePngRetirementManifest,
  createDirectoryRestoreStorage,
  restoreCreaturePngRetirement,
  validateCreaturePngRetirementManifest,
} from "../scripts/lib/creature-png-retirement.mjs";

test("builds an exact retirement allowlist from matching backup, catalog, and variant evidence", async () => {
  const fixture = await createFixture();
  try {
    const manifest = await createCreaturePngRetirementManifest({
      backupDirectory: fixture.backup,
      conversionManifestPath: fixture.conversionManifest,
      generatedAt: "2026-08-31T12:00:00.000Z",
    });
    assert.equal(manifest.totals.candidateCount, 1);
    assert.equal(manifest.totals.originalBytes, fixture.original.length);
    assert.equal(manifest.totals.replacementBytes, fixture.display.length);
    assert.deepEqual(manifest.candidates.map((candidate) => candidate.original.key), [fixture.originalKey]);
    assert.equal(manifest.candidates[0].replacement.key, fixture.displayKey);
    assert.equal(manifest.scope.protectedPrefixes.includes("creature-catalog/thumbnails/"), true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("refuses incomplete or mismatched replacement evidence", async () => {
  const fixture = await createFixture({ variantSha256: "0".repeat(64) });
  try {
    await assert.rejects(
      createCreaturePngRetirementManifest({
        backupDirectory: fixture.backup,
        conversionManifestPath: fixture.conversionManifest,
      }),
      /variant metadata does not match/i,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("restores every allowlisted original and verifies the written bytes", async () => {
  const fixture = await createFixture();
  try {
    const manifest = await createCreaturePngRetirementManifest({
      backupDirectory: fixture.backup,
      conversionManifestPath: fixture.conversionManifest,
    });
    const target = join(fixture.root, "restored");
    await mkdir(target);
    const result = await restoreCreaturePngRetirement({
      backupDirectory: fixture.backup,
      manifest,
      storage: createDirectoryRestoreStorage(target),
    });
    assert.deepEqual(result, { restoredCount: 1, restoredBytes: fixture.original.length });
    assert.deepEqual(await readFile(join(target, fixture.originalKey)), fixture.original);
    await assert.rejects(
      restoreCreaturePngRetirement({
        backupDirectory: fixture.backup,
        manifest,
        storage: createDirectoryRestoreStorage(target),
      }),
      /EEXIST/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("retirement manifests reject protected or wildcard-like object keys", async () => {
  const fixture = await createFixture();
  try {
    const manifest = await createCreaturePngRetirementManifest({
      backupDirectory: fixture.backup,
      conversionManifestPath: fixture.conversionManifest,
    });
    const unsafe = structuredClone(manifest);
    unsafe.candidates[0].original.key = "creature-catalog/thumbnails/tokens/catalog/test-creature.png";
    assert.throws(() => validateCreaturePngRetirementManifest(unsafe), /invalid or duplicate candidate/i);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createFixture({ variantSha256 } = {}) {
  const root = await mkdtemp(join(tmpdir(), "creature png retirement "));
  const backup = join(root, "production-test");
  const originalKey = "creature-catalog/original/tokens/catalog/test-creature.png";
  const displayKey = "creature-catalog/display/tokens/catalog/test-creature.webp";
  const original = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 0.5 } },
  }).png().toBuffer();
  const display = await sharp(original).webp({ quality: 82, alphaQuality: 90 }).toBuffer();
  const originalSha256 = sha256(original);
  const displaySha256 = sha256(display);
  const originalPath = `r2/objects/${originalKey}`;
  const displayPath = `r2/objects/${displayKey}`;
  await write(join(backup, originalPath), original);
  await write(join(backup, displayPath), display);
  await write(join(backup, "d1/tables/creature_catalog.ndjson"), Buffer.from(`${JSON.stringify({
    id: "test-creature",
    token_asset: "/creature-assets/tokens/catalog/test-creature.png",
  })}\n`));
  await write(join(backup, "d1/tables/creature_asset_variants.ndjson"), Buffer.from(`${JSON.stringify({
    id: "test-creature:display:1",
    creature_catalog_id: "test-creature",
    variant: "display",
    version: 1,
    r2_key: displayKey,
    byte_length: display.length,
    sha256: variantSha256 ?? displaySha256,
  })}\n`));
  const backupManifest = {
    formatVersion: 1,
    completedAt: "2026-08-31T11:00:00.000Z",
    source: { siteUrl: "https://dnd.fridaylunchcrew.com", projectId: "test-project" },
    r2: {
      objects: [
        { key: originalKey, path: originalPath, size: original.length, sha256: originalSha256 },
        { key: displayKey, path: displayPath, size: display.length, sha256: displaySha256 },
      ],
    },
  };
  await write(join(backup, "manifest.json"), Buffer.from(`${JSON.stringify(backupManifest, null, 2)}\n`));
  const conversionManifest = join(root, "conversion.json");
  await write(conversionManifest, Buffer.from(`${JSON.stringify({
    formatVersion: 1,
    encoder: { format: "webp" },
    totals: { discovered: 1, converted: 1, failed: 0 },
    objects: [{
      sourceKey: originalKey,
      displayKey,
      sourceBytes: original.length,
      displayBytes: display.length,
      sourceSha256: originalSha256,
      displaySha256,
    }],
  }, null, 2)}\n`));
  return { root, backup, conversionManifest, originalKey, displayKey, original, display };
}

async function write(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

