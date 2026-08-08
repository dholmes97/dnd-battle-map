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
  assert.match(html, /Join as Dan \(Dar&#x27;eleth\)/);
  assert.match(html, /Join as Barry \(Jelton\)/);
  assert.match(html, /Join as Scott \(Malichar\)/);
  assert.match(html, /Join as Kevin \(DM\)/);
  assert.doesNotMatch(html, /Display name|Encounter code|<select/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Building your site/i);
});

test("stores creature originals and generated thumbnails in R2", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("asset-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const stored = new Map();
  let packagedReads = 0;
  const r2Object = (bytes) => ({
    body: new Response(bytes).body,
    arrayBuffer: async () => bytes.slice(0),
    httpEtag: '"test"',
  });
  const env = {
    ASSETS: {
      fetch: async () => {
        packagedReads += 1;
        return new Response(new Uint8Array(2_048).fill(17), { headers: { "content-type": "image/png" } });
      },
    },
    MAP_ASSETS: {
      get: async (key) => stored.has(key) ? r2Object(stored.get(key)) : null,
      put: async (key, value) => stored.set(key, value.slice(0)),
    },
    IMAGES: {
      input: () => ({
        transform: () => ({
          output: async () => ({ response: async () => new Response(new Uint8Array(512).fill(29)) }),
        }),
      }),
    },
  };
  const url = "http://localhost/creature-assets/tokens/creatures/imp-01.png?variant=thumbnail";
  const first = await worker.fetch(new Request(url), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-creature-asset-source"), "seeded-r2-thumbnail");
  assert.ok(stored.has("creature-catalog/thumbnails/tokens/creatures/imp-01.png"));
  const second = await worker.fetch(new Request(url), env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(second.headers.get("x-creature-asset-source"), "r2-thumbnail");
  assert.equal(packagedReads, 1);
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
  assert.equal(hosting.r2, "MAP_ASSETS");
  assert.ok(migrationFiles.some((file) => file.endsWith(".sql")));
  await assert.rejects(access(new URL("../app/_sites-preview/", import.meta.url)));
});

test("removes the retired editor art libraries", async () => {
  await assert.rejects(access(new URL("../public/assets/terrain/", import.meta.url)));
  await assert.rejects(access(new URL("../public/assets/map-stamps/", import.meta.url)));
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

test("ships the lazy storage-backed creature palette with durable size controls", async () => {
  const [clientSource, workerSource, catalogSource, schemaSource, sizeMigration, catalogMigration, catalogIndexMigration] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../shared/creature-library.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0004_unique_smasher.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0007_remarkable_kronos.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0008_strong_nightcrawler.sql", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /onDragStart=.*onPaletteDragStart/);
  assert.match(clientSource, /onDrop=\{onMapDrop\}/);
  assert.match(clientSource, /Click to place the selected creature/);
  assert.match(clientSource, /aria-label="Token size"/);
  assert.match(workerSource, /size TEXT DEFAULT 'medium' NOT NULL/);
  assert.match(workerSource, /clampTokenCoordinate\(requestedX, encounter\.grid_width, token\.size\)/);
  assert.match(workerSource, /resolveTokenControllerName\(token, tokenById\)/);
  assert.match(workerSource, /identityControlsToken\(participant, baseTokenControllerName\(current\)\)/);
  assert.match(clientSource, /controller: summoner\?\.controller \?\? \{ name: "Kevin" \}/);
  assert.match(clientSource, /api<CreatureCatalogPage>\(`\/api\/creatures/);
  assert.match(clientSource, /loading="lazy" unoptimized/);
  assert.doesNotMatch(clientSource, /CREATURE_CATALOG_SEED|CREATURE_LIBRARY/);
  assert.match(workerSource, /creature-catalog\/original/);
  assert.match(workerSource, /creature-catalog\/thumbnails/);
  assert.match(workerSource, /SELECT id, name, family, creature_type, size, default_hp, hit_dice/);
  assert.match(workerSource, /CATALOG_IMPORT_TOKEN/);
  assert.match(workerSource, /entries\.length === 0 \|\| entries\.length > 10/);
  assert.match(clientSource, /maxHp: creature\.defaultHp/);
  assert.match(clientSource, /AC \{creature\.armorClass\} · HP \{creature\.defaultHp\}/);
  assert.match(schemaSource, /sqliteTable\(\s*"creature_catalog"/);
  assert.match(catalogMigration, /CREATE TABLE `creature_catalog`/);
  assert.doesNotMatch(catalogMigration, /DROP TABLE `encounters`/);
  assert.match(catalogIndexMigration, /idx_creature_catalog_active_sort_id/);
  assert.match(sizeMigration, /ALTER TABLE `tokens` ADD `size` text DEFAULT 'medium' NOT NULL/);
  assert.equal((catalogSource.match(/creatureSeed\(\d+/g) ?? []).length, 17);
  const thumbnailFiles = (await readdir(new URL("../public/assets/creature-thumbnails/", import.meta.url), { recursive: true }))
    .filter((file) => file.endsWith(".png"));
  assert.equal(thumbnailFiles.length, 17);
  for (const thumbnailFile of thumbnailFiles) {
    const png = await readFile(new URL(`../public/assets/creature-thumbnails/${thumbnailFile}`, import.meta.url));
    assert.equal(png.readUInt32BE(16), 144, `${thumbnailFile} width`);
    assert.equal(png.readUInt32BE(20), 144, `${thumbnailFile} height`);
  }
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
  assert.match(clientSource, /pendingMovesRef\.current\.set\(tokenId, \{ \.\.\.destination, sequence \}\)/);
  assert.match(clientSource, /tokens: current\.tokens\.map\(\(token\) => token\.id === tokenId \? \{ \.\.\.token, \.\.\.destination \} : token\)/);
  assert.match(clientSource, /if \(pendingMovesRef\.current\.get\(tokenId\)\?\.sequence === sequence\) pendingMovesRef\.current\.delete\(tokenId\)/);
  assert.doesNotMatch(clientSource, /const publishMove[\s\S]{0,220}setBusy\(true\)/);
  assert.doesNotMatch(clientSource, /Movement reserved|Being moved by|\/lock|\/unlock|lockState/);
  assert.doesNotMatch(workerSource, /\(join\|state\|events\|heartbeat\|claim\|relinquish\|lock\|move\|unlock\|command\)/);
  assert.doesNotMatch(workerSource, /action === "lock"|lock_owner_id|lock_expires_at/);
  assert.match(workerSource, /WHERE id = \? AND encounter_id = \?`,\s+\)\s+\.bind\(x, y, movementUsed, now, tokenId, encounter\.id\)/);
  assert.match(retiredLocksMigration, /DROP COLUMN `lock_owner_id`/);
  assert.match(retiredLocksMigration, /DROP COLUMN `lock_owner_name`/);
  assert.match(retiredLocksMigration, /DROP COLUMN `lock_expires_at`/);
});

test("places and deletes tokens optimistically without freezing the map", async () => {
  const clientSource = await readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8");
  const placementFlow = clientSource.match(/const placeCreature = async[\s\S]+?const deleteToken = async/)?.[0] ?? "";
  const deletionFlow = clientSource.match(/const deleteToken = async[\s\S]+?const paletteCreature/)?.[0] ?? "";

  assert.match(clientSource, /pendingCreatesRef = useRef<Map<string, SharedToken>>/);
  assert.match(clientSource, /pendingDeletesRef = useRef<Set<string>>/);
  assert.match(placementFlow, /tokens: \[\.\.\.current\.tokens, optimisticToken\]/);
  assert.match(placementFlow, /pendingCreatesRef\.current\.delete\(temporaryId\)/);
  assert.doesNotMatch(placementFlow, /setBusy\(/);
  assert.match(deletionFlow, /tokens: current\.tokens\.filter\(\(currentToken\) => currentToken\.id !== token\.id\)/);
  assert.match(deletionFlow, /pendingDeletesRef\.current\.delete\(token\.id\)/);
  assert.doesNotMatch(deletionFlow, /setBusy\(/);
  assert.doesNotMatch(clientSource, /runCommand\("delete-token"/);
});

test("lets the DM select and drag any token directly from the map", async () => {
  const clientSource = await readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8");

  assert.match(clientSource, /const hitToken = \[\.\.\.state\.tokens\]\.reverse\(\)\.find/);
  assert.match(clientSource, /const controllable = token\.controlledByViewer/);
  assert.match(clientSource, /setSelectedTokenId\(hitToken\.id\)/);
  assert.match(clientSource, /pointerId: event\.pointerId, tokenId: hitToken\.id/);
  assert.match(clientSource, /participant\.role === "dm" \? "Drag any token to move it/);
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
  assert.doesNotMatch(clientSource, /<small>Position<\/small>/);
  assert.doesNotMatch(clientSource, /Claim token|Reconnect this token|Release token|unclaimed/);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(clientSource, /tokenEditorTokenId === token\.id \? <div className="token-config">/);
  assert.match(clientSource, /Edit details/);
  assert.match(styles, /\.initiative-editor input \{ width: 3\.1rem/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) 18\.5rem/);
});

test("assigns every token to a fixed identity without claim state", async () => {
  const [clientSource, workerSource, controllerSource] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../shared/token-control.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(controllerSource, /"token-bronze-warden": "Dan"/);
  assert.match(controllerSource, /"token-ash-mystic": "Barry"/);
  assert.match(controllerSource, /"token-ember-scout": "Scott"/);
  assert.match(controllerSource, /resolveTokenControllerName\(summoner, tokenById, visited\)/);
  assert.match(workerSource, /controller: \{ name: controllerName\(token\) \}/);
  assert.match(workerSource, /controlledByViewer/);
  assert.match(workerSource, /\(join\|state\|events\|heartbeat\|move\|command\)/);
  assert.doesNotMatch(workerSource, /action === "claim"|action === "relinquish"|token_claimed|token_relinquished|expireStaleClaims/);
  assert.doesNotMatch(clientSource, /claimToken|relinquishToken|previousClaimedTokenRef/);
});

test("normalizes Safari form controls and fills the desktop map stage", async () => {
  const [clientSource, styles] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(styles, /-webkit-appearance: none/);
  assert.match(clientSource, /Join as Dan \(Dar'eleth\)/);
  assert.match(clientSource, /Join as Barry \(Jelton\)/);
  assert.match(clientSource, /Join as Scott \(Malichar\)/);
  assert.match(clientSource, /Join as Kevin \(DM\)/);
  assert.doesNotMatch(clientSource, /name="encounter-alias"|Display name|Encounter code/);
  assert.match(styles, /@media \(min-width: 851px\)/);
  assert.match(styles, /\.app-shell \{ height: 100vh; height: 100dvh/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /grid-template-rows: auto minmax\(0, 1fr\) auto/);
  assert.match(styles, /justify-content: stretch/);
  assert.match(styles, /\.map-stage \{ min-height: 0; display: grid; place-items: stretch; overflow: hidden; \}/);
  assert.match(styles, /\.map-frame \{ width: 100%; height: 100%; max-width: none; \}/);
  assert.match(styles, /\.map-canvas \{[\s\S]+height: 100%;[\s\S]+aspect-ratio: auto;/);
  assert.match(clientSource, /className="map-stage"/);
  assert.match(clientSource, /className="map-frame" style=\{\{ aspectRatio:/);
  assert.doesNotMatch(clientSource, /--map-aspect/);
  assert.doesNotMatch(clientSource, /mapFit|mapStageRef/);
  assert.doesNotMatch(clientSource, /className=\{`map-canvas[^\n]+style=\{\{ aspectRatio:/);
});

test("zooms at the cursor and pans by dragging empty map space", async () => {
  const [clientSource, styles] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /function zoomViewportAt\(/);
  assert.match(clientSource, /Math\.exp\(-event\.deltaY \* 0\.0015\)/);
  assert.match(clientSource, /Math\.max\(width \/ state\.grid\.width, height \/ state\.grid\.height\)/);
  assert.match(clientSource, /const fitZoom = Math\.min\(width \/ state\.grid\.width, height \/ state\.grid\.height\) \/ baseCellSize/);
  assert.match(clientSource, /const zoom = fit \? fitZoom : Math\.max\(1, Math\.min\(3, requestedZoom\)\)/);
  assert.match(clientSource, /aria-label="Fit whole map"/);
  assert.match(clientSource, /onClick=\{fitViewport\}>⛶<\/button>/);
  assert.match(clientSource, /viewport\.fit \? "Fit"/);
  assert.match(clientSource, /offsetX: Math\.max\(0, \(width - state\.grid\.width \* cellSize\) \/ 2\)/);
  assert.match(clientSource, /const cellWidth = geometry\.cellSize/);
  assert.match(clientSource, /const sourceWidth = geometry\.visibleWidth \/ state\.grid\.width \* mapScene\.width/);
  assert.match(clientSource, /geometry\.visibleWidth \* geometry\.cellSize/);
  assert.match(clientSource, /onWheel=\{onCanvasWheel\}/);
  assert.match(clientSource, /viewport: \{ zoom: geometry\.fit \? 1 : geometry\.zoom, centerX: geometry\.centerX, centerY: geometry\.centerY, mapKey: geometry\.mapKey, fit: geometry\.fit \}/);
  assert.match(clientSource, /centerX: pan\.viewport\.centerX - \(event\.clientX - pan\.clientX\) \/ geometry\.cellSize/);
  assert.match(styles, /\.map-canvas\.is-dragging, \.map-canvas\.is-panning \{ cursor: grabbing; \}/);
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

test("offers durable undo and redo from the toolbar and standard shortcuts", async () => {
  const [clientSource, workerSource, styles] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /aria-label="Undo last action" data-tooltip="Undo · Ctrl\/⌘ Z"/);
  assert.match(clientSource, /aria-label="Redo last action" data-tooltip="Redo · Ctrl\/⌘ Shift Z"/);
  assert.match(clientSource, /const wantsUndo = modifier && key === "z" && !event\.shiftKey/);
  assert.match(clientSource, /event\.ctrlKey && !event\.metaKey && key === "y"/);
  assert.match(clientSource, /target\?\.closest\("input, textarea, select"\)/);
  assert.doesNotMatch(clientSource, /className="undo-button"/);
  assert.doesNotMatch(styles, /\.undo-button/);
  assert.match(workerSource, /redoAvailable: availableHistory\.redo\.length/);
  assert.match(workerSource, /if \(command === "redo"\)/);
  assert.match(workerSource, /"action_redone"/);
  assert.match(workerSource, /That action can no longer be redone because its shared state changed/);
});

test("includes a durable full-scene workshop with no retired editor path", async () => {
  const [battleMapSource, workshopSource, packageSource, workerSource, mapMigration] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/map-workshop.tsx", import.meta.url), "utf8"),
    readFile(new URL("../shared/map-package.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0006_panoramic_scalphunter.sql", import.meta.url), "utf8"),
  ]);

  assert.match(battleMapSource, /aria-label="Open Map Workshop" data-tooltip="Map Workshop"/);
  assert.doesNotMatch(battleMapSource, />Open creature palette<\/button>/);
  assert.doesNotMatch(battleMapSource, />Open Map Workshop<\/button>/);
  assert.match(battleMapSource, /participant\.role === "dm" && workshopOpen/);
  assert.match(packageSource, /export type FullSceneVisual/);
  assert.match(packageSource, /kind: "generated-scene"/);
  assert.match(packageSource, /export function parseMapPackage/);
  assert.match(workshopSource, /Rotate 90°/);
  assert.match(workshopSource, /Private until applied/);
  assert.match(workshopSource, /onKitDragStart/);
  assert.match(workshopSource, /onDrop=\{onMapDrop\}/);
  assert.match(workshopSource, /Artwork for this scene/);
  assert.match(workshopSource, /\{scene\.width \?\? 24\} × \{scene\.height \?\? 16\}/);
  assert.match(workshopSource, /save-map-preset/);
  assert.match(workshopSource, /apply-map-package/);
  assert.match(workshopSource, /setWallPreview/);
  assert.match(workerSource, /CREATE TABLE IF NOT EXISTS map_presets/);
  assert.match(workerSource, /map_package_applied/);
  assert.match(workerSource, /map_scene_migrated/);
  assert.match(mapMigration, /CREATE TABLE `map_presets`/);
  assert.match(mapMigration, /ADD `grid_width` integer DEFAULT 16 NOT NULL/);
  for (const source of [battleMapSource, workshopSource, packageSource, workerSource]) {
    assert.doesNotMatch(source, /map-stamps|assets\/terrain|STAMP_LIBRARY|TERRAIN_ASSETS|Legacy procedural|stamp palette/i);
  }
});
