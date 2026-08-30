import assert from "node:assert/strict";
import test from "node:test";
import { deterministicDiePreviewValues } from "../shared/dice-animation.ts";

test("dice animation gives every viewer the same bounded preview sequence", () => {
  const firstViewer = deterministicDiePreviewValues("roll-7:attack:0", 20);
  const secondViewer = deterministicDiePreviewValues("roll-7:attack:0", 20);

  assert.deepEqual(firstViewer, secondViewer);
  assert.equal(firstViewer.length >= 4 && firstViewer.length <= 7, true);
  assert.equal(firstViewer.every((value) => value >= 1 && value <= 20), true);
});

test("dice animation varies both its sequence and four-to-seven-beat rhythm", () => {
  assert.notDeepEqual(
    deterministicDiePreviewValues("roll-7:damage:0", 6),
    deterministicDiePreviewValues("roll-7:damage:1", 6),
  );
  const previewCounts = new Set(Array.from(
    { length: 64 },
    (_, index) => deterministicDiePreviewValues(`roll-${index}:attack:0`, 20).length,
  ));
  assert.deepEqual([...previewCounts].sort(), [4, 5, 6, 7]);
  assert.deepEqual(deterministicDiePreviewValues("roll-7:damage:0", 1), []);
});
