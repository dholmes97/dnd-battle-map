import assert from "node:assert/strict";
import test from "node:test";
import { battleMapAnimationIsActive } from "../shared/battle-map-animation.ts";
import { layoutTokenLabels } from "../shared/token-label-layout.ts";

function token(overrides = {}) {
  return {
    id: "token-1",
    artAsset: null,
    kind: "character",
    effects: [],
    ...overrides,
  };
}

function label(tokenId, tokenX, tokenY, overrides = {}) {
  return {
    tokenId,
    text: `Long ${tokenId}`,
    tokenX,
    tokenY,
    radius: 20,
    width: 88,
    height: 18,
    priority: 0,
    selected: false,
    ...overrides,
  };
}

function overlaps(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

test("only visually dynamic spells and attached VFX require continuous animation", () => {
  const inputs = { annotations: [], pingStartedAt: new Map(), spellPlacementArt: null, now: 1_000 };
  assert.equal(battleMapAnimationIsActive({ ...inputs, tokens: [token({ artAsset: "shape:generic-circle" })] }), false);
  assert.equal(battleMapAnimationIsActive({ ...inputs, tokens: [token({ kind: "spell-effect", artAsset: "/assets/spells/moonbeam-vfx-source.png" })] }), true);
  assert.equal(battleMapAnimationIsActive({ ...inputs, tokens: [token({ effects: [{ name: "Haste" }] })] }), true);
  assert.equal(battleMapAnimationIsActive({ ...inputs, tokens: [], spellPlacementArt: "shape:generic-square" }), false);
  assert.equal(battleMapAnimationIsActive({ ...inputs, tokens: [], spellPlacementArt: "/assets/spells/magic-circle-vfx.png" }), true);
});

test("transient animation expires from its authoritative clock", () => {
  const ping = { id: "ping-1", type: "ping", expiresAt: 2_260 };
  const inputs = { annotations: [ping], tokens: [], pingStartedAt: new Map([[ping.id, 1_000]]), spellPlacementArt: null };
  assert.equal(battleMapAnimationIsActive({ ...inputs, now: 1_500 }), true);
  assert.equal(battleMapAnimationIsActive({ ...inputs, now: 2_260 }), false);
  const spotlight = { id: "spotlight-1", type: "spotlight", expiresAt: 4_000 };
  assert.equal(battleMapAnimationIsActive({ ...inputs, annotations: [spotlight], now: 3_999 }), true);
  assert.equal(battleMapAnimationIsActive({ ...inputs, annotations: [spotlight], now: 4_000 }), false);
});

test("crowded token labels are deterministic, prioritized, and non-overlapping", () => {
  const requests = [label("c", 155, 105), label("a", 140, 100, { selected: true, priority: 300 }), label("b", 170, 100, { priority: 200, radius: 30 })];
  const obstacles = requests.map((request) => ({ tokenId: request.tokenId, x: request.tokenX, y: request.tokenY, radius: request.radius }));
  const bounds = { x: 0, y: 0, width: 320, height: 220 };
  const forward = layoutTokenLabels(requests, obstacles, bounds);
  const reverse = layoutTokenLabels([...requests].reverse(), obstacles, bounds);
  assert.deepEqual(forward.map(({ tokenId, anchor }) => ({ tokenId, anchor })), reverse.map(({ tokenId, anchor }) => ({ tokenId, anchor })));
  assert.equal(forward[0].tokenId, "a");
  for (let index = 0; index < forward.length; index += 1) {
    for (let other = index + 1; other < forward.length; other += 1) assert.equal(overlaps(forward[index], forward[other]), false);
  }
});

test("selected labels remain visible at map edges while excess labels are suppressed", () => {
  const requests = Array.from({ length: 10 }, (_, index) => label(`token-${index}`, 8, 8, { selected: index === 0, priority: index === 0 ? 300 : 0 }));
  const placements = layoutTokenLabels(requests, [], { x: 0, y: 0, width: 140, height: 90 });
  const selected = placements.find((placement) => placement.tokenId === "token-0");
  assert.ok(selected);
  assert.ok(selected.x >= 0 && selected.y >= 0);
  assert.ok(selected.x + selected.width <= 140 && selected.y + selected.height <= 90);
  assert.ok(placements.length < requests.length);
});
