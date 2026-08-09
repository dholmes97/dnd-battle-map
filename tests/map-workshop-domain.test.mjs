import assert from "node:assert/strict";
import test from "node:test";
import {
  mapNoteAt,
  mapThumbnailUrl,
  nextMapRotation,
  sceneObjectAt,
  sceneObjectBounds,
  snapMapPoint,
} from "../shared/map-workshop-domain.mjs";

test("workshop path, snap, and rotation rules are framework independent", () => {
  assert.equal(mapThumbnailUrl("/maps/forest.jpg"), "/assets/full-map-thumbnails/forest.jpg");
  assert.deepEqual(snapMapPoint({ x: 2.49, y: 3.51 }), { x: 2, y: 4 });
  assert.deepEqual([0, 90, 180, 270, 0].map(nextMapRotation), [90, 180, 270, 0, 90]);
});

test("rotated scene bounds swap dimensions", () => {
  assert.deepEqual(sceneObjectBounds({ width: 4, height: 2, rotation: 0 }), { width: 4, height: 2 });
  assert.deepEqual(sceneObjectBounds({ width: 4, height: 2, rotation: 90 }), { width: 2, height: 4 });
});

test("hit testing selects the visually topmost object and note", () => {
  const lower = { id: "lower", x: 1, y: 1, width: 3, height: 3, rotation: 0 };
  const upper = { id: "upper", x: 2, y: 2, width: 3, height: 3, rotation: 0 };
  const map = {
    sceneObjects: [lower, upper],
    notes: [{ id: "first", x: 3, y: 3 }, { id: "last", x: 3.1, y: 3.1 }],
  };
  assert.equal(sceneObjectAt(map, { x: 2.5, y: 2.5 }).id, "upper");
  assert.equal(mapNoteAt(map, { x: 3, y: 3 }).id, "last");
  assert.equal(mapNoteAt(map, { x: 9, y: 9 }), null);
});
