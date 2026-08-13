import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseMapPackage } from "../shared/map-package.ts";
import { FULL_SCENE_MAPS, MAP_SOURCE_PIXELS_PER_CELL, createFullSceneMap } from "../shared/full-scene-maps.ts";

test("full-scene maps are package-safe production assets", async () => {
  const workerSource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.equal(FULL_SCENE_MAPS.length, 17);
  for (const definition of FULL_SCENE_MAPS) {
    const map = createFullSceneMap(definition);
    const parsed = parseMapPackage(JSON.parse(JSON.stringify(map)));
    assert.equal(parsed?.visual.pixelWidth, parsed?.width * MAP_SOURCE_PIXELS_PER_CELL);
    assert.equal(parsed?.visual.pixelHeight, parsed?.height * MAP_SOURCE_PIXELS_PER_CELL);
    assert.equal(parsed?.width, definition.width ?? 24);
    assert.equal(parsed?.height, definition.height ?? 16);
    assert.equal(parsed?.visual.assetUrl, definition.assetUrl);
    assert.equal(parsed?.fog.sharedPolygon.length, 8);
    assert.equal("terrain" in map, false);
    assert.equal("stamps" in map, false);

    const jpg = await readFile(new URL(`../public/assets/full-map-seeds/${definition.assetUrl.split("/").pop()}`, import.meta.url));
    assert.deepEqual([...jpg.subarray(0, 3)], [255, 216, 255], `${definition.id} JPEG signature`);
    assert.ok(jpg.length > 1_000_000, `${definition.id} should retain production detail`);
    assert.deepEqual(jpegDimensions(jpg), { width: map.visual.pixelWidth, height: map.visual.pixelHeight }, `${definition.id} source dimensions`);
    const thumbnail = await readFile(new URL(`../public/assets/full-map-thumbnails/${definition.assetUrl.split("/").pop()}`, import.meta.url));
    assert.deepEqual([...thumbnail.subarray(0, 3)], [255, 216, 255], `${definition.id} thumbnail JPEG signature`);
    assert.ok(thumbnail.length > 10_000 && thumbnail.length < 100_000, `${definition.id} should use a compact decoded-memory preview`);
    assert.match(workerSource, new RegExp(`"${definition.assetUrl.split("/").pop()}"`), `${definition.id} should be publicly served`);
  }
  assert.deepEqual(FULL_SCENE_MAPS.filter((definition) => definition.width === 45).map((definition) => [definition.id, definition.width, definition.height, createFullSceneMap(definition).visual.pixelWidth, createFullSceneMap(definition).visual.pixelHeight]), [
    ["cliffside-switchbacks-v2", 45, 30, 5760, 3840],
    ["underwater-ruins-v2", 45, 30, 5760, 3840],
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

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error("Invalid JPEG marker");
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = buffer.readUInt16BE(offset);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw new Error("JPEG dimensions not found");
}
