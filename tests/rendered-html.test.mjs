import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished encounter join surface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Ember Keep Encounter \| D&amp;D Battle Map<\/title>/i);
  assert.match(html, /Enter the Ember Keep/);
  assert.match(html, /Join encounter/);
  assert.match(html, /EMBER-KEEP/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Building your site/i);
});

test("removes starter artifacts and packages the D1 migration", async () => {
  const [packageText, hostingText, migrationFiles] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readdir(new URL("../drizzle/", import.meta.url)),
  ]);
  const packageJson = JSON.parse(packageText);
  const hosting = JSON.parse(hostingText);

  assert.equal(packageJson.name, "dnd-battle-map-poc");
  assert.equal(packageJson.dependencies["react-loading-skeleton"], undefined);
  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, null);
  assert.ok(migrationFiles.some((file) => file.endsWith(".sql")));
  await assert.rejects(access(new URL("../app/_sites-preview/", import.meta.url)));
});

test("keeps validated terrain textures at the expected canvas size", async () => {
  const terrainFiles = [
    ["terrain-dungeon-flagstone-01.png", 1024],
    ["terrain-meadow-grass-01.png", 1024],
    ["terrain-packed-earth-01.png", 1024],
    ["terrain-shallow-water-01.png", 1024],
    ["terrain-cave-floor-01.png", 1254],
    ["terrain-rubble-01.png", 1254],
    ["terrain-swamp-mud-01.png", 1254],
    ["terrain-desert-sand-01.png", 1254],
    ["terrain-tundra-snow-01.png", 1254],
    ["terrain-volcanic-ash-01.png", 1254],
    ["terrain-lava-crust-01.png", 1254],
  ];

  for (const [file, size] of terrainFiles) {
    const png = await readFile(
      new URL(`../public/assets/terrain/${file}`, import.meta.url),
    );
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${file} must be a PNG`,
    );
    assert.equal(png.readUInt32BE(16), size, `${file} width`);
    assert.equal(png.readUInt32BE(20), size, `${file} height`);
  }

  await access(projectRoot);
});

test("packages the transparent tactical token library", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../public/assets/tokens/manifest.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.assets.length, 20);
  assert.deepEqual(
    manifest.assets.slice(0, 3).map((asset) => asset.name),
    ["Dar'eleth", "Malichar Jarom", "Jelton Mercury"],
  );
  for (const asset of manifest.assets) {
    const png = await readFile(new URL(`../public${asset.path}`, import.meta.url));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 1254, `${asset.id} width`);
    assert.equal(png.readUInt32BE(20), 1254, `${asset.id} height`);
    assert.equal(png[25], 6, `${asset.id} must use RGBA color`);
  }
});

test("ships the drag-and-drop creature palette with durable size controls", async () => {
  const [clientSource, workerSource, catalogSource, sizeMigration] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../shared/creature-library.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0004_unique_smasher.sql", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /onDragStart=.*onPaletteDragStart/);
  assert.match(clientSource, /onDrop=\{onMapDrop\}/);
  assert.match(clientSource, /Click to place the selected creature/);
  assert.match(clientSource, /aria-label="Token size"/);
  assert.match(workerSource, /size TEXT DEFAULT 'medium' NOT NULL/);
  assert.match(workerSource, /clampTokenCoordinate\(requestedX, encounter\.grid_width, token\.size\)/);
  assert.match(sizeMigration, /ALTER TABLE `tokens` ADD `size` text DEFAULT 'medium' NOT NULL/);
  assert.equal((catalogSource.match(/id: "/g) ?? []).length, 17);
  for (const size of ["tiny", "small", "medium", "large", "huge", "gargantuan"]) {
    assert.match(catalogSource, new RegExp(`${size}: \\d`));
  }
});

test("keeps pings compact, audible, and limited to three pulses", async () => {
  const [clientSource, workerSource] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /const PING_PULSE_COUNT = 3;/);
  assert.match(clientSource, /const PING_PULSE_MS = 420;/);
  assert.match(clientSource, /createOscillator\(\)/);
  assert.match(clientSource, /0\.12 \+ pulseProgress \* 0\.2/);
  assert.match(workerSource, /const PING_TTL_MS = 2_000;/);
  assert.doesNotMatch(workerSource, /now \+ 10_000/);
});

test("keeps authoritative movement-rule rejections visible on the map", async () => {
  const [clientSource, workerSource] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /className="map-message is-error" role="alert"/);
  assert.match(workerSource, /token\.initiative_order !== null &&/);
});

test("moves immediately on pointer release without token reservations", async () => {
  const [clientSource, workerSource, retiredLocksMigration] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0005_new_leo.sql", import.meta.url), "utf8"),
  ]);

  assert.match(
    clientSource,
    /dragGestureRef\.current = null; setPreview\(\{ tokenId: gesture\.tokenId, \.\.\.gesture\.latest \}\)/,
  );
  assert.match(
    clientSource,
    /void publishMove\(gesture\.tokenId, gesture\.latest\);/,
  );
  assert.doesNotMatch(clientSource, /Movement reserved|Being moved by|\/lock|\/unlock|lockState/);
  assert.doesNotMatch(workerSource, /\(join\|state\|events\|heartbeat\|claim\|relinquish\|lock\|move\|unlock\|command\)/);
  assert.doesNotMatch(workerSource, /action === "lock"|lock_owner_id|lock_expires_at/);
  assert.match(workerSource, /WHERE id = \? AND encounter_id = \?`,\s+\)\s+\.bind\(x, y, movementUsed, now, tokenId, encounter\.id\)/);
  assert.match(retiredLocksMigration, /DROP COLUMN `lock_owner_id`/);
  assert.match(retiredLocksMigration, /DROP COLUMN `lock_owner_name`/);
  assert.match(retiredLocksMigration, /DROP COLUMN `lock_expires_at`/);
});

test("shows a straight movement ruler and never rejects movement overage", async () => {
  const [clientSource, workerSource] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /context\.setLineDash\(\[3, 7\]\)/);
  assert.match(clientSource, /context\.moveTo\(startX, startY\);\s+context\.lineTo\(endX, endY\)/);
  assert.match(clientSource, /context\.arc\(startX, startY, 5/);
  assert.match(clientSource, /const label = `\$\{distance\} ft`/);
  assert.match(clientSource, /overMovement \? "#ef6656" : "#f5c65c"/);
  assert.doesNotMatch(clientSource, /gesture\.path|previewPath/);
  assert.match(workerSource, /const overBudget = encounter\.status === "active" && distance > remainingBeforeMove \+ 0\.05/);
  assert.doesNotMatch(workerSource, /body\.path|pathDistance|remains this turn/);
});

test("keeps effect preset fields collapsed until requested", async () => {
  const clientSource = await readFile(
    new URL("../app/battle-map-prototype.tsx", import.meta.url),
    "utf8",
  );

  assert.match(clientSource, />\+ Effect<\/button>/);
  assert.match(clientSource, /effectEditorTokenId === token\.id \? <div className="compact-form effect-form">/);
  assert.match(clientSource, /aria-label="Effect preset"/);
  assert.match(clientSource, />Cancel<\/button>/);
});

test("makes initiative entry explicit and free of overlapping number steppers", async () => {
  const clientSource = await readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8");

  assert.match(clientSource, /inputMode="numeric" pattern="\[0-9\]\*"/);
  assert.match(clientSource, /onBlur=\{\(\) => void saveInitiative\(token\)\}/);
  assert.match(clientSource, /if \(event\.key === "Enter"\) event\.currentTarget\.blur\(\)/);
  assert.match(clientSource, /Saving…/);
  assert.match(clientSource, /Saved/);
  assert.doesNotMatch(clientSource, />Set<\/button>/);
});

test("keeps the tactical sidebar compact and reveals secondary editors on demand", async () => {
  const [clientSource, styles] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /<small>Size<\/small><strong>/);
  assert.match(clientSource, /<small>Speed<\/small><strong>\{token\.speed\} ft<\/strong>/);
  assert.match(clientSource, />\+ Effect<\/button>/);
  assert.match(clientSource, /className="inline-action" onClick=\{\(\) => void relinquishToken\(\)\}>Release token/);
  assert.match(clientSource, /tokenEditorTokenId === token\.id \? <div className="token-config">/);
  assert.match(clientSource, /Edit details/);
  assert.match(styles, /\.initiative-editor input \{ width: 3\.1rem/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) 18\.5rem/);
});

test("offers compact icon tools and precise line erasing", async () => {
  const [clientSource, workerSource, styles] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /type AnnotationMode = "move" \| "ping" \| "drawing" \| "erase" \| "spotlight"/);
  assert.match(clientSource, /drawingAtPoint\(state\.annotations, point/);
  assert.match(clientSource, /aria-label="Erase line"/);
  assert.match(clientSource, /aria-label="Move tokens"/);
  assert.match(clientSource, /data-tooltip="Move tokens"/);
  assert.match(clientSource, /data-tooltip="Erase line"/);
  assert.doesNotMatch(clientSource, />Move<\/button>|>Ping<\/button>|>Draw line<\/button>|>Erase<\/button>/);
  assert.match(workerSource, /if \(command === "remove-annotation"\)/);
  assert.match(workerSource, /You can only erase lines you drew/);
  assert.match(workerSource, /"annotation_removed"/);
  assert.match(styles, /\.map-toolbar \.icon-tool/);
  assert.match(styles, /\.map-toolbar \[data-tooltip\]::after/);
  assert.match(styles, /\[data-tooltip\]:focus-visible::after/);
});

test("includes the durable multi-biome map workshop, prompt composer, and irregular stamp proof", async () => {
  const [battleMapSource, workshopSource, packageSource, workerSource, mapMigration] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/map-workshop.tsx", import.meta.url), "utf8"),
    readFile(new URL("../shared/map-package.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0006_panoramic_scalphunter.sql", import.meta.url), "utf8"),
  ]);

  assert.match(battleMapSource, /Open Map Workshop/);
  assert.match(battleMapSource, /participant\.role === "dm" && workshopOpen/);
  assert.match(packageSource, /export function generateMap\(/);
  assert.match(packageSource, /export function randomFromSeed\(/);
  assert.match(packageSource, /export function composeMapFromPrompt\(/);
  for (const biome of ["forest", "dungeon", "cave", "ruins", "swamp", "desert", "tundra", "volcanic", "coast"]) assert.match(packageSource, new RegExp(`\\"${biome}\\"`));
  assert.match(packageSource, /name: "L-shaped grove"/);
  assert.match(packageSource, /two-by-two open notch/);
  assert.match(packageSource, /name: "Bone scatter"/);
  assert.match(packageSource, /name: "Rope bridge"/);
  assert.match(packageSource, /name: "Glow mushrooms"/);
  assert.match(packageSource, /name: "Broken fountain"/);
  assert.match(packageSource, /name: "Crates & barrels"/);
  assert.match(packageSource, /name: "Spike pit"/);
  assert.match(packageSource, /name: "Warding rune"/);
  assert.match(packageSource, /name: "Twisted mangroves"/);
  assert.match(packageSource, /name: "Wind-carved dunes"/);
  assert.match(packageSource, /name: "Ice spires"/);
  assert.match(packageSource, /name: "Lava vent"/);
  assert.match(packageSource, /name: "Coastal wreck"/);
  assert.match(workshopSource, /Rotate 90°/);
  assert.match(workshopSource, />Terrain<\/button>/);
  assert.match(workshopSource, />Wall<\/button>/);
  assert.match(workshopSource, />Door<\/button>/);
  assert.match(workshopSource, />Window<\/button>/);
  assert.match(workshopSource, />DM note<\/button>/);
  assert.match(workshopSource, /Undo draft/);
  assert.match(workshopSource, /onClick=\{flipSelected\}>Flip/);
  assert.match(workshopSource, /Private until applied/);
  assert.match(workshopSource, /draggable onDragStart=\{\(event\) => onStampDragStart/);
  assert.match(workshopSource, /onDragOver=\{onMapDragOver\} onDrop=\{onMapDrop\}/);
  assert.match(workshopSource, /Drag a piece onto the map/);
  assert.doesNotMatch(workshopSource, /onClick=\{\(\) => addStamp\(/);
  assert.match(packageSource, /const rotations: MapRotation\[\] = definition\.rotationMode === "fixed" \? \[0\] : \[0, 90, 180, 270\]/);
  assert.match(packageSource, /rotation = rotations\[Math\.floor\(random\(\) \* rotations\.length\)\]/);
  assert.match(workshopSource, /function createTerrainMask\(/);
  assert.match(workshopSource, /function organicEdgeNoise\(/);
  assert.match(workshopSource, /globalCompositeOperation = "destination-in"/);
  assert.match(workshopSource, /const bankBlur = Math\.max/);
  assert.match(workshopSource, />Crisp cells<\/button>/);
  assert.match(workshopSource, />Organic edges<\/button>/);
  assert.match(workshopSource, /underlying terrain still occupies exact grid cells/);
  assert.match(workshopSource, /Interpret prompt/);
  assert.match(workshopSource, /save-map-preset/);
  assert.match(workshopSource, /apply-map-package/);
  assert.match(workshopSource, /Map package exported/);
  assert.match(workshopSource, /Search stamp palette/);
  assert.match(workshopSource, /Map objects/);
  assert.match(workshopSource, /deleteMapObject/);
  assert.match(workshopSource, /paintGestureRef/);
  assert.match(workshopSource, /setWallPreview/);
  assert.match(workshopSource, />Duplicate<\/button>/);
  assert.match(workshopSource, />Bring front<\/button>/);
  assert.match(workerSource, /CREATE TABLE IF NOT EXISTS map_presets/);
  assert.match(workerSource, /map_package_applied/);
  assert.match(mapMigration, /CREATE TABLE `map_presets`/);
  assert.match(mapMigration, /ADD `grid_width` integer DEFAULT 16 NOT NULL/);

  const assets = [
    ["forest-ancient-oak-01.png", 768, 768],
    ["forest-l-grove-01.png", 768, 768],
    ["forest-fallen-log-01.png", 768, 384],
    ["cave-bone-lair-01.png", 768, 460],
    ["ruined-moon-shrine-01.png", 768, 639],
  ];
  for (const [file, width, height] of assets) {
    const png = await readFile(new URL(`../public/assets/map-stamps/${file}`, import.meta.url));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), width, `${file} width`);
    assert.equal(png.readUInt32BE(20), height, `${file} height`);
    assert.equal(png[25], 6, `${file} must preserve RGBA transparency`);
  }
});
