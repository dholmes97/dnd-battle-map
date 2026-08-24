import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the trusted human-identity login without campaign or character credentials", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>D&amp;D Battle Map<\/title>/i);
  assert.match(html, /Choose your seat/);
  assert.match(html, />Dan</);
  assert.match(html, />Barry</);
  assert.match(html, />Scott</);
  assert.match(html, />Kevin</);
  assert.match(html, /Continue as this person/);
  assert.doesNotMatch(html, /Dar&#x27;eleth|Jelton|Malichar|Dungeon Master/);
  assert.doesNotMatch(html, /Choose a scenario|Display name|Encounter code|<select/i);
  assert.doesNotMatch(html, /codex-preview|Building your site/i);
});

test("keeps one typed transport contract and cohesive adapter boundaries", async () => {
  const [contracts, parser, worker, architecture] = await Promise.all([source("shared/contracts.ts"), source("shared/command-parser.ts"), source("worker/index.ts"), source("docs/ARCHITECTURE.md")]);
  assert.match(contracts, /export type EncounterState/);
  assert.match(contracts, /export type CommandName/);
  assert.match(contracts, /export type CommandPayloadMap/);
  assert.match(parser, /parseCommandRequest/);
  assert.match(parser, /satisfies readonly CommandName\[\]/);
  assert.match(worker, /switch \(request\.command\)/);
  assert.doesNotMatch(worker, /else if \(command ===/);
  assert.match(architecture, /lightweight ports-and-adapters/);
  for (const directory of ["worker/commands/", "worker/adapters/"]) {
    const entries = await readdir(new URL(directory, root));
    assert.ok(entries.filter((entry) => entry.endsWith(".ts")).length >= 6, `${directory} should keep cohesive typed boundaries`);
  }
});

test("ships the split browser adapter instead of one monolithic feature component", async () => {
  const client = await source("app/battle-map-prototype.tsx");
  assert.ok(client.split("\n").length < 1_250);
  for (const path of [
    "app/battle-map-renderer.ts", "app/use-encounter-sync.ts", "app/use-map-assets.ts",
    "app/use-chat-handouts.ts", "app/chat-handouts-ui.tsx", "app/use-token-controls.ts",
    "app/use-creature-catalog.ts", "app/battle-map-palettes.tsx", "app/encounter-sidebar.tsx",
    "app/encounter-summary.ts", "app/encounter-setup-details.tsx", "app/use-encounter-actions.ts", "app/use-personal-ui-settings.ts",
    "app/use-battle-map-gestures.ts",
    "app/campaign-home.tsx",
    "app/campaign-list.tsx",
  ]) await access(new URL(path, root));
  assert.match(client, /<BattleMapCommandBar/);
  assert.match(client, /<EncounterSidebar/);
  assert.match(client, /<EncounterDialogs/);
  assert.match(client, /useBattleMapGestures/);
  assert.doesNotMatch(client, /const onCanvasPointerDown/);
});

test("opens Encounter Setup from campaign home instead of the live map", async () => {
  const [client, assets, commandBar, workshop] = await Promise.all([
    source("app/battle-map-prototype.tsx"),
    source("app/use-map-assets.ts"),
    source("app/battle-map-command-bar.tsx"),
    source("app/map-workshop.tsx"),
  ]);
  assert.match(client, /onSetupEncounter=.*join\(signedInIdentity, selectedCampaign, code, "setup"\)/);
  assert.match(client, /<EncounterSetupDetails/);
  assert.doesNotMatch(commandBar, /Open Map Workshop|onOpenWorkshop/);
  assert.doesNotMatch(commandBar, /Manage current encounter|Encounter details/);
  assert.match(workshop, /Encounter Setup · Draft/);
  assert.match(workshop, /Return to encounters/);
  assert.match(client, /active: !workshopOpen/);
  assert.match(assets, /if \(!active\) return;\s*redraw\(\)/);
});

test("encapsulates synchronization storage behind an operations interface", async () => {
  const [sync, history, client] = await Promise.all([
    source("app/use-encounter-sync.ts"),
    source("app/use-history-shortcuts.ts"),
    source("app/battle-map-prototype.tsx"),
  ]);
  assert.match(sync, /export type EncounterSync/);
  assert.match(sync, /startSession/);
  assert.match(sync, /runHistory/);
  assert.doesNotMatch(`${history}\n${client}`, /pendingMovesRef|pendingOptimisticRef|localUndoHistoryRef|optimisticSequenceRef/);
});

test("keeps numbered migrations as the only schema mutation path", async () => {
  const [worker, migrationDoc, migrations] = await Promise.all([source("worker/index.ts"), source("docs/DATABASE-MIGRATIONS.md"), readdir(new URL("drizzle/", root))]);
  assert.ok(migrations.filter((entry) => /^\d{4}.*\.sql$/.test(entry)).length >= 18);
  assert.doesNotMatch(worker, /CREATE TABLE IF NOT EXISTS|ALTER TABLE/);
  assert.match(migrationDoc, /numbered migrations/i);
});

test("packages production backup and storage-preserving release tooling", async () => {
  const [packageJson, backup, backupDoc, worker] = await Promise.all([source("package.json"), source("scripts/backup-production.mjs"), source("docs/PRODUCTION-BACKUPS.md"), source("worker/index.ts")]);
  assert.match(packageJson, /"backup:production"/);
  assert.match(packageJson, /"backup:verify"/);
  assert.match(backup, /D1 table .* changed during backup/);
  assert.match(backup, /R2 object .* changed during backup/);
  assert.match(backupDoc, /sibling/i);
  assert.match(worker, /production-backup/);
  assert.doesNotMatch(backup, /CATALOG_IMPORT_TOKEN/);
});

test("does not restore retired fragmented map authoring", async () => {
  const [workshop, migration, architecture] = await Promise.all([source("app/map-workshop.tsx"), source("drizzle/0028_volatile_bruce_banner.sql"), source("docs/ARCHITECTURE.md")]);
  assert.match(workshop, /Base map/);
  assert.match(workshop, /mapImages/);
  assert.match(migration, /CREATE TABLE `map_images`/);
  assert.doesNotMatch(workshop, /generic terrain|scene-kit-panel/i);
  assert.match(architecture, /full-scene/i);
});

test("packages required token, spell, map, and handout assets", async () => {
  for (const path of [
    "public/assets/tokens/characters/dareleth-paladin-01.png", "public/assets/tokens/characters/jelton-druid-01.png", "public/assets/tokens/characters/malichar-rogue-01.png",
    "public/assets/spells/moonbeam-vfx-source.png", "public/assets/spells/flaming-sphere-vfx-source.png", "public/assets/spells/magic-circle-vfx.png",
    "public/assets/full-map-seeds/ravenloft-grand-dining-hall-01.jpg",
  ]) await access(new URL(path, root));
});

test("keeps component behavior and mandatory typechecking in the default gate", async () => {
  const packageJson = JSON.parse(await source("package.json"));
  assert.match(packageJson.scripts.test, /typecheck/);
  assert.match(packageJson.scripts.test, /test:components/);
  const components = await readdir(new URL("tests/components/", root));
  assert.ok(components.filter((entry) => entry.endsWith(".test.tsx")).length >= 2);
});
