import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAP_SIZES,
  STAMP_LIBRARY,
  composeMapFromPrompt,
  effectiveStampRotation,
  generateMap,
  parseMapPackage,
  stampVariantFor,
} from "../shared/map-package.ts";
import { ADDITIONAL_MAP_PROMPT_CASES, MAP_PROMPT_CASES } from "../shared/map-prompt-cases.ts";
import { FULL_SCENE_MAPS, SCENE_KITS, createFullSceneMap } from "../shared/full-scene-maps.ts";

test("full-scene maps and their matched scene kits are package-safe production assets", async () => {
  assert.equal(FULL_SCENE_MAPS.length, 3);
  for (const definition of FULL_SCENE_MAPS) {
    const map = createFullSceneMap(definition);
    const parsed = parseMapPackage(JSON.parse(JSON.stringify(map)));
    assert.equal(parsed?.visual?.pixelWidth, 3072);
    assert.equal(parsed?.visual?.pixelHeight, 2048);
    assert.equal(parsed?.visual?.assetUrl, definition.assetUrl);
    const jpg = await readFile(new URL(`../public/assets/full-map-seeds/${definition.assetUrl.split("/").pop()}`, import.meta.url));
    assert.deepEqual([...jpg.subarray(0, 3)], [255, 216, 255], `${definition.id} JPEG signature`);
    assert.ok(jpg.length > 1_000_000, `${definition.id} should retain production detail`);
    const kit = SCENE_KITS[definition.sceneKitId];
    assert.equal(kit.length, 2);
    for (const item of kit) {
      const png = await readFile(new URL(`../public/assets/full-map-seeds/${item.assetUrl.replace("/map-assets/", "")}`, import.meta.url));
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${item.id} PNG signature`);
      assert.equal(png[25], 6, `${item.id} must preserve RGBA transparency`);
    }
  }
});

test("every map stamp has five finished transparent raster variants", async () => {
  assert.equal(STAMP_LIBRARY.length, 50);
  const assets = STAMP_LIBRARY.flatMap((stamp) => stamp.assets);
  assert.equal(assets.length, 250);
  assert.equal(new Set(assets).size, assets.length);
  for (const stamp of STAMP_LIBRARY) {
    assert.equal(stamp.assets.length, 5, `${stamp.id} variant count`);
    for (const asset of stamp.assets) {
      assert.match(asset, /^\/assets\/map-stamps\/.+-0[1-5]\.png$/);
      const png = await readFile(new URL(`../public${asset}`, import.meta.url));
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${stamp.id} PNG signature`);
      assert.equal(png[25], 6, `${stamp.id} must preserve RGBA transparency`);
    }
  }
});

test("stamp art choices are seed-stable and fixed-perspective pieces never rotate", () => {
  for (const definition of STAMP_LIBRARY) {
    const first = stampVariantFor(definition, "VARIANT-SEED", `${definition.id}-example`);
    const second = stampVariantFor(definition, "VARIANT-SEED", `${definition.id}-example`);
    assert.equal(first, second, `${definition.id} stable variant`);
    assert.ok(first >= 0 && first < 5, `${definition.id} valid variant`);
    if (definition.rotationMode === "fixed") {
      assert.equal(effectiveStampRotation(definition, 90), 0, `${definition.id} fixed at zero degrees`);
      assert.equal(effectiveStampRotation(definition, 270), 0, `${definition.id} fixed at zero degrees`);
    }
  }
});

test("every procedural environment produces a deterministic valid editable package", () => {
  for (const biome of ["forest", "dungeon", "cave", "ruins", "swamp", "desert", "tundra", "volcanic", "coast"]) {
    const settings = {
      biome,
      size: "standard",
      density: "balanced",
      pathStyle: biome === "dungeon" ? "none" : "winding",
      water: biome === "dungeon" || biome === "ruins" ? "none" : "pond",
      landmarks: 2,
      mood: biome === "ruins" ? "moonlight" : biome === "dungeon" || biome === "cave" ? "torchlight" : "daylight",
      seed: `TEST-${biome.toUpperCase()}`,
    };
    const first = generateMap(settings);
    const second = generateMap(settings);
    assert.deepEqual(first.terrain, second.terrain, `${biome} terrain must be seeded`);
    assert.deepEqual(first.stamps, second.stamps, `${biome} stamps must be seeded`);
    assert.deepEqual(first.walls, second.walls, `${biome} walls must be seeded`);
    assert.equal(first.terrain.length, MAP_SIZES.standard.width * MAP_SIZES.standard.height);
    assert.equal(parseMapPackage(first)?.biome, biome);
    for (const stamp of first.stamps) assert.ok(STAMP_LIBRARY.some((definition) => definition.id === stamp.definitionId));
  }
});

test("prompt cases detect their intended map language and remain package-safe", () => {
  for (const promptCase of MAP_PROMPT_CASES) {
    const composition = composeMapFromPrompt(promptCase.prompt, promptCase.seed);
    assert.equal(composition.map.biome, promptCase.expectedBiome, promptCase.id);
    assert.equal(composition.map.mood, promptCase.expectedMood, promptCase.id);
    assert.ok(composition.detectedFeatures.includes(promptCase.requiredFeature), `${promptCase.id} should detect ${promptCase.requiredFeature}`);
    if (promptCase.requiredStamp) assert.ok(composition.map.stamps.some((stamp) => stamp.definitionId === promptCase.requiredStamp), `${promptCase.id} should place ${promptCase.requiredStamp}`);
    if (promptCase.distinctiveTerrain) assert.ok(composition.map.terrain.includes(promptCase.distinctiveTerrain), `${promptCase.id} should include ${promptCase.distinctiveTerrain}`);
    assert.equal(composition.map.source.prompt, promptCase.prompt);
    assert.ok(parseMapPackage(JSON.parse(JSON.stringify(composition.map))), `${promptCase.id} should survive export/import`);
  }
});

test("the additional AI map catalog contains twenty materially distinct themes", () => {
  assert.equal(ADDITIONAL_MAP_PROMPT_CASES.length, 20);
  assert.equal(new Set(ADDITIONAL_MAP_PROMPT_CASES.map((item) => item.id)).size, 20);
  assert.equal(new Set(ADDITIONAL_MAP_PROMPT_CASES.map((item) => item.prompt)).size, 20);
  assert.equal(new Set(ADDITIONAL_MAP_PROMPT_CASES.map((item) => item.seed)).size, 20);
  const themeSignatures = ADDITIONAL_MAP_PROMPT_CASES.map((item) => [item.expectedBiome, item.expectedMood, item.requiredFeature, item.requiredStamp, item.distinctiveTerrain].join("|"));
  assert.equal(new Set(themeSignatures).size, 20, "every added map must have a distinct theme signature");
  const packageFingerprints = ADDITIONAL_MAP_PROMPT_CASES.map((item) => {
    const map = composeMapFromPrompt(item.prompt, item.seed).map;
    return JSON.stringify({ biome: map.biome, mood: map.mood, terrain: map.terrain, stamps: map.stamps, walls: map.walls });
  });
  assert.equal(new Set(packageFingerprints).size, 20, "every added prompt must generate a distinct editable package");
});

test("package validation rejects malformed or oversized maps", () => {
  const valid = composeMapFromPrompt(MAP_PROMPT_CASES[0].prompt, MAP_PROMPT_CASES[0].seed).map;
  assert.equal(parseMapPackage({ ...valid, width: 49 }), null);
  assert.equal(parseMapPackage({ ...valid, terrain: valid.terrain.slice(1) }), null);
  assert.equal(parseMapPackage({ ...valid, terrain: valid.terrain.map((kind, index) => index === 0 ? "void" : kind) }), null);
  assert.equal(parseMapPackage({ ...valid, format: "unknown-map" }), null);
});
