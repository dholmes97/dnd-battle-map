import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseMapPackage } from "../shared/map-package.ts";
import { FULL_SCENE_MAPS, SCENE_KITS, createFullSceneMap } from "../shared/full-scene-maps.ts";

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
    assert.deepEqual(parsed?.sceneObjects, []);
    assert.equal("terrain" in map, false);
    assert.equal("stamps" in map, false);

    const jpg = await readFile(new URL(`../public/assets/full-map-seeds/${definition.assetUrl.split("/").pop()}`, import.meta.url));
    assert.deepEqual([...jpg.subarray(0, 3)], [255, 216, 255], `${definition.id} JPEG signature`);
    assert.ok(jpg.length > 1_000_000, `${definition.id} should retain production detail`);
    const thumbnail = await readFile(new URL(`../public/assets/full-map-thumbnails/${definition.assetUrl.split("/").pop()}`, import.meta.url));
    assert.deepEqual([...thumbnail.subarray(0, 3)], [255, 216, 255], `${definition.id} thumbnail JPEG signature`);
    assert.ok(thumbnail.length > 10_000 && thumbnail.length < 100_000, `${definition.id} should use a compact decoded-memory preview`);
    assert.match(workerSource, new RegExp(`"${definition.assetUrl.split("/").pop()}"`), `${definition.id} should be publicly served`);
    const kit = SCENE_KITS[definition.sceneKitId];
    assert.ok(kit, `${definition.id} should reference a known scene kit`);
    assert.equal(kit.length, definition.sceneKitId === "none" ? 0 : 2);
    for (const item of kit) {
      const png = await readFile(new URL(`../public/assets/full-map-seeds/${item.assetUrl.replace("/map-assets/", "")}`, import.meta.url));
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${item.id} PNG signature`);
      assert.equal(png[25], 6, `${item.id} must preserve RGBA transparency`);
    }
  }
  assert.deepEqual(FULL_SCENE_MAPS.filter((definition) => definition.width === 45).map((definition) => [definition.id, definition.width, definition.height]), [
    ["cliffside-switchbacks-v1", 45, 30],
    ["underwater-ruins-v1", 45, 30],
  ]);
});

test("full-scene packages round-trip with semantic additions", () => {
  const map = createFullSceneMap(FULL_SCENE_MAPS[0]);
  map.sceneObjects.push({ id: "log-1", definitionId: "forest-log", assetUrl: "/map-assets/scene-kits/forest-log.png", x: 4, y: 6, width: 5, height: 5, rotation: 90 });
  map.walls.push({ id: "wall-1", x1: 1, y1: 1, x2: 5, y2: 1, style: "stone" });
  map.portals.push({ id: "door-1", x: 3, y: 1, orientation: "horizontal", kind: "door", open: false });
  map.labels.push({ id: "label-1", x: 8, y: 5, text: "Old trail", visibility: "everyone" });
  map.notes.push({ id: "note-1", x: 9, y: 4, text: "Hidden cache" });
  assert.deepEqual(parseMapPackage(JSON.parse(JSON.stringify(map))), map);
});

test("validation rejects old editor packages, external images, and oversized data", () => {
  const valid = createFullSceneMap(FULL_SCENE_MAPS[0]);
  assert.equal(parseMapPackage({ ...valid, visual: undefined, terrain: Array(384).fill("grass"), stamps: [] }), null);
  assert.equal(parseMapPackage({ ...valid, visual: { ...valid.visual, assetUrl: "https://example.com/map.jpg" } }), null);
  assert.equal(parseMapPackage({ ...valid, width: 49 }), null);
  assert.equal(parseMapPackage({ ...valid, sceneObjects: Array(501).fill({ id: "x" }) }), null);
  assert.equal(parseMapPackage({ ...valid, format: "unknown-map" }), null);
});
