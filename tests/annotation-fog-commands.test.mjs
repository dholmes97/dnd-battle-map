import assert from "node:assert/strict";
import test from "node:test";

import {
  addAnnotation,
  clearAnnotations,
  removeAnnotation,
  setFogMode,
  setStrictMovement,
  setVisionDoorOpen,
} from "../worker/commands/annotation-fog-commands.ts";
import { testMapPackage } from "./fixtures/map-fixture.ts";

function fixture(overrides = {}) {
  const calls = [];
  const map = testMapPackage();
  map.fog.doors = [{ id: "door-1", x1: 1, y1: 2, x2: 3, y2: 4, open: false }];
  return {
    calls,
    context: {
      encounter: {
        id: "encounter-1",
        code: "TEST",
        name: "Test",
        version: 1,
        status: "setup",
        activeMapImageId: map.id,
        activeMapSetupJson: null,
        activeMapPackageJson: JSON.stringify(map),
        draftMapImageId: map.id,
        draftMapSetupJson: null,
        gridWidth: map.width,
        gridHeight: map.height,
        currentRound: 0,
        activeInitiativeOrder: null,
        strictMovement: true,
        updatedAt: 1,
      },
      participant: { id: "dm-1", name: "Kevin", role: "dm" },
      payload: {},
      now: 1000,
      repository: {
        updateStrictMovement: async (...args) => calls.push(["strict", ...args]),
        updateActiveMapSetup: async (...args) => calls.push(["map", ...args]),
        insertAnnotation: async (...args) => { calls.push(["insert", ...args]); return true; },
        listDurableAnnotations: async () => [{ id: "line-1", annotationType: "drawing", x: 1, y: 1, x2: 2, y2: 2, color: "#fff", label: null, createdBy: "player-1", expiresAt: null, createdAt: 10 }],
        clearDurableAnnotations: async (...args) => calls.push(["clear", ...args]),
        findAnnotation: async () => ({ id: "line-1", annotationType: "drawing", x: 1, y: 1, x2: 2, y2: 2, color: "#fff", label: null, createdBy: "player-1", expiresAt: null, createdAt: 10 }),
        removeAnnotation: async (...args) => { calls.push(["remove", ...args]); return true; },
      },
      services: {
        createId: () => "annotation-1",
        loadState: async () => ({ marker: "state" }),
        commit: async (...args) => calls.push(["commit", ...args]),
        commitFor: async (...args) => calls.push(["commit-for", ...args]),
      },
      ...overrides,
    },
  };
}

test("fog handlers authorize the DM and persist only through their port", async () => {
  const setup = fixture({ payload: { mode: "shared" } });
  const result = await setFogMode(setup.context);
  assert.equal(result.payload.updated, true);
  assert.equal(setup.calls[0][0], "map");
  const saved = JSON.parse(setup.calls[0][2]);
  assert.equal(saved.fog.mode, "shared");
  assert.equal(saved.fog.sharedPolygon.length, 8);
  assert.deepEqual(setup.calls.slice(1).map((call) => call[0]), ["commit"]);
});

test("strict movement is a validated DM-only setting", async () => {
  const player = fixture({
    participant: { id: "player-1", name: "Dan", role: "player" },
    payload: { enabled: false },
  });
  assert.equal((await setStrictMovement(player.context)).status, 403);
  assert.deepEqual(player.calls, []);
  const dm = fixture({ payload: { enabled: false } });
  assert.equal((await setStrictMovement(dm.context)).payload.updated, true);
  assert.deepEqual(dm.calls[0], ["strict", "encounter-1", false, 1000]);
});

test("vision doors update one matching geometry entry", async () => {
  const setup = fixture({ payload: { doorId: "door-1", open: true } });
  assert.equal((await setVisionDoorOpen(setup.context)).payload.updated, true);
  const saved = JSON.parse(setup.calls[0][2]);
  assert.equal(saved.fog.doors[0].open, true);
});

test("transient pings get expiry while durable drawings do not", async () => {
  const ping = fixture({ payload: { annotationType: "ping", x: 2, y: 3 } });
  await addAnnotation(ping.context);
  assert.equal(ping.calls[0][2].expiresAt, 3000);
  const drawing = fixture({ payload: { annotationType: "drawing", x: 2, y: 3, x2: 4, y2: 5 } });
  await addAnnotation(drawing.context);
  assert.equal(drawing.calls[0][2].expiresAt, null);
});

test("drawings reject missing, non-finite, and out-of-map second endpoints", async () => {
  for (const payload of [
    { annotationType: "drawing", x: 2, y: 3 },
    { annotationType: "drawing", x: 2, y: 3, x2: Number.MAX_VALUE, y2: 5 },
    { annotationType: "drawing", x: 2, y: 3, x2: 4, y2: Number.POSITIVE_INFINITY },
    { annotationType: "drawing", x: 2, y: 3, x2: 4, y2: 99 },
    { annotationType: "ping", x: 2, y: 3, x2: 4 },
  ]) {
    const setup = fixture({ payload });
    assert.equal((await addAnnotation(setup.context)).status, 400);
    assert.deepEqual(setup.calls, []);
  }
});

test("annotation quota failures do not bump state or record history", async () => {
  const setup = fixture({
    payload: { annotationType: "drawing", x: 2, y: 3, x2: 4, y2: 5 },
    repository: {
      ...fixture().context.repository,
      insertAnnotation: async () => false,
    },
  });
  assert.equal((await addAnnotation(setup.context)).status, 409);
  assert.deepEqual(setup.calls, []);
});

test("players can erase only their own durable drawings", async () => {
  const player = fixture({ participant: { id: "other", name: "Dan", role: "player" }, payload: { annotationId: "line-1" } });
  assert.equal((await removeAnnotation(player.context)).status, 403);
  assert.equal(player.calls.length, 0);
  const owner = fixture({ participant: { id: "player-1", name: "Dan", role: "player" }, payload: { annotationId: "line-1" } });
  assert.equal((await removeAnnotation(owner.context)).payload.removed, true);
  assert.equal(owner.calls[0][0], "remove");
});

test("clearing snapshots durable drawings for atomic history and leaves transients outside the operation", async () => {
  const setup = fixture();
  const result = await clearAnnotations(setup.context);
  assert.equal(result.payload.cleared, true);
  assert.equal(result.payload.count, 1);
  assert.deepEqual(setup.calls[0], ["clear", "encounter-1"]);
  assert.equal(setup.calls[1][0], "commit");
  assert.equal(setup.calls[1][1], "annotations_cleared");
  assert.equal(setup.calls[1][2].annotations[0].annotationType, "drawing");
});

test("clearing no drawings is a controlled no-op without a version or history write", async () => {
  const setup = fixture({
    repository: {
      ...fixture().context.repository,
      listDurableAnnotations: async () => [],
    },
  });
  const result = await clearAnnotations(setup.context);
  assert.equal(result.status, 409);
  assert.match(result.payload.error, /no durable drawings/i);
  assert.deepEqual(setup.calls, []);
});
