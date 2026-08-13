import assert from "node:assert/strict";
import test from "node:test";
import {
  HEALTH_BANDS,
  displayHealth,
  healthBand,
  healthBandRatio,
} from "../shared/health.ts";

test("classifies health into the five play-facing bands", () => {
  assert.equal(healthBand(20, 20), "unharmed");
  assert.equal(healthBand(19, 20), "injured");
  assert.equal(healthBand(11, 20), "injured");
  assert.equal(healthBand(10, 20), "bloodied");
  assert.equal(healthBand(6, 20), "bloodied");
  assert.equal(healthBand(5, 20), "near-death");
  assert.equal(healthBand(1, 20), "near-death");
  assert.equal(healthBand(0, 20), "down");
});

test("reports no band when hit points are unknown", () => {
  assert.equal(healthBand(null, 20), null);
  assert.equal(healthBand(10, null), null);
  assert.equal(healthBand(10, 0), null);
  assert.equal(healthBand(undefined, undefined), null);
});

test("snaps the ring to band intervals for viewers denied exact hit points", () => {
  for (const band of HEALTH_BANDS) assert.equal(typeof healthBandRatio(band), "number");
  const coarse = displayHealth(null, null, "bloodied");
  assert.deepEqual(
    { band: coarse.band, exact: coarse.exact, ratio: coarse.ratio, label: coarse.label },
    { band: "bloodied", exact: false, ratio: 0.5, label: "Bloodied" },
  );
  assert.equal(displayHealth(null, null, "unharmed").ratio, 1);
  assert.equal(displayHealth(null, null, "injured").ratio, 0.75);
  assert.equal(displayHealth(null, null, "near-death").ratio, 0.25);
  assert.equal(displayHealth(null, null, "down").ratio, 0);
  assert.equal(displayHealth(null, null, null), null);
});

test("keeps the exact ratio and numeric label for controllers and the DM", () => {
  const exact = displayHealth(13, 20, "bloodied");
  assert.equal(exact.exact, true);
  assert.equal(exact.band, "injured");
  assert.equal(exact.ratio, 0.65);
  assert.equal(exact.label, "13/20");
});
