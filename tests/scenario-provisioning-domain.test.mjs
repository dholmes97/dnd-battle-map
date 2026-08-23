import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProvisionedMapPackage,
  canonicalScenarioProvisioningJson,
  inspectPng,
  parseScenarioProvisioningManifest,
  requiredScenarioProvisioningAssets,
  scenarioProvisioningTransitionError,
} from "../shared/scenario-provisioning.ts";

function manifest(overrides = {}) {
  return {
    version: 1,
    idempotencyKey: "gmail-primary-message-1-revision-1",
    revision: 1,
    operation: "create",
    source: {
      provider: "gmail",
      mailboxKey: "primary",
      messageId: "message-1",
      threadId: "thread-1",
      sender: "kevin@example.com",
    },
    scenario: {
      name: "Sunken Chapel",
      briefing: "A drowned shrine has awakened.",
    },
    settings: { strictMovement: false },
    party: { include: true, sourceScenarioCode: "EMBER-KEEP", placements: [] },
    map: {
      id: "sunken-chapel-v1",
      assetId: "map-main",
      name: "Sunken Chapel",
      description: "A flooded underground chapel.",
      sourcePrompt: "Flooded chapel",
      biome: "dungeon",
      mood: "torchlight",
      width: 24,
      height: 16,
      fog: {
        mode: "dynamic",
        sharedPolygon: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }],
        walls: [{ id: "wall-1", x1: 2, y1: 2, x2: 10, y2: 2 }],
        doors: [{ id: "door-1", x1: 10, y1: 2, x2: 11, y2: 2, open: false }],
        circles: [{ id: "column-1", x: 7, y: 7, radius: 0.5 }],
      },
      labels: [],
      notes: [],
    },
    handouts: [{ id: "clue", title: "The Waterlogged Clue", displayAssetId: "clue-display", thumbnailAssetId: "clue-thumb" }],
    creatures: [{
      catalogId: "drowned-guardian",
      create: {
        name: "Drowned Guardian",
        family: "undead",
        creatureType: "undead",
        size: "medium",
        defaultHp: 45,
        hitDice: "6d8+18",
        armorClass: 15,
        challengeRating: "3",
        speeds: { walk: 30, swim: 30, fly: null, climb: null, burrow: null },
        originalAssetId: "guardian-original",
        thumbnailAssetId: "guardian-thumb",
        provenance: ["DM supplied HP and AC", "SRD-derived speed"],
      },
      placements: [{ id: "guardian-1", x: 12, y: 8, hidden: true }],
    }],
    assumptions: [],
    reviewWarnings: ["Review the inferred west-wall door."],
    ...overrides,
  };
}

test("provisioning manifests normalize into a deterministic contract", () => {
  const parsed = parseScenarioProvisioningManifest(manifest());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.manifest.map.fog.walls.length, 1);
  assert.equal(parsed.manifest.creatures[0].create.speeds.swim, 30);
  assert.equal(parsed.canonicalJson, canonicalScenarioProvisioningJson(parsed.manifest));
  assert.equal(canonicalScenarioProvisioningJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test("asset requirements are derived rather than trusted from email", () => {
  const parsed = parseScenarioProvisioningManifest(manifest());
  assert.equal(parsed.ok, true);
  assert.deepEqual(requiredScenarioProvisioningAssets(parsed.manifest).map(({ id, kind, expectedWidth, expectedHeight }) => ({ id, kind, expectedWidth, expectedHeight })), [
    { id: "map-main", kind: "map", expectedWidth: 3072, expectedHeight: 2048 },
    { id: "clue-display", kind: "handout-display", expectedWidth: undefined, expectedHeight: undefined },
    { id: "clue-thumb", kind: "handout-thumbnail", expectedWidth: undefined, expectedHeight: undefined },
    { id: "guardian-original", kind: "creature-original", expectedWidth: undefined, expectedHeight: undefined },
    { id: "guardian-thumb", kind: "creature-thumbnail", expectedWidth: undefined, expectedHeight: undefined },
  ]);
});

test("unsafe, ambiguous, and duplicate manifest data is rejected", () => {
  const revision = manifest({ operation: "revise", targetScenarioCode: null, party: { include: true } });
  const invalidRevision = parseScenarioProvisioningManifest(revision);
  assert.equal(invalidRevision.ok, false);
  assert.match(invalidRevision.errors.join(" "), /targetScenarioCode/);
  assert.match(invalidRevision.errors.join(" "), /cannot recopy/);

  const duplicate = manifest({
    handouts: [
      { id: "one", title: "One", displayAssetId: "same", thumbnailAssetId: "thumb-1" },
      { id: "two", title: "Two", displayAssetId: "same", thumbnailAssetId: "thumb-2" },
    ],
  });
  const invalidDuplicate = parseScenarioProvisioningManifest(duplicate);
  assert.equal(invalidDuplicate.ok, false);
  assert.match(invalidDuplicate.errors.join(" "), /asset ID must be unique/);

  const unsafeReplacement = parseScenarioProvisioningManifest(manifest({
    handouts: [{ id: "clue", title: "Clue", displayAssetId: "clue-display", thumbnailAssetId: "clue-thumb", replaceHandoutId: "existing-handout" }],
  }));
  assert.equal(unsafeReplacement.ok, false);
  assert.match(unsafeReplacement.errors.join(" "), /cannot replace an existing handout/);

  const invalidSpeed = structuredClone(manifest());
  invalidSpeed.creatures[0].create.speeds.fly = 999;
  const rejectedSpeed = parseScenarioProvisioningManifest(invalidSpeed);
  assert.equal(rejectedSpeed.ok, false);
  assert.match(rejectedSpeed.errors.join(" "), /metadata is incomplete or invalid/);
});

test("map packages use job-scoped assets and preserve starter fog geometry", () => {
  const parsed = parseScenarioProvisioningManifest(manifest());
  assert.equal(parsed.ok, true);
  const map = buildProvisionedMapPackage(parsed.manifest.map, "job-123", 999);
  assert.equal(map.visual.assetUrl, "/map-assets/provisioned/job-123/map-main.jpg");
  assert.equal(map.visual.pixelWidth, 3072);
  assert.equal(map.fog.doors[0].id, "door-1");
  assert.equal(map.createdAt, 999);
});

test("job transitions are explicit and terminal ready jobs cannot mutate", () => {
  assert.equal(scenarioProvisioningTransitionError("received", "generating"), null);
  assert.equal(scenarioProvisioningTransitionError("failed", "staging"), null);
  assert.match(scenarioProvisioningTransitionError("ready", "parsing"), /cannot move/);
});

test("PNG inspection reads dimensions without browser APIs", () => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([0, 0, 0, 16], 16);
  bytes.set([0, 0, 0, 32], 20);
  assert.deepEqual(inspectPng(bytes), { width: 16, height: 32 });
  assert.equal(inspectPng(new Uint8Array(24)), null);
});
