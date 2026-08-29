import assert from "node:assert/strict";
import test from "node:test";
import {
  moveSpatialPoint,
  nearestSpatialItem,
  spatialCoordinateAnnouncement,
  spatialKeyboardIntent,
} from "../shared/spatial-keyboard.ts";

test("spatial keyboard intents distinguish cursor movement from viewport panning", () => {
  assert.deepEqual(spatialKeyboardIntent({ key: "ArrowRight" }), { kind: "move", dx: 1, dy: 0, step: 1 });
  assert.deepEqual(spatialKeyboardIntent({ key: "ArrowUp", altKey: true, shiftKey: true }), { kind: "pan", dx: 0, dy: -1, step: 5 });
  assert.deepEqual(spatialKeyboardIntent({ key: "PageUp" }), { kind: "altitude", direction: 1 });
  assert.deepEqual(spatialKeyboardIntent({ key: "Enter" }), { kind: "activate" });
  assert.deepEqual(spatialKeyboardIntent({ key: " " }), { kind: "grab" });
  assert.deepEqual(spatialKeyboardIntent({ key: "Space" }), { kind: "grab" });
  assert.equal(spatialKeyboardIntent({ key: "Tab" }), null);
});

test("spatial points remain inside map and token-radius bounds", () => {
  const left = moveSpatialPoint({ x: 1, y: 1 }, { kind: "move", dx: -1, dy: 0, step: 5 }, { width: 24, height: 16 }, 0.5);
  const bottom = moveSpatialPoint({ x: 23, y: 15 }, { kind: "move", dx: 0, dy: 1, step: 5 }, { width: 24, height: 16 }, 1);
  assert.deepEqual(left, { x: 0.5, y: 1 });
  assert.deepEqual(bottom, { x: 23, y: 15 });
});

test("coordinate announcements and nearest-item selection are deterministic", () => {
  assert.equal(spatialCoordinateAnnouncement({ x: 3.5, y: 4 }, 5), "17.5 feet east, 20 feet south");
  const nearest = nearestSpatialItem({ x: 2, y: 2 }, [
    { id: "z", x: 2.5, y: 2 },
    { id: "a", x: 1.5, y: 2 },
  ], 1);
  assert.equal(nearest?.id, "a");
  assert.equal(nearestSpatialItem({ x: 9, y: 9 }, [{ id: "a", x: 1, y: 1 }], 1), null);
});
