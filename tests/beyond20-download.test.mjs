import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("extension download includes the patched Chrome build, corresponding source and licenses only", () => {
  const archive = fileURLToPath(new URL("../public/downloads/beyond20-flc-2.20.1-r1.zip", import.meta.url));
  const prefix = "beyond20-flc-2.20.1-r1/";
  execFileSync("unzip", ["-tq", archive]);
  const paths = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
  assert.ok(paths.every((path) => path.startsWith(prefix) && !path.split("/").includes("..")));
  assert.ok(paths.every((path) => !/(^|\/)(node_modules|\.git|\.env|\.DS_Store|Cookies|Local Storage|Preferences)(\/|$)/.test(path)));
  const read = (path) => execFileSync("unzip", ["-p", archive, prefix + path], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const manifest = JSON.parse(read("chrome/manifest.json"));
  assert.match(manifest.name, /unofficial/);
  assert.equal(manifest.version_name, "2.20.1 FLC refresh fix r1");
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
  assert.match(read("DOWNLOAD-INSTRUCTIONS.md"), /Load unpacked/);
  assert.match(read("refresh-fix.patch"), /beyond20-custom-site-ping/);
});
