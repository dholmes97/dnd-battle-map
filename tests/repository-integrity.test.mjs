import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const tokensRoot = new URL("../public/assets/tokens/", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

async function pngFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return pngFiles(new URL(`${entry.name}/`, directory), `${path}/`);
    return entry.isFile() && entry.name.endsWith(".png") ? [path] : [];
  }));
  return nested.flat();
}

test("the token manifest is a complete one-to-one inventory of shipped token PNGs", async () => {
  const manifest = JSON.parse(await source("public/assets/tokens/manifest.json"));
  const ids = manifest.assets.map(({ id }) => id);
  const declared = manifest.assets.map(({ path }) => path.replace(/^\/assets\/tokens\//, "")).sort();
  const shipped = (await pngFiles(tokensRoot)).sort();

  assert.equal(new Set(ids).size, ids.length, "token IDs must be unique");
  assert.equal(new Set(declared).size, declared.length, "token paths must be unique");
  assert.deepEqual(declared, shipped);
  assert.equal(manifest.rendering.width, 1254);
  assert.equal(manifest.rendering.height, 1254);
});

test("user-facing metadata and token documentation do not retain prototype-era claims", async () => {
  const [layout, page, tokenReadme] = await Promise.all([
    source("app/layout.tsx"),
    source("app/page.tsx"),
    source("public/assets/tokens/README.md"),
  ]);
  assert.doesNotMatch(`${layout}\n${page}`, /focused proof|battle-map prototype/i);
  assert.doesNotMatch(tokenReadme, /contains six/i);
  assert.match(tokenReadme, /declared by `manifest\.json`/);
});

test("the release workflow is read-only, immutable, and covers every local gate", async () => {
  const [workflow, packageText] = await Promise.all([
    source(".github/workflows/ci.yml"),
    source("package.json"),
  ]);
  const packageJson = JSON.parse(packageText);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /pull_request_target|permissions:\s*write-all/);
  assert.match(workflow, /playwright install --with-deps chromium webkit/);
  assert.equal(
    packageJson.scripts["test:browser:server"],
    "node scripts/start-browser-test-server.mjs",
  );
  for (const reference of workflow.matchAll(/uses:\s*([^\s#]+)/g)) {
    assert.match(reference[1], /@[a-f0-9]{40}$/i, `${reference[1]} must be pinned to a commit`);
  }
  for (const script of [
    "typecheck",
    "lint",
    "test:coverage:components",
    "build",
    "test:coverage:node",
    "test:browser",
    "audit:dependencies",
  ]) {
    assert.ok(packageJson.scripts[script], `${script} must remain locally executable`);
    assert.match(workflow, new RegExp(`npm run ${script.replaceAll(":", "\\:")}`));
  }
});
