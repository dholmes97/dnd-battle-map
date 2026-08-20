import assert from "node:assert/strict";
import test from "node:test";

import { MAX_ALTITUDE_FEET, normalizeAltitude, stepAltitude } from "../shared/token-altitude.ts";

test("altitude is bounded and wheel steps move in five-foot increments", () => {
  assert.equal(stepAltitude(0, 1), 5);
  assert.equal(stepAltitude(20, -1), 15);
  assert.equal(stepAltitude(0, -1), 0);
  assert.equal(normalizeAltitude(MAX_ALTITUDE_FEET + 50), MAX_ALTITUDE_FEET);
  assert.equal(normalizeAltitude("not-a-height"), 0);
});
