import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("extension download includes the patched Chrome build, corresponding source and licenses only", () => {
  const archive = fileURLToPath(new URL("../public/downloads/beyond20-flc-2.20.1-r2.zip", import.meta.url));
  const prefix = "beyond20-flc-2.20.1-r2/";
  execFileSync("unzip", ["-tq", archive]);
  const paths = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
  assert.ok(paths.every((path) => path.startsWith(prefix) && !path.split("/").includes("..")));
  assert.ok(paths.every((path) => !/(^|\/)(node_modules|\.git|\.env|\.DS_Store|Cookies|Local Storage|Preferences)(\/|$)/.test(path)));
  const read = (path) => execFileSync("unzip", ["-p", archive, prefix + path], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const manifest = JSON.parse(read("chrome/manifest.json"));
  assert.match(manifest.name, /unofficial/);
  assert.equal(manifest.version_name, "2.20.1 FLC refresh fix r2");
  assert.deepEqual(manifest.permissions, ["activeTab", "tabs", "storage", "scripting"]);
  assert.deepEqual(manifest, JSON.parse(read("source/manifest.json")));
  for (const file of [manifest.background.service_worker, ...manifest.content_scripts.flatMap((script) => script.js)]) assert.ok(paths.includes(prefix + "chrome/" + file), file);
  assert.match(read("chrome/dist/background.js"), /beyond20-custom-site-ping/);
  assert.match(read("source/src/extension/background.js"), /beyond20-custom-site-ping/);
  for (const folder of ["chrome", "source"]) {
    assert.match(read(`${folder}/LICENSE`), /GNU GENERAL PUBLIC LICENSE/);
    assert.match(read(`${folder}/LICENSE.MIT`), /MIT/);
  }
  assert.ok(paths.includes(prefix + "source/package-lock.json"));
  assert.ok(paths.includes(prefix + "source/gulpfile.js"));
  assert.equal(read("source/.node-version").trim(), "22.23.4");
  const sourcePackage = JSON.parse(read("source/package.json"));
  assert.equal(sourcePackage.devDependencies.gulp, "5.0.1");
  assert.equal(sourcePackage.devDependencies["web-ext"], "10.8.0");
  assert.equal(sourcePackage.devDependencies["cross-var"], undefined);
  const lock = JSON.parse(read("source/package-lock.json"));
  assert.deepEqual(lock.packages[""].devDependencies, sourcePackage.devDependencies);
  for (const name of ["babel-traverse", "form-data", "request"]) {
    assert.ok(!Object.keys(lock.packages).some((path) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`)), name);
  }
  assert.equal(lock.packages["node_modules/shell-quote"].version, "1.11.0");
  for (const file of ["scripts/package.cjs", "scripts/web-ext.cjs", "tests/build-tooling.test.cjs", "refresh-regression.test.cjs"]) {
    assert.ok(paths.includes(prefix + "source/" + file), file);
  }
  const provenance = JSON.parse(read("BUILD-PROVENANCE.json"));
  assert.equal(provenance.reviewedCommit, "2c4a57baa2f03a080fd7bcc09c9b0c7bdab921e3");
  assert.equal(provenance.nodeVersion, "22.23.4");
  assert.match(read("reviewed-changes.patch"), /web-ext/);
  assert.match(read("DOWNLOAD-INSTRUCTIONS.md"), /Load unpacked/);
  assert.match(read("DOWNLOAD-INSTRUCTIONS.md"), /node-forge/);
  assert.match(read("refresh-fix.patch"), /beyond20-custom-site-ping/);
});
