#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import {
  HANDOUT_DISPLAY_MAX_BYTES,
  HANDOUT_DISPLAY_MAX_EDGE,
  HANDOUT_INPUT_MAX_BYTES,
  HANDOUT_INPUT_MAX_PIXELS,
  HANDOUT_THUMBNAIL_MAX_BYTES,
  HANDOUT_THUMBNAIL_MAX_HEIGHT,
  HANDOUT_THUMBNAIL_MAX_WIDTH,
  inspectWebp,
  storedHandoutVariantError,
} from "../shared/handout-domain.ts";

const [sourceArgument, outputBaseArgument] = process.argv.slice(2);
if (!sourceArgument || !outputBaseArgument) {
  console.error("Usage: node scripts/prepare-scenario-handout.mjs source-image output-base");
  process.exit(1);
}

const sourcePath = resolve(sourceArgument);
const outputBase = resolve(outputBaseArgument);
const input = await readFile(sourcePath);
if (input.byteLength < 1 || input.byteLength > HANDOUT_INPUT_MAX_BYTES) throw new Error("Handout source exceeds the input byte limit.");
const metadata = await sharp(input).metadata();
if (!metadata.width || !metadata.height || metadata.width * metadata.height > HANDOUT_INPUT_MAX_PIXELS) throw new Error("Handout source exceeds the input pixel limit.");

const display = await encodeVariant(input, "display");
const thumbnail = await encodeVariant(input, "thumbnail");
const displayPath = `${outputBase}-display.webp`;
const thumbnailPath = `${outputBase}-thumbnail.webp`;
await mkdir(dirname(outputBase), { recursive: true });
await Promise.all([writeFile(displayPath, display), writeFile(thumbnailPath, thumbnail)]);
console.log(JSON.stringify({
  display: { path: displayPath, contentType: "image/webp", bytes: display.byteLength, ...inspectWebp(display) },
  thumbnail: { path: thumbnailPath, contentType: "image/webp", bytes: thumbnail.byteLength, ...inspectWebp(thumbnail) },
}, null, 2));

async function encodeVariant(bytes, variant) {
  const thumbnail = variant === "thumbnail";
  const maximumBytes = thumbnail ? HANDOUT_THUMBNAIL_MAX_BYTES : HANDOUT_DISPLAY_MAX_BYTES;
  const width = thumbnail ? HANDOUT_THUMBNAIL_MAX_WIDTH : HANDOUT_DISPLAY_MAX_EDGE;
  const height = thumbnail ? HANDOUT_THUMBNAIL_MAX_HEIGHT : HANDOUT_DISPLAY_MAX_EDGE;
  for (let quality = thumbnail ? 82 : 90; quality >= 42; quality -= 6) {
    const encoded = await sharp(bytes).rotate().resize({ width, height, fit: "inside", withoutEnlargement: true }).webp({ quality, effort: 6 }).toBuffer();
    const dimensions = inspectWebp(encoded);
    const error = storedHandoutVariantError({ variant, contentType: "image/webp", byteLength: encoded.byteLength, width: dimensions?.width, height: dimensions?.height });
    if (!error && encoded.byteLength <= maximumBytes) return encoded;
  }
  throw new Error(`Could not prepare a storage-efficient ${variant} handout within the project limits.`);
}
