import assert from "node:assert/strict";
import test from "node:test";

import { annotationGeometryIsBounded } from "../shared/annotation-geometry.ts";

test("annotation geometry validates complete endpoint pairs within the grid", () => {
  assert.equal(annotationGeometryIsBounded({ type: "ping", x: 0, y: 16 }, 24, 16), true);
  assert.equal(annotationGeometryIsBounded({ type: "drawing", x: 1, y: 2, x2: 24, y2: 16 }, 24, 16), true);
  assert.equal(annotationGeometryIsBounded({ type: "drawing", x: 1, y: 2 }, 24, 16), false);
  assert.equal(annotationGeometryIsBounded({ type: "drawing", x: 1, y: 2, x2: 3 }, 24, 16), false);
  assert.equal(annotationGeometryIsBounded({ type: "drawing", x: 1, y: 2, x2: 1e308, y2: 3 }, 24, 16), false);
  assert.equal(annotationGeometryIsBounded({ type: "drawing", x: 1, y: 2, x2: 3, y2: Infinity }, 24, 16), false);
});
