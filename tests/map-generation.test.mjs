import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMapPackageForImage, parseMapPackage } from "../shared/map-package.ts";
import { testMapPackage } from "./fixtures/map-fixture.ts";

const MAP_SOURCE_PIXELS_PER_CELL = 128;

test("full-scene maps are package-safe production assets", async () => {
  const workerSource = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const mapMigrations = await Promise.all([
    readFile(new URL("../drizzle/0028_volatile_bruce_banner.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0033_modern_maximus.sql", import.meta.url), "utf8"),
  ]);
  const mapImages = mapMigrations.flatMap(builtInMapImagesFromMigration);
  assert.equal(mapImages.length, 18);
  for (const mapImage of mapImages) {
    const map = createMapPackageForImage(mapImage);
    const parsed = parseMapPackage(JSON.parse(JSON.stringify(map)));
    assert.equal(parsed?.visual.pixelWidth, parsed?.width * MAP_SOURCE_PIXELS_PER_CELL);
    assert.equal(parsed?.visual.pixelHeight, parsed?.height * MAP_SOURCE_PIXELS_PER_CELL);
    assert.equal(parsed?.width, mapImage.gridWidth);
    assert.equal(parsed?.height, mapImage.gridHeight);
    assert.equal(parsed?.visual.assetUrl, mapImage.assetPath);
    assert.equal(parsed?.fog.sharedPolygon.length, 8);
    assert.equal("terrain" in map, false);
    assert.equal("stamps" in map, false);

    const filename = mapImage.assetPath.split("/").pop();
    const jpg = await readFile(new URL(`../public/assets/full-map-seeds/${filename}`, import.meta.url));
    assert.deepEqual([...jpg.subarray(0, 3)], [255, 216, 255], `${mapImage.id} JPEG signature`);
    assert.ok(jpg.length > 1_000_000, `${mapImage.id} should retain production detail`);
    assert.deepEqual(jpegDimensions(jpg), { width: map.visual.pixelWidth, height: map.visual.pixelHeight }, `${mapImage.id} source dimensions`);
    const thumbnail = await readFile(new URL(`../public/assets/full-map-thumbnails/${filename}`, import.meta.url));
    assert.deepEqual([...thumbnail.subarray(0, 3)], [255, 216, 255], `${mapImage.id} thumbnail JPEG signature`);
    assert.ok(thumbnail.length > 10_000 && thumbnail.length < 100_000, `${mapImage.id} should use a compact decoded-memory preview`);
  }
  assert.match(workerSource, /FROM map_images WHERE asset_path = \?/, "the durable catalog should authorize map assets without a second filename list");
  for (const mapImage of mapImages) assert.doesNotMatch(workerSource, new RegExp(`"${mapImage.assetPath.split("/").pop()}"`));
  assert.deepEqual(mapImages.filter((image) => image.gridWidth === 45).map((image) => [image.id, image.gridWidth, image.gridHeight, image.pixelWidth, image.pixelHeight]), [
    ["cliffside-switchbacks-v2", 45, 30, 5760, 3840],
    ["underwater-ruins-v2", 45, 30, 5760, 3840],
  ]);
  assert.deepEqual(mapImages.filter((image) => image.id === "qa-forest-hollow-v1").map((image) => [image.gridWidth, image.gridHeight, image.pixelWidth, image.pixelHeight]), [
    [16, 12, 2048, 1536],
  ]);
});

test("full-scene packages round-trip with map annotations", () => {
  const map = testMapPackage();
  map.walls.push({ id: "wall-1", x1: 1, y1: 1, x2: 5, y2: 1, style: "stone" });
  map.portals.push({ id: "door-1", x: 3, y: 1, orientation: "horizontal", kind: "door", open: false });
  map.labels.push({ id: "label-1", x: 8, y: 5, text: "Old trail", visibility: "everyone" });
  map.notes.push({ id: "note-1", x: 9, y: 4, text: "Hidden cache" });
  map.fog = { mode: "dynamic", sharedPolygon: map.fog.sharedPolygon, walls: [{ id: "vision-wall-1", x1: 2, y1: 2, x2: 2, y2: 8 }], doors: [{ id: "vision-door-1", x1: 2, y1: 4, x2: 2, y2: 5, open: false }], circles: [{ id: "vision-rock-1", x: 10, y: 8, radius: 1.5 }] };
  assert.deepEqual(parseMapPackage(JSON.parse(JSON.stringify(map))), map);
});

test("validation rejects old editor packages, external images, and oversized data", () => {
  const valid = testMapPackage();
  assert.equal(parseMapPackage({ ...valid, visual: undefined, terrain: Array(384).fill("grass"), stamps: [] }), null);
  assert.equal(parseMapPackage({ ...valid, visual: { ...valid.visual, assetUrl: "https://example.com/map.jpg" } }), null);
  assert.equal(parseMapPackage({ ...valid, width: 49 }), null);
  assert.equal(parseMapPackage({ ...valid, fog: { ...valid.fog, walls: Array.from({ length: 161 }, (_, index) => ({ id: `w-${index}`, x1: 0, y1: 0, x2: 1, y2: 1 })) } }), null);
  assert.equal(parseMapPackage({ ...valid, fog: { ...valid.fog, circles: Array.from({ length: 33 }, (_, index) => ({ id: `c-${index}`, x: 1, y: 1, radius: 0.5 })) } }), null);
  assert.equal(parseMapPackage({ ...valid, format: "unknown-map" }), null);
});

test("legacy sticker fields are accepted but discarded", () => {
  const map = testMapPackage();
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
  const map = testMapPackage();
  map.fog.sharedPolygon = [
    { x: 0, y: 0 },
    { x: map.width, y: 0 },
    { x: map.width, y: map.height },
    { x: 0, y: map.height },
  ];
  assert.equal(parseMapPackage(JSON.parse(JSON.stringify(map)))?.fog.sharedPolygon.length, 4);
});

function builtInMapImagesFromMigration(sql) {
  const rows = [];
  const rowPattern = /^\s*\('([^']+)', '((?:''|[^'])*)', '((?:''|[^'])*)', '([^']+)', '([^']+)', '([^']+)', (\d+), (\d+), (\d+), (\d+), 'built-in', NULL, 1, (\d+), (\d+)\)[,;]/gm;
  for (const match of sql.matchAll(rowPattern)) {
    rows.push({
      id: match[1],
      name: match[2].replaceAll("''", "'"),
      description: match[3].replaceAll("''", "'"),
      biome: match[4],
      mood: match[5],
      assetPath: match[6],
      gridWidth: Number(match[7]),
      gridHeight: Number(match[8]),
      pixelWidth: Number(match[9]),
      pixelHeight: Number(match[10]),
      sourceKind: "built-in",
      sourcePrompt: null,
      active: true,
      createdAt: Number(match[11]),
      updatedAt: Number(match[12]),
    });
  }
  return rows;
}

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
