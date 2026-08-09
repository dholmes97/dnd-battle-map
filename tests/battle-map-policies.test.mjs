import assert from "node:assert/strict";
import test from "node:test";
import { mapSceneContentKey, movementPolicyDenial } from "../shared/battle-map-policies.mjs";

test("strict movement off permits a non-active foreign token during combat", () => {
  assert.equal(movementPolicyDenial({
    strictMovement: false,
    participantRole: "player",
    controlledByViewer: false,
    encounterStatus: "active",
    tokenInitiativeOrder: 4,
    activeInitiativeOrder: 1,
    turnComplete: true,
  }), null);
});

test("strict movement on enforces ownership but still lets the DM move anything", () => {
  assert.deepEqual(movementPolicyDenial({
    strictMovement: true,
    participantRole: "player",
    controlledByViewer: false,
    encounterStatus: "active",
  }), { status: 403, error: "You do not control this token." });
  assert.equal(movementPolicyDenial({
    strictMovement: true,
    participantRole: "player",
    controlledByViewer: true,
    encounterStatus: "active",
  }), null);
  assert.equal(movementPolicyDenial({
    strictMovement: true,
    participantRole: "dm",
    controlledByViewer: false,
    encounterStatus: "active",
  }), null);
});

test("paused combat blocks players without blocking the DM", () => {
  assert.deepEqual(movementPolicyDenial({
    strictMovement: false,
    participantRole: "player",
    controlledByViewer: true,
    encounterStatus: "paused",
  }), { status: 409, error: "The encounter is paused." });
  assert.equal(movementPolicyDenial({
    strictMovement: false,
    participantRole: "dm",
    controlledByViewer: true,
    encounterStatus: "paused",
  }), null);
});

test("equivalent map payloads share a cache key while content edits invalidate it", () => {
  const map = {
    id: "map-1",
    visual: { assetUrl: "/map-assets/forest.jpg" },
    sceneObjects: [{ id: "rock-1", x: 2, y: 3 }],
    labels: [],
  };
  const clone = JSON.parse(JSON.stringify(map));
  const edited = { ...clone, sceneObjects: [{ ...clone.sceneObjects[0], x: 4 }] };

  assert.equal(mapSceneContentKey(map), mapSceneContentKey(clone));
  assert.notEqual(mapSceneContentKey(map), mapSceneContentKey(edited));
  assert.equal(mapSceneContentKey(null), "");
});
