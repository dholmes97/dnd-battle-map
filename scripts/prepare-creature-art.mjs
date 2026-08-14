#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import { inspectPng } from "../shared/scenario-provisioning.ts";

const [sourceArgument, outputBaseArgument] = process.argv.slice(2);
if (!sourceArgument || !outputBaseArgument) {
  console.error("Usage: node scripts/prepare-creature-art.mjs transparent-source.png output-base");
  process.exit(1);
}

const sourcePath = resolve(sourceArgument);
const outputBase = resolve(outputBaseArgument);
const input = await readFile(sourcePath);
const metadata = await sharp(input).metadata();
if (metadata.format !== "png" || !metadata.hasAlpha || !metadata.width || !metadata.height) {
  throw new Error("Creature source art must be a readable transparent PNG.");
}
const normalized = sharp(input).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true });
const original = await normalized.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
const thumbnail = await normalized.clone().resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
const originalDimensions = inspectPng(original);
const thumbnailDimensions = inspectPng(thumbnail);
if (!originalDimensions || !thumbnailDimensions || original.byteLength > 2 * 1024 * 1024 || thumbnail.byteLength > 2 * 1024 * 1024) {
  throw new Error("Prepared creature art does not meet the provisioning contract.");
}
const originalPath = `${outputBase}-original.png`;
const thumbnailPath = `${outputBase}-thumbnail.png`;
await mkdir(dirname(outputBase), { recursive: true });
await Promise.all([writeFile(originalPath, original), writeFile(thumbnailPath, thumbnail)]);
console.log(JSON.stringify({
  original: { path: originalPath, contentType: "image/png", bytes: original.byteLength, ...originalDimensions },
  thumbnail: { path: thumbnailPath, contentType: "image/png", bytes: thumbnail.byteLength, ...thumbnailDimensions },
}, null, 2));
