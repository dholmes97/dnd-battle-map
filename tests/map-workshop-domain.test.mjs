import assert from "node:assert/strict";
import test from "node:test";
import {
  mapNoteAt,
  mapThumbnailUrl,
  snapMapPoint,
} from "../shared/map-workshop-domain.mjs";

test("workshop path and snap rules are framework independent", () => {
  assert.equal(mapThumbnailUrl("/maps/forest.jpg"), "/assets/full-map-thumbnails/forest.jpg");
  assert.deepEqual(snapMapPoint({ x: 2.49, y: 3.51 }), { x: 2, y: 4 });
});

test("note hit testing selects the visually topmost note", () => {
  const map = {
    notes: [{ id: "first", x: 3, y: 3 }, { id: "last", x: 3.1, y: 3.1 }],
  };
  assert.equal(mapNoteAt(map, { x: 3, y: 3 }).id, "last");
  assert.equal(mapNoteAt(map, { x: 9, y: 9 }), null);
});
