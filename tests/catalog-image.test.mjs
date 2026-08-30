import assert from "node:assert/strict";
import test from "node:test";

import { inspectCatalogPng, inspectCatalogWebp } from "../shared/catalog-image.ts";

test("catalog PNG inspection enforces IHDR dimensions and per-variant pixel budgets", () => {
  assert.deepEqual(inspectCatalogPng(pngHeader(2048, 2048), "original"), { width: 2048, height: 2048 });
  assert.deepEqual(inspectCatalogPng(pngHeader(512, 512), "thumbnail"), { width: 512, height: 512 });
  assert.equal(inspectCatalogPng(pngHeader(2049, 1), "original"), null);
  assert.equal(inspectCatalogPng(pngHeader(513, 1), "thumbnail"), null);
  assert.equal(inspectCatalogPng(pngHeader(100_000, 100_000), "original"), null);
  assert.equal(inspectCatalogPng(new Uint8Array(33), "original"), null);
});

test("catalog WebP inspection reads bounded extended, lossless, and lossy dimensions", () => {
  assert.deepEqual(inspectCatalogWebp(webpChunk("VP8X", vp8xDimensions(1254, 1254))), { width: 1254, height: 1254 });
  assert.deepEqual(inspectCatalogWebp(webpChunk("VP8L", vp8lDimensions(768, 512))), { width: 768, height: 512 });
  assert.deepEqual(inspectCatalogWebp(webpChunk("VP8 ", vp8Dimensions(640, 480))), { width: 640, height: 480 });
  assert.equal(inspectCatalogWebp(webpChunk("VP8X", vp8xDimensions(2049, 1))), null);
  assert.equal(inspectCatalogWebp(new Uint8Array(30)), null);
});

function pngHeader(width, height) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  new DataView(bytes.buffer).setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

function webpChunk(kind, payload) {
  const padded = payload.length + payload.length % 2;
  const bytes = new Uint8Array(20 + padded);
  bytes.set(Buffer.from("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(Buffer.from("WEBP"), 8);
  bytes.set(Buffer.from(kind), 12);
  new DataView(bytes.buffer).setUint32(16, payload.length, true);
  bytes.set(payload, 20);
  return bytes;
}

function vp8xDimensions(width, height) {
  const bytes = new Uint8Array(10);
  writeUint24(bytes, 4, width - 1);
  writeUint24(bytes, 7, height - 1);
  return bytes;
}

function vp8lDimensions(width, height) {
  const widthBits = width - 1;
  const heightBits = height - 1;
  return Uint8Array.from([
    0x2f,
    widthBits & 0xff,
    ((widthBits >> 8) & 0x3f) | ((heightBits & 0x03) << 6),
    (heightBits >> 2) & 0xff,
    (heightBits >> 10) & 0x0f,
  ]);
}

function vp8Dimensions(width, height) {
  const bytes = new Uint8Array(10);
  bytes.set([0, 0, 0, 0x9d, 0x01, 0x2a], 0);
  new DataView(bytes.buffer).setUint16(6, width, true);
  new DataView(bytes.buffer).setUint16(8, height, true);
  return bytes;
}

function writeUint24(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
}
