import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultFogConfig,
  pointInPolygon,
  pointVisibleToViewer,
  visibilityForViewer,
  visibilityPolygon,
} from "../shared/fog-of-war.mjs";

test("shared fog hides the polygon and reveals everything outside it", () => {
  const visibility = { mode: "shared", hiddenPolygon: [{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 10 }], polygons: [] };
  assert.equal(pointVisibleToViewer({ x: 7, y: 5 }, visibility), false);
  assert.equal(pointVisibleToViewer({ x: 2, y: 5 }, visibility), true);
});

test("closed vision doors block rays and open doors restore sight", () => {
  const fog = { ...defaultFogConfig(10, 10), mode: "dynamic", walls: [{ id: "wall", x1: 5, y1: 0, x2: 5, y2: 4 }], doors: [{ id: "door", x1: 5, y1: 4, x2: 5, y2: 6, open: false }, { id: "wall-2", x1: 5, y1: 6, x2: 5, y2: 10, open: false }] };
  const closed = visibilityPolygon({ x: 2, y: 5 }, fog, 10, 10);
  assert.equal(pointInPolygon({ x: 8, y: 5 }, closed), false);
  fog.doors[0].open = true;
  const open = visibilityPolygon({ x: 2, y: 5 }, fog, 10, 10);
  assert.equal(pointInPolygon({ x: 8, y: 5 }, open), true);
});

test("round blockers cast a shadow while leaving sight around both sides", () => {
  const fog = { ...defaultFogConfig(12, 10), mode: "dynamic", circles: [{ id: "rock", x: 6, y: 5, radius: 1.5 }] };
  const polygon = visibilityPolygon({ x: 2, y: 5 }, fog, 12, 10);
  assert.equal(pointInPolygon({ x: 10, y: 5 }, polygon), false);
  assert.equal(pointInPolygon({ x: 10, y: 1 }, polygon), true);
  assert.equal(pointInPolygon({ x: 10, y: 9 }, polygon), true);
});

test("dynamic viewer visibility unions every controlled creature origin", () => {
  const map = { width: 10, height: 10, fog: { ...defaultFogConfig(10, 10), mode: "dynamic" } };
  const visibility = visibilityForViewer(map, [{ x: 2, y: 2, kind: "character", controlledByViewer: true }, { x: 8, y: 8, kind: "monster", controlledByViewer: true }, { x: 5, y: 5, kind: "monster", controlledByViewer: false }], { role: "player" });
  assert.equal(visibility.polygons.length, 2);
  assert.equal(pointVisibleToViewer({ x: 5, y: 5 }, visibility), true);
  assert.ok(visibility.geometry);
});

test("spell areas do not become extra character vision origins", () => {
  const map = { width: 10, height: 10, fog: { ...defaultFogConfig(10, 10), mode: "dynamic" } };
  const visibility = visibilityForViewer(map, [{ x: 2, y: 2, kind: "character", controlledByViewer: true }, { x: 8, y: 8, kind: "spell-effect", controlledByViewer: true }], { role: "player" });
  assert.equal(visibility.polygons.length, 1);
});
