import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultSharedFogPolygon,
  defaultFogConfig,
  dragFogBlocker,
  ensureSharedFogPolygon,
  fogBlockerHandleAtPoint,
  insertSharedFogPoint,
  pointInPolygon,
  pointVisibleToViewer,
  visibilityForViewer,
  visibilityPolygon,
} from "../shared/fog-of-war.mjs";

test("shared fog starts with corners and side midpoints and upgrades the old rectangle", () => {
  const expected = defaultSharedFogPolygon(24, 16);
  assert.equal(expected.length, 8);
  assert.deepEqual(ensureSharedFogPolygon([{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }], 24, 16), expected);
  const expanded = insertSharedFogPoint(expected);
  assert.equal(expanded.length, 9);
  assert.deepEqual(expanded.slice(0, 2), [{ x: 0, y: 0 }, { x: 6, y: 0 }]);
});

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
  const visibility = visibilityForViewer({ width: 12, height: 10, fog }, [{ x: 2, y: 5, kind: "character", controlledByViewer: true }], { role: "player" });
  assert.deepEqual(visibility.revealedCircles, fog.circles);
  assert.equal(pointVisibleToViewer({ x: 6, y: 5 }, visibility), true);
  assert.equal(pointVisibleToViewer({ x: 10, y: 5 }, visibility), false);
});

test("round blockers hidden behind other geometry remain concealed", () => {
  const fog = { ...defaultFogConfig(12, 10), mode: "dynamic", walls: [{ id: "wall", x1: 4, y1: 0, x2: 4, y2: 10 }], circles: [{ id: "hidden-rock", x: 7, y: 5, radius: 1 }] };
  const visibility = visibilityForViewer({ width: 12, height: 10, fog }, [{ x: 2, y: 5, kind: "character", controlledByViewer: true }], { role: "player" });
  assert.deepEqual(visibility.revealedCircles, []);
  assert.equal(pointVisibleToViewer({ x: 7, y: 5 }, visibility), false);
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

test("dynamic blockers support freeform endpoint, whole-shape, position, and radius edits", () => {
  const fog = { ...defaultFogConfig(24, 16), walls: [{ id: "wall", x1: 2.25, y1: 3.5, x2: 8.75, y2: 6.25 }], circles: [{ id: "rock", x: 12.4, y: 7.3, radius: 2.2 }] };
  const endpoint = fogBlockerHandleAtPoint(fog, { x: 2.25, y: 3.5 }, 0.2);
  assert.deepEqual(endpoint, { kind: "wall", id: "wall", handle: "start" });
  const endpointMoved = dragFogBlocker(fog, endpoint, { x: 2.25, y: 3.5 }, { x: 1.1, y: 4.4 }, 24, 16);
  assert.deepEqual(endpointMoved.walls[0], { id: "wall", x1: 1.1, y1: 4.4, x2: 8.75, y2: 6.25 });
  const wallMoved = dragFogBlocker(fog, { kind: "wall", id: "wall", handle: "body" }, { x: 5, y: 5 }, { x: 7, y: 6 }, 24, 16);
  assert.deepEqual(wallMoved.walls[0], { id: "wall", x1: 4.25, y1: 4.5, x2: 10.75, y2: 7.25 });
  const circleMoved = dragFogBlocker(fog, { kind: "circle", id: "rock", handle: "body" }, { x: 12.4, y: 7.3 }, { x: 13.9, y: 8.1 }, 24, 16);
  assert.deepEqual(circleMoved.circles[0], { id: "rock", x: 13.9, y: 8.1, radius: 2.2 });
  const circleResized = dragFogBlocker(fog, { kind: "circle", id: "rock", handle: "radius" }, { x: 14.6, y: 7.3 }, { x: 15.7, y: 7.3 }, 24, 16);
  assert.equal(circleResized.circles[0].radius, 3.3);
});
