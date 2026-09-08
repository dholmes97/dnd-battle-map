import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const upstream = resolve(process.argv[2] ?? ".working/beyond20-refresh-fix");
const base = "3d737952cd1ba505cd73a9f0d4ef8e84c5f47a8b";
assert.equal(execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), base);
const stage = mkdtempSync(join(tmpdir(), "beyond20-download-"));
const bundle = join(stage, "beyond20-flc-2.20.1-r1");
const source = join(bundle, "source");
mkdirSync(source, { recursive: true });
// Only upstream tracked build inputs enter the archive; never copy a browser profile.
const archive = execFileSync("git", ["-C", upstream, "archive", base, "src", "libs", "images", "package.json", "gulpfile.js", "manifest.json", "manifest_ff.json", "options.html", "options.css", "popup.html", "default_popup.html", "README.md", "LICENSE", "LICENSE.MIT"], { maxBuffer: 32 * 1024 * 1024 });
execFileSync("tar", ["-xf", "-", "-C", source], { input: archive });
const lock = JSON.parse(readFileSync(join(upstream, "package-lock.json"), "utf8"));
for (const dependency of Object.values(lock.packages)) {
  if (!dependency.resolved) continue;
  const url = new URL(dependency.resolved);
  assert.equal(url.origin, "https://registry.npmjs.org");
  assert.equal(url.username + url.password + url.search, "");
}
cpSync(join(upstream, "package-lock.json"), join(source, "package-lock.json"));
execFileSync("git", ["apply", join(root, "integrations/beyond20/refresh-fix.patch")], { cwd: source });
const manifestPath = join(source, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.name = "Beyond20 — Friday Lunch Crew (unofficial)";
manifest.version_name = "2.20.1 FLC refresh fix r1";
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
execFileSync(process.execPath, [join(root, "integrations/beyond20/refresh-regression.test.cjs"), source], { stdio: "inherit" });
// Reuse the installed build dependencies without packaging or changing them.
symlinkSync(join(upstream, "node_modules"), join(source, "node_modules"));
try { execFileSync("npm", ["run", "build:chrome"], { cwd: source, stdio: "inherit" }); }
finally { unlinkSync(join(source, "node_modules")); }
cpSync(join(source, "build/chrome"), join(bundle, "chrome"), { recursive: true });
for (const file of ["refresh-fix.patch", "refresh-regression.test.cjs", "DOWNLOAD-INSTRUCTIONS.md"]) cpSync(join(root, "integrations/beyond20", file), join(bundle, file));
const output = join(root, "public/downloads/beyond20-flc-2.20.1-r1.zip");
mkdirSync(join(root, "public/downloads"), { recursive: true });
// Generate a fresh archive in staging so reruns cannot retain removed entries.
const zipped = join(stage, "download.zip");
execFileSync("zip", ["-q", "-r", "-X", zipped, "beyond20-flc-2.20.1-r1", "-x", "*/source/build/*", "*/source/dist/*"], { cwd: stage });
execFileSync("unzip", ["-tq", zipped], { stdio: "inherit" });
cpSync(zipped, output);
console.log(output);
