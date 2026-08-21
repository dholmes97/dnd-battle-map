import assert from "node:assert/strict";
import test from "node:test";

import { inspectCatalogPng } from "../shared/catalog-image.ts";

test("catalog PNG inspection enforces IHDR dimensions and per-variant pixel budgets", () => {
  assert.deepEqual(inspectCatalogPng(pngHeader(2048, 2048), "original"), { width: 2048, height: 2048 });
  assert.deepEqual(inspectCatalogPng(pngHeader(512, 512), "thumbnail"), { width: 512, height: 512 });
  assert.equal(inspectCatalogPng(pngHeader(2049, 1), "original"), null);
  assert.equal(inspectCatalogPng(pngHeader(513, 1), "thumbnail"), null);
  assert.equal(inspectCatalogPng(pngHeader(100_000, 100_000), "original"), null);
  assert.equal(inspectCatalogPng(new Uint8Array(33), "original"), null);
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
