import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseMapPackage } from "../shared/map-package.ts";
import { FULL_SCENE_MAPS, createFullSceneMap } from "../shared/full-scene-maps.ts";

test("full-scene maps are package-safe production assets", async () => {
  const workerSource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.equal(FULL_SCENE_MAPS.length, 17);
  for (const definition of FULL_SCENE_MAPS) {
    const map = createFullSceneMap(definition);
    const parsed = parseMapPackage(JSON.parse(JSON.stringify(map)));
    assert.equal(parsed?.visual.pixelWidth, 3072);
    assert.equal(parsed?.visual.pixelHeight, 2048);
    assert.equal(parsed?.width, definition.width ?? 24);
    assert.equal(parsed?.height, definition.height ?? 16);
    assert.equal(parsed?.visual.assetUrl, definition.assetUrl);
    assert.equal(parsed?.fog.sharedPolygon.length, 8);
    assert.equal("terrain" in map, false);
    assert.equal("stamps" in map, false);

    const jpg = await readFile(new URL(`../public/assets/full-map-seeds/${definition.assetUrl.split("/").pop()}`, import.meta.url));
    assert.deepEqual([...jpg.subarray(0, 3)], [255, 216, 255], `${definition.id} JPEG signature`);
    assert.ok(jpg.length > 1_000_000, `${definition.id} should retain production detail`);
    const thumbnail = await readFile(new URL(`../public/assets/full-map-thumbnails/${definition.assetUrl.split("/").pop()}`, import.meta.url));
    assert.deepEqual([...thumbnail.subarray(0, 3)], [255, 216, 255], `${definition.id} thumbnail JPEG signature`);
    assert.ok(thumbnail.length > 10_000 && thumbnail.length < 100_000, `${definition.id} should use a compact decoded-memory preview`);
    assert.match(workerSource, new RegExp(`"${definition.assetUrl.split("/").pop()}"`), `${definition.id} should be publicly served`);
  }
  assert.deepEqual(FULL_SCENE_MAPS.filter((definition) => definition.width === 45).map((definition) => [definition.id, definition.width, definition.height]), [
    ["cliffside-switchbacks-v1", 45, 30],
    ["underwater-ruins-v1", 45, 30],
  ]);
});

test("full-scene packages round-trip with map annotations", () => {
  const map = createFullSceneMap(FULL_SCENE_MAPS[0]);
  map.walls.push({ id: "wall-1", x1: 1, y1: 1, x2: 5, y2: 1, style: "stone" });
  map.portals.push({ id: "door-1", x: 3, y: 1, orientation: "horizontal", kind: "door", open: false });
  map.labels.push({ id: "label-1", x: 8, y: 5, text: "Old trail", visibility: "everyone" });
  map.notes.push({ id: "note-1", x: 9, y: 4, text: "Hidden cache" });
  map.fog = { mode: "dynamic", sharedPolygon: map.fog.sharedPolygon, walls: [{ id: "vision-wall-1", x1: 2, y1: 2, x2: 2, y2: 8 }], doors: [{ id: "vision-door-1", x1: 2, y1: 4, x2: 2, y2: 5, open: false }], circles: [{ id: "vision-rock-1", x: 10, y: 8, radius: 1.5 }] };
  assert.deepEqual(parseMapPackage(JSON.parse(JSON.stringify(map))), map);
});

test("validation rejects old editor packages, external images, and oversized data", () => {
  const valid = createFullSceneMap(FULL_SCENE_MAPS[0]);
  assert.equal(parseMapPackage({ ...valid, visual: undefined, terrain: Array(384).fill("grass"), stamps: [] }), null);
  assert.equal(parseMapPackage({ ...valid, visual: { ...valid.visual, assetUrl: "https://example.com/map.jpg" } }), null);
  assert.equal(parseMapPackage({ ...valid, width: 49 }), null);
  assert.equal(parseMapPackage({ ...valid, fog: { ...valid.fog, walls: Array.from({ length: 161 }, (_, index) => ({ id: `w-${index}`, x1: 0, y1: 0, x2: 1, y2: 1 })) } }), null);
  assert.equal(parseMapPackage({ ...valid, fog: { ...valid.fog, circles: Array.from({ length: 33 }, (_, index) => ({ id: `c-${index}`, x: 1, y: 1, radius: 0.5 })) } }), null);
  assert.equal(parseMapPackage({ ...valid, format: "unknown-map" }), null);
});

test("legacy sticker fields are accepted but discarded", () => {
  const map = createFullSceneMap(FULL_SCENE_MAPS[0]);
  const parsed = parseMapPackage({
    ...map,
    visual: { ...map.visual, sceneKitId: "forest" },
    sceneObjects: [{ id: "old-sticker", assetUrl: "/map-assets/scene-kits/forest-log.png" }],
  });
  assert.ok(parsed);
  assert.equal("sceneObjects" in parsed, false);
  assert.equal("sceneKitId" in parsed.visual, false);
});

test("map packages preserve deliberately simplified shared-fog polygons", () => {
  const map = createFullSceneMap(FULL_SCENE_MAPS[0]);
  map.fog.sharedPolygon = [
    { x: 0, y: 0 },
    { x: map.width, y: 0 },
    { x: map.width, y: map.height },
    { x: 0, y: map.height },
  ];
  assert.equal(parseMapPackage(JSON.parse(JSON.stringify(map)))?.fog.sharedPolygon.length, 4);
});
