import assert from "node:assert/strict";
import test from "node:test";
import {
  fitGridGeometry,
  calculateDirectDistance,
  clampMapPoint,
  drawingAtPoint,
  tokenArtScale,
  viewportGeometry,
  zoomViewportAt,
} from "../shared/battle-map-geometry.ts";

test("fit geometry keeps grid cells square in wide and tall containers", () => {
  assert.deepEqual(fitGridGeometry(24, 16, 1600, 700), {
    cellSize: 43.75,
    visibleWidth: 24,
    visibleHeight: 16,
    panX: 0,
    panY: 0,
    offsetX: 275,
    offsetY: 0,
  });
  assert.deepEqual(fitGridGeometry(24, 16, 900, 1000), {
    cellSize: 37.5,
    visibleWidth: 24,
    visibleHeight: 16,
    panX: 0,
    panY: 0,
    offsetX: 0,
    offsetY: 200,
  });
});

const state = {
  encounter: { mapPackage: { id: "keep" } },
  grid: { width: 24, height: 16, feetPerCell: 5 },
};
const mapKey = "keep:24x16";

test("direct movement uses equal-cost D&D diagonals", () => {
  assert.equal(calculateDirectDistance({ x: 1, y: 1 }, { x: 4, y: 3 }, 5), 15);
  assert.equal(calculateDirectDistance({ x: 4, y: 3 }, { x: 1, y: 1 }, 10), 30);
});

test("Small creatures keep a full footprint but render visibly smaller artwork", () => {
  assert.equal(tokenArtScale("small"), 0.75);
  for (const size of ["tiny", "medium", "large", "huge", "gargantuan"]) {
    assert.equal(tokenArtScale(size), 1, size);
  }
});

test("token centers clamp to the map using their footprint", () => {
  assert.deepEqual(clampMapPoint(state.grid, { x: -4, y: 99 }, 1.5), { x: 1.5, y: 14.5 });
  assert.deepEqual(clampMapPoint(state.grid, { x: 8.12349, y: 5.67891 }), { x: 8.123, y: 5.679 });
});

test("line hit testing chooses the nearest durable drawing", () => {
  const annotations = [
    { id: "ping", type: "ping", x: 2, y: 2, x2: null, y2: null },
    { id: "far", type: "drawing", x: 0, y: 2, x2: 10, y2: 2 },
    { id: "near", type: "drawing", x: 0, y: 1, x2: 10, y2: 1 },
  ];
  assert.equal(drawingAtPoint(annotations, { x: 4, y: 1.1 }, 1)?.id, "near");
  assert.equal(drawingAtPoint(annotations, { x: 4, y: 4 }, 0.25), null);
});

test("100% covers while Fit is the only letterboxed viewport", () => {
  const cover = viewportGeometry({ zoom: 1, centerX: 12, centerY: 8, mapKey, fit: false }, state, 800, 800);
  assert.equal(cover.cellSize, 50);
  assert.equal(cover.visibleWidth, 16);
  assert.equal(cover.visibleHeight, 16);
  assert.equal(cover.offsetX, 0);
  assert.equal(cover.offsetY, 0);

  const fit = viewportGeometry({ zoom: 1, centerX: 12, centerY: 8, mapKey, fit: true }, state, 800, 800);
  assert.equal(fit.visibleWidth, 24);
  assert.equal(fit.visibleHeight, 16);
  assert.equal(fit.offsetY, 800 / 2 - (16 * (800 / 24)) / 2);
});

test("zooming preserves the map point under the pointer", () => {
  const viewport = { zoom: 1, centerX: 12, centerY: 8, mapKey, fit: false };
  const before = viewportGeometry(viewport, state, 1200, 800);
  const focusX = 0.8;
  const focusY = 0.25;
  const targetBefore = {
    x: before.panX + focusX * 1200 / before.cellSize,
    y: before.panY + focusY * 800 / before.cellSize,
  };
  const zoomed = zoomViewportAt(viewport, state, 1200, 800, 2, focusX, focusY);
  const after = viewportGeometry(zoomed, state, 1200, 800);
  assert.ok(Math.abs(targetBefore.x - (after.panX + focusX * 1200 / after.cellSize)) < 1e-9);
  assert.ok(Math.abs(targetBefore.y - (after.panY + focusY * 800 / after.cellSize)) < 1e-9);
});
