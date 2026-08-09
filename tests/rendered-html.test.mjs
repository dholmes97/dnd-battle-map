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
  const [response, clientSource] = await Promise.all([
    render(),
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
  ]);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Ember Keep Encounter \| D&amp;D Battle Map<\/title>/i);
  assert.match(html, /Choose a scenario/);
  assert.match(html, /<select[^>]*><option value="EMBER-KEEP" selected="">The Ember Keep<\/option><\/select>/);
  assert.match(html, /Join as Dan \(Dar&#x27;eleth\)/);
  assert.match(html, /Join as Barry \(Jelton\)/);
  assert.match(html, /Join as Scott \(Malichar\)/);
  assert.match(html, /Join as Kevin \(DM\)/);
  assert.doesNotMatch(html, /Display name|Encounter code/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Building your site/i);
  assert.match(clientSource, /const JOIN_TIMEOUT_MS = 12_000;/);
  assert.match(clientSource, /The encounter took too long to respond\. Please try again\./);
  assert.match(clientSource, /api<\{ items: EncounterSummary\[\] \}>\("\/api\/encounters"\)/);
});

test("gives the DM a durable scenario creation workflow", async () => {
  const [clientSource, workerSource, styles] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /aria-label="Create scenario" data-tooltip="Create scenario"/);
  assert.match(clientSource, /Fresh scenario — current party only/);
  assert.match(clientSource, /Duplicate current map and tokens/);
  assert.match(clientSource, /command: "create-scenario", name, mode: scenarioMode/);
  assert.match(clientSource, /setParticipant\(joined\);\s+setState\(result\.state\);\s+setEncounterCode\(result\.scenario\.code\)/);
  assert.match(clientSource, /next\.encounter\.code !== current\.encounter\.code/);
  assert.match(workerSource, /if \(command === "create-scenario"\)/);
  assert.match(workerSource, /const denied = requireDm\(\)/);
  assert.match(workerSource, /async function uniqueScenarioCode/);
  assert.match(workerSource, /baseTokenControllerName\(token\) !== "Kevin"/);
  assert.match(workerSource, /duplicateMap \? encounter\.map_package_json : null/);
  assert.match(workerSource, /role: "dm",\s+scenario: \{ code, name, status: "setup", updatedAt: now \}/);
  assert.match(styles, /\.scenario-dialog label/);
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
  assert.match(clientSource, /controller: summoner\?\.controller \?\? \{ name: participant\.name \}/);
  assert.match(clientSource, /Anything you place is summoned by/);
  assert.match(clientSource, /const effectivePlacementSummonerId = participant\?\.role === "player"/);
  assert.match(workerSource, /const kind = participant\.role === "player" \? "summon" : requestedKind/);
  assert.match(workerSource, /Player-created creatures must be summons of your character/);
  assert.match(workerSource, /!await canControlToken\(env, encounter\.id, summoner, participant\)/);
  assert.match(clientSource, /api<CreatureCatalogPage>\(`\/api\/creatures/);
  assert.match(clientSource, /loading="lazy" unoptimized/);
  assert.doesNotMatch(clientSource, /CREATURE_CATALOG_SEED|CREATURE_LIBRARY/);
  assert.match(workerSource, /creature-catalog\/original/);
  assert.match(workerSource, /creature-catalog\/thumbnails/);
  assert.match(workerSource, /WHERE kind = 'monster' AND hp IS NULL AND max_hp IS NULL/);
  assert.match(workerSource, /WHERE token_asset = tokens\.art_asset AND is_active = 1/);
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

test("ships persistent animated Moonbeam, Flaming Sphere, and Magic Circle spell entities", async () => {
  const [clientSource, workerSource, spellSource, moonbeam, flamingSphere, magicCircle] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../shared/spell-effects.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/assets/spells/moonbeam-vfx-source.png", import.meta.url)),
    readFile(new URL("../public/assets/spells/flaming-sphere-vfx-source.png", import.meta.url)),
    readFile(new URL("../public/assets/spells/magic-circle-vfx.png", import.meta.url)),
  ]);

  assert.match(spellSource, /id: "moonbeam"[\s\S]+size: "large"/);
  assert.match(spellSource, /id: "flaming-sphere"[\s\S]+size: "medium"/);
  assert.match(spellSource, /id: "magic-circle"[\s\S]+areaLabel: "10-ft radius"[\s\S]+size: "gargantuan"/);
  assert.match(clientSource, /function drawSpellEffect\(/);
  assert.match(clientSource, /globalCompositeOperation = "screen"/);
  assert.match(clientSource, /requestAnimationFrame\(animate\)/);
  assert.match(clientSource, /1000 \/ 24/);
  assert.match(clientSource, /aria-label="Spell effects"/);
  assert.match(clientSource, /Drag an effect onto the battlefield/);
  assert.match(clientSource, /void placeSpellEffect\(spell, point\)/);
  assert.doesNotMatch(clientSource, /const inspectable = .*controlledByViewer/);
  assert.match(clientSource, /if \(spell\?\.id === "magic-circle"\)/);
  assert.match(clientSource, /const outerRadius = radius \* 1\.25/);
  assert.match(clientSource, /distance >= outerRadius \* 0\.72 && distance <= outerRadius \* 1\.08/);
  assert.match(clientSource, /if \(\(selected \|\| owned\) && !isMagicCircle\)/);
  assert.match(clientSource, /hitTokens\.find\(\(token\) => token\.kind !== SPELL_EFFECT_KIND\) \?\? hitTokens\[0\]/);
  assert.match(clientSource, /if \(!canMoveToken\(hitToken\)\) return;/);
  assert.match(clientSource, /Owner only · \$\{selectedToken\.controller\.name\}/);
  assert.match(clientSource, /function drawBlessEffect\(/);
  assert.match(clientSource, /if \(!tokenHasEffect\(token, "Bless"\)\) return;/);
  assert.match(clientSource, /const angle = time \* 0\.38 \+ seed \* Math\.PI \* 2/);
  assert.match(clientSource, /const flareCycle = \(time \+ seed \* 5\.4\) % 5\.4/);
  assert.match(clientSource, /flareCycle < 0\.48 \? Math\.sin\(Math\.PI \* flareCycle \/ 0\.48\) \*\* 2 : 0/);
  assert.match(clientSource, /context\.globalAlpha = 0\.66 \+ Math\.sin/);
  assert.doesNotMatch(clientSource, /for \(let index = 0; index < 3; index \+= 1\)/);
  assert.match(clientSource, /function drawHasteEffect\(/);
  assert.match(clientSource, /if \(!tokenHasEffect\(token, "Haste"\)\) return;/);
  assert.match(clientSource, /const intervals = \[0, 1, 2, 3\]\.map\(\(index\) => 2 \+ spellParticleSeed/);
  assert.match(clientSource, /const clockPosition = Math\.floor\(spellParticleSeed\(token\.id, 200 \+ pulseKey\) \* 12\)/);
  assert.match(clientSource, /const pulseDuration = 0\.78/);
  assert.doesNotMatch(clientSource, /for \(let segment = 0; segment < 7; segment \+= 1\)/);
  assert.match(clientSource, /const hasAttachedVfx = state\?\.tokens\.some/);
  assert.match(clientSource, /hasPersistentSpell \|\| hasAttachedVfx/);
  assert.match(clientSource, /drawHasteEffect\(context, token, x, y, radius, animationNow\)/);
  assert.match(workerSource, /command === "create-spell-effect"/);
  assert.match(workerSource, /Player spell effects must belong to your character/);
  assert.match(workerSource, /token\.kind !== SPELL_EFFECT_KIND \|\| !\(await canControlToken/);
  for (const [name, asset] of [["moonbeam", moonbeam], ["flaming sphere", flamingSphere]]) {
    assert.deepEqual([...asset.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${name} PNG signature`);
    assert.equal(asset.readUInt32BE(16), 768, `${name} width`);
    assert.equal(asset.readUInt32BE(20), 768, `${name} height`);
    assert.ok(asset.byteLength > 500_000, `${name} should retain detailed source art`);
  }
  assert.deepEqual([...magicCircle.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "magic circle PNG signature");
  assert.equal(magicCircle.readUInt32BE(16), 1254, "magic circle width");
  assert.equal(magicCircle.readUInt32BE(20), 1254, "magic circle height");
  assert.ok(magicCircle.byteLength > 500_000, "magic circle should retain detailed source art");
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
  assert.match(clientSource, /pendingMovesRef\.current\.set\(tokenId, \{ \.\.\.destination, sequence, movementUsed, movementOrigin \}\)/);
  assert.match(clientSource, /tokens: current\.tokens\.map\(\(token\) => token\.id === tokenId \? \{ \.\.\.token, \.\.\.destination, movementUsed, movementOrigin \} : token\)/);
  assert.match(clientSource, /if \(pendingMovesRef\.current\.get\(tokenId\)\?\.sequence === sequence\) pendingMovesRef\.current\.delete\(tokenId\)/);
  assert.doesNotMatch(clientSource, /const publishMove[\s\S]{0,220}setBusy\(true\)/);
  assert.doesNotMatch(clientSource, /Movement reserved|Being moved by|\/lock|\/unlock|lockState/);
  assert.doesNotMatch(workerSource, /\(join\|state\|events\|heartbeat\|claim\|relinquish\|lock\|move\|unlock\|command\)/);
  assert.doesNotMatch(workerSource, /action === "lock"|lock_owner_id|lock_expires_at/);
  assert.match(workerSource, /SET x = \?, y = \?, movement_used = \?, movement_origin_x = \?, movement_origin_y = \?, updated_at = \?/);
  assert.match(workerSource, /const movementOrigin = isSpellEffect \? null : encounter\.status === "active" \? previousMovementOrigin \?\? previous : previousMovementOrigin/);
  assert.match(workerSource, /const distance = isSpellEffect \? 0 : directDistance\(movementOrigin \?\? previous, \{ x, y \}\)/);
  assert.doesNotMatch(workerSource, /token\.movement_used \+ distance/);
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
  assert.match(placementFlow, /summonerTokenId: effectivePlacementSummonerId \|\| undefined/);
  assert.match(placementFlow, /pendingCreatesRef\.current\.delete\(temporaryId\)/);
  assert.doesNotMatch(placementFlow, /setBusy\(/);
  assert.match(deletionFlow, /tokens: current\.tokens\.filter\(\(currentToken\) => currentToken\.id !== token\.id\)/);
  assert.match(deletionFlow, /pendingDeletesRef\.current\.delete\(token\.id\)/);
  assert.doesNotMatch(deletionFlow, /setBusy\(/);
  assert.doesNotMatch(clientSource, /runCommand\("delete-token"/);
});

test("makes map tools and encounter controls optimistic without a global wait", async () => {
  const clientSource = await readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8");
  const optimisticFlow = clientSource.match(/const runOptimisticCommand = async[\s\S]+?const runHistoryOptimistically/)?.[0] ?? "";

  assert.match(clientSource, /pendingOptimisticRef = useRef<Map<number, OptimisticMutation>>/);
  assert.match(clientSource, /turnAdvanceQueueRef = useRef<Promise<void>>\(Promise\.resolve\(\)\)/);
  assert.match(clientSource, /for \(const mutation of pendingOptimistic\.values\(\)\) merged = mutation\.apply\(merged\)/);
  assert.match(clientSource, /import \{ flushSync \} from "react-dom"/);
  assert.match(optimisticFlow, /flushSync\(\(\) => \{\s+setState\(\(current\) =>/);
  assert.match(optimisticFlow, /setState\(\(current\) =>/);
  assert.match(optimisticFlow, /const send = \(\) => command<T>\(name, extra\)/);
  assert.ok(optimisticFlow.indexOf("setState((current) =>") < optimisticFlow.indexOf("const send = () => command<T>(name, extra)"));
  assert.ok(optimisticFlow.indexOf("flushSync(() =>") < optimisticFlow.indexOf("const send = () => command<T>(name, extra)"));
  assert.doesNotMatch(optimisticFlow, /setBusy\(/);
  assert.match(clientSource, /pending-annotation-/);
  assert.match(clientSource, /annotations: \[\.\.\.current\.annotations, annotation\]/);
  assert.match(clientSource, /annotations: current\.annotations\.filter/);
  assert.match(clientSource, /packIds\.has\(item\.id\)\s+\? \{ \.\.\.item, initiative, initiativeGroupId: optimisticGroupId/);
  assert.match(clientSource, /void applyHpToToken\(token, -hpStep\)/);
  assert.match(clientSource, /void applyHpToToken\(token, hpStep\)/);
  assert.match(clientSource, /removeEffectFromToken\(token\.id, effect\.id\)/);
  assert.match(clientSource, /startCombatOptimistically/);
  assert.match(clientSource, /advanceTurnOptimistically/);
  assert.match(optimisticFlow, /const queued = turnAdvanceQueueRef\.current\.then\(send\)/);
  assert.match(optimisticFlow, /turnAdvanceQueueRef\.current = queued\.then\(\(\) => undefined, \(\) => undefined\)/);
  assert.match(clientSource, /configureEncounterOptimistically/);
  assert.match(clientSource, /runHistoryOptimistically\("undo"\)/);
});

test("explains pause and confirms combat reset with responsive controls", async () => {
  const [clientSource, styles] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /data-tooltip="Temporarily freezes movement and turn advancement\. The current round and initiative are preserved\."/);
  assert.match(clientSource, /The DM paused the encounter\. Movement and turn advancement are temporarily disabled\./);
  assert.match(clientSource, /Movement is paused until shared state is current\./);
  assert.match(clientSource, />\{encounterAction === "reset" \? "Resetting…" : "Reset"\}<\/button>/);
  assert.match(clientSource, /role="dialog" aria-modal="true" aria-labelledby="reset-encounter-title"/);
  assert.match(clientSource, /Reset combat\?/);
  assert.match(clientSource, /if \(inCombat\) setRestartConfirmOpen\(true\); else startCombatOptimistically\(\)/);
  assert.match(clientSource, /role="dialog" aria-modal="true" aria-labelledby="restart-combat-title"/);
  assert.match(clientSource, /This returns combat to round 1 and rebuilds the turn order from the current initiative numbers/);
  assert.match(clientSource, /setRestartConfirmOpen\(false\); startCombatOptimistically\(\)/);
  assert.match(clientSource, /data-tooltip=\{inCombat \? "Start again at round 1 using the current initiative\./);
  assert.match(clientSource, /data-tooltip="Exit combat and return to setup\. Clears the round, active turn, and movement tracking/);
  assert.match(clientSource, /aria-describedby="restart-combat-help"/);
  assert.match(clientSource, /aria-describedby="reset-encounter-help"/);
  assert.match(clientSource, /clears the current round, active turn, and movement tracking/);
  assert.match(clientSource, /event\.key === "Escape"/);
  assert.match(styles, /\.secondary-button:active:not\(:disabled\)/);
  assert.match(styles, /\.panel-foot \[data-tooltip\]:hover::after/);
});

test("selects inspectable map entities and honors the scenario movement policy", async () => {
  const [clientSource, workerSource, schemaSource, movementMigration] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0012_hard_norrin_radd.sql", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /const hitTokens = \[\.\.\.state\.tokens\]\.reverse\(\)\.filter/);
  assert.match(clientSource, /participant\.role === "dm" \|\| token\.controlledByViewer \|\| !state\.encounter\.strictMovement/);
  assert.doesNotMatch(clientSource, /const inspectable = .*controlledByViewer/);
  assert.match(clientSource, /setSelectedTokenId\(hitToken\.id\)/);
  assert.match(clientSource, /if \(!canMoveToken\(hitToken\)\) return;/);
  assert.ok(
    clientSource.indexOf("setSelectedTokenId(hitToken.id)") < clientSource.indexOf("if (!canMoveToken(hitToken)) return;"),
    "Map selection must happen before movement permission is checked",
  );
  assert.match(clientSource, /pointerId: event\.pointerId, tokenId: hitToken\.id/);
  assert.match(clientSource, /participant\.role === "dm" \|\| !state\.encounter\.strictMovement \? "Drag any visible token to move it/);
  assert.match(clientSource, /data-tooltip="With strict movement on, players can move only their own character and related summons\./);
  assert.match(clientSource, /checked=\{state\.encounter\.strictMovement\}/);
  assert.match(clientSource, /setStrictMovementOptimistically\(event\.target\.checked\)/);
  assert.match(workerSource, /command === "set-strict-movement"/);
  assert.match(workerSource, /Boolean\(encounter\.strict_movement\) && !\(await canControlToken/);
  assert.match(schemaSource, /strictMovement: integer\("strict_movement", \{ mode: "boolean" \}\)\.notNull\(\)\.default\(true\)/);
  assert.match(movementMigration, /ALTER TABLE `encounters` ADD `strict_movement` integer DEFAULT true NOT NULL/);
  assert.doesNotMatch(clientSource, /strict-movement-toggle/);
});

test("groups personal grid and token presentation controls in UI Settings", async () => {
  const [clientSource, styles] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /const \[gridOpacity, setGridOpacity\] = useState\(0\.17\)/);
  assert.match(clientSource, /const \[transparentTokenBackgrounds, setTransparentTokenBackgrounds\] = useState\(false\)/);
  assert.match(clientSource, /aria-label="UI Settings"/);
  assert.match(clientSource, /<strong>Your display<\/strong><small>Only changes your view<\/small>/);
  assert.match(clientSource, /participant\.role === "dm" \? <div className="ui-settings-global">/);
  assert.match(clientSource, /<strong>Encounter settings<\/strong><small>Affects everyone<\/small>/);
  assert.match(clientSource, /aria-label="Grid visibility"/);
  assert.match(clientSource, /setGridOpacity\(Number\(event\.target\.value\) \/ 100\)/);
  assert.match(clientSource, /Only changes your view/);
  assert.match(clientSource, /aria-label="Transparent token centers"/);
  assert.match(clientSource, /setTransparentTokenBackgrounds\(event\.target\.checked\)/);
  assert.match(clientSource, /transparentTokenBackgrounds\s+\? "rgba\(16, 15, 13, 0\.12\)"/);
  assert.match(clientSource, /if \(!transparentTokenBackgrounds\) \{\s+context\.strokeStyle = owned/);
  assert.match(clientSource, /rgba\(232, 220, 190, \$\{Math\.min\(1, Math\.max\(0, gridOpacity\)\)\}\)/);
  assert.match(clientSource, /"--grid-level": `\$\{Math\.round\(gridOpacity \* 100\)\}%`/);
  assert.doesNotMatch(clientSource, /command\("set-grid-opacity"|runOptimisticCommand\("set-grid-opacity"/);
  assert.doesNotMatch(clientSource, /command\("set-transparent-token|runOptimisticCommand\("set-transparent-token/);
  assert.match(styles, /\.grid-opacity-control input/);
  assert.match(styles, /::-webkit-slider-runnable-track/);
  assert.match(styles, /::-webkit-slider-thumb/);
  assert.match(styles, /::-moz-range-progress/);
  assert.match(styles, /\.ui-settings-panel/);
  assert.match(styles, /\.ui-settings-global/);
  assert.match(styles, /\.ui-setting-toggle/);
  assert.equal((clientSource.match(/className="ui-setting-toggle"/g) ?? []).length, 2);
  assert.doesNotMatch(styles, /\.strict-movement-toggle/);
});

test("explains the compact live connection indicator on hover", async () => {
  const clientSource = await readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8");

  assert.match(clientSource, /Live connection — shared encounter updates are current\./);
  assert.match(clientSource, /data-tooltip=\{connectionTooltip\}/);
  assert.match(clientSource, /aria-label=\{connectionTooltip\}/);
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
  assert.match(workerSource, /const overBudget = !isSpellEffect && encounter\.status === "active" && distance > token\.speed \+ 0\.05/);
  assert.match(clientSource, /hitToken\.movementOrigin \?\? gesture\.origin/);
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
  assert.match(clientSource, /<small>Speed<\/small><strong>\{selectedToken\.speed\} ft<\/strong>/);
  // Unselected rows stay a single compact line: no per-row stat grid.
  assert.match(clientSource, /className="roster-row/);
  assert.doesNotMatch(clientSource, /className="token-card/);
  assert.match(clientSource, />\+ Effect<\/button>/);
  assert.doesNotMatch(clientSource, /<small>Position<\/small>/);
  assert.doesNotMatch(clientSource, /Claim token|Reconnect this token|Release token|unclaimed/);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(clientSource, /tokenEditorTokenId === token\.id \? <div className="token-config">/);
  assert.match(clientSource, /Edit details/);
  assert.match(styles, /\.initiative-editor input \{ width: 3\.1rem/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) 19\.5rem/);
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
  assert.match(styles, /grid-template-rows: minmax\(0, 1fr\)/);
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
  assert.match(clientSource, /onClick=\{fitViewport\}><Icon name="fit" \/><\/button>/);
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
  assert.match(clientSource, /aria-label=\{label\}\s+data-tooltip=\{`\$\{label\} — \$\{shortcut\}`\}/);
  assert.match(clientSource, /toolButton\("move", "move", "Move tokens", "V"\)/);
  assert.match(clientSource, /toolButton\("erase", "erase", "Erase line", "E"\)/);
  assert.match(clientSource, /toolButton\("ping", "ping", "Ping map", "P"\)/);
  assert.match(clientSource, /toolButton\("drawing", "line", "Draw line", "L"\)/);
  // Stroked SVG paths replaced the glyph characters that rendered unevenly.
  assert.match(clientSource, /const ICON_PATHS = \{/);
  assert.doesNotMatch(clientSource, /aria-hidden="true">✥|aria-hidden="true">◉|aria-hidden="true">⌫/);
  assert.doesNotMatch(clientSource, />Move<\/button>|>Ping<\/button>|>Draw line<\/button>|>Erase<\/button>/);
  assert.match(workerSource, /if \(command === "remove-annotation"\)/);
  assert.match(workerSource, /You can only erase lines you drew/);
  assert.match(workerSource, /"annotation_removed"/);
  assert.match(styles, /\.command-bar \.icon-tool/);
  assert.match(styles, /\.command-bar \[data-tooltip\]::after/);
  assert.match(styles, /\[data-tooltip\]:focus-visible::after/);
});

test("offers durable undo and redo from the toolbar and standard shortcuts", async () => {
  const [clientSource, workerSource, styles] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /aria-label="Undo last action" data-tooltip="Undo — Ctrl\/Cmd \+ Z"/);
  assert.match(clientSource, /aria-label="Redo last action" data-tooltip="Redo — Ctrl \+ Y or Cmd \+ Shift \+ Z"/);
  const historyFlow = clientSource.match(/const runHistoryOptimistically = async[\s\S]+?useEffect\(\(\) => \{/)?.[0] ?? "";
  assert.match(historyFlow, /setNotice\(historyNotice\)/);
  assert.ok(historyFlow.indexOf("setNotice(historyNotice)") < historyFlow.indexOf("await runOptimisticCommand("));
  assert.match(historyFlow, /if \(!confirmed\) setNotice\(""\)/);
  assert.match(clientSource, /const wantsUndo = modifier && key === "z" && !event\.shiftKey/);
  assert.match(clientSource, /event\.ctrlKey && !event\.metaKey && key === "y"/);
  assert.match(clientSource, /const runHistoryFromShortcut = useEffectEvent/);
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

test("spends the viewport on the map with one command bar and no static footer", async () => {
  const [clientSource, styles] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  // Encounter identity and connection state ride in the tool row itself.
  assert.match(clientSource, /className="command-bar"/);
  assert.match(clientSource, /className="encounter-identity"/);
  assert.doesNotMatch(clientSource, /className="topbar"|className="map-footer"/);
  assert.doesNotMatch(styles, /^\.topbar \{|^\.map-footer \{/m);
  assert.match(clientSource, /className="round-counter"/);
  assert.match(clientSource, /`Current round \$\{state\.encounter\.currentRound\}`/);
  assert.match(styles, /\.round-counter \{/);
  // Static trivia that never changed during play is gone for good.
  assert.doesNotMatch(clientSource, /squares<\/span>|Server version|equal-cost diagonals/i);
  // Panning by button was redundant with dragging empty map space.
  assert.doesNotMatch(clientSource, /aria-label="Pan left"|nudgeViewport/);
});

test("collapses the sidebar and presents the map full bleed", async () => {
  const [clientSource, styles] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /aria-label="Presentation mode"/);
  assert.match(clientSource, /requestFullscreen\?\.\(\)/);
  assert.match(clientSource, /hidden=\{!sidebarOpen \|\| presenting\}/);
  assert.match(styles, /\.app-shell\.is-collapsed \.workspace, \.app-shell\.is-presenting \.workspace \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  // Shortcuts must never fire while the DM is typing in a field.
  assert.match(clientSource, /if \(key === "\\\\"\) \{ event\.preventDefault\(\); setSidebarOpen/);
  assert.match(clientSource, /if \(key === "f"\) \{ event\.preventDefault\(\); togglePresenting\(\); return; \}/);
  assert.match(clientSource, /target\?\.closest\?\.\("input, textarea, select"\)/);
});

test("shows one roster that folds identical mobs and orders combat by initiative", async () => {
  const [clientSource, workerSource, styles] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(clientSource, /function buildRosterRows\(/);
  assert.match(clientSource, /const ROSTER_GROUP_THRESHOLD = 3;/);
  // In combat the roster is the turn order, nothing else.
  assert.match(clientSource, /\(a\.initiativeOrder \?\? 999\) - \(b\.initiativeOrder \?\? 999\) \|\| compareTokenNames\(a, b\)/);
  // Grouping keys off creature kind, not ownership: the DM controls everything.
  assert.match(clientSource, /token\.kind === "character" \? \(token\.controlledByViewer \? 0 : 1\)/);
  // The separate initiative list is gone; one list serves both jobs.
  assert.doesNotMatch(clientSource, /className="initiative-list"|className="initiative-entry/);
  // Encounter controls are always reachable instead of below the whole roster.
  assert.match(clientSource, /className="panel-foot"/);
  assert.match(clientSource, /pendingDeleteTokenId === token\.id/);
  assert.match(clientSource, />Confirm delete<\/button>/);
  assert.match(clientSource, /"set-initiative-group"/);
  assert.match(clientSource, /Initiative for all \$\{row\.label\} creatures/);
  assert.match(clientSource, /Changes apply to all \$\{packMembers\.length\} matching creatures/);
  assert.match(clientSource, />Split from group<\/button>/);
  assert.match(clientSource, /"Group turn ended\."/);
  assert.equal([...clientSource.matchAll(/className="end-turn-button" onClick=\{\(\) => endTurnOptimistically/g)].length, 1);
  assert.match(clientSource, /activeOwnTurnIsGroup \? "End Group Turn" : "End Turn"/);
  assert.match(clientSource, /const activeOwnTurnIsGroup = activeTurnMembers\.length > 1;/);
  assert.match(workerSource, /initiative_group_id/);
  assert.match(workerSource, /async function rebuildInitiativeOrders\(/);
  assert.match(styles, /\.roster-initiative \{ grid-column: 6; width: 100%;/);
  assert.match(workerSource, /WHERE encounter_id = \? AND initiative_order = \?/);
  // Render must not read the pending-create ref.
  assert.match(clientSource, /function isPendingCreate\(token: SharedToken\)/);
});

test("hides exact hit points from players and snaps their rings to bands", async () => {
  const [clientSource, workerSource, healthSource] = await Promise.all([
    readFile(new URL("../app/battle-map-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../shared/health.mjs", import.meta.url), "utf8"),
  ]);

  // The server is what actually withholds the numbers.
  assert.match(workerSource, /hp: canSeeExactHp \? token\.hp : null/);
  assert.match(workerSource, /maxHp: canSeeExactHp \? token\.max_hp : null/);
  assert.match(workerSource, /return healthBand\(hp, maxHp\)/);
  // One shared band table so the ring and the server cannot drift apart.
  assert.match(healthSource, /if \(ratio > 0\.5\) return "injured"/);
  assert.match(healthSource, /if \(ratio > 0\.25\) return "bloodied"/);
  assert.match(healthSource, /injured: 0\.75/);
  assert.match(healthSource, /bloodied: 0\.5/);
  // Token rings and roster bars both go through displayHealth.
  assert.match(clientSource, /const health = displayHealth\(token\.hp, token\.maxHp, token\.healthState\)/);
  assert.match(clientSource, /health\.ratio \* Math\.PI \* 2/);
  // A row prints digits only when the server sent them.
  assert.match(clientSource, /token\.hp !== null && token\.maxHp !== null \? `\$\{token\.hp\}\/\$\{token\.maxHp\}` : ""/);
});
