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
    "terrain-dungeon-flagstone-01.png",
    "terrain-meadow-grass-01.png",
    "terrain-packed-earth-01.png",
    "terrain-shallow-water-01.png",
  ];

  for (const file of terrainFiles) {
    const png = await readFile(
      new URL(`../public/assets/terrain/${file}`, import.meta.url),
    );
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${file} must be a PNG`,
    );
    assert.equal(png.readUInt32BE(16), 1024, `${file} width`);
    assert.equal(png.readUInt32BE(20), 1024, `${file} height`);
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
  assert.match(workerSource, /clampTokenCoordinate\(requestedX, GRID_WIDTH, token\.size\)/);
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

test("keeps movement rejections visible on the map", async () => {
  const [clientSource, workerSource] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /className="map-message is-error" role="alert"/);
  assert.match(workerSource, /token\.initiative_order !== null &&/);
});

test("freezes the token destination as soon as the pointer is released", async () => {
  const clientSource = await readFile(
    new URL("../app/battle-map-prototype.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    clientSource,
    /gesture\.pointerId !== event\.pointerId \|\|\s+gesture\.released \|\|\s+gesture\.canceled \|\|\s+gesture\.finishing/,
  );
  assert.match(
    clientSource,
    /gesture\.latest = dragPoint\(event\.currentTarget, gesture, event\.clientX, event\.clientY\); gesture\.path\.push\(gesture\.latest\); gesture\.released = true;/,
  );
});
