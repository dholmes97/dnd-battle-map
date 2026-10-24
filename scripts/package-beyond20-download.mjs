import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const root = process.cwd();
const upstream = resolve(process.argv[2] ?? ".working/beyond20-refresh-fix");
const base = "3d737952cd1ba505cd73a9f0d4ef8e84c5f47a8b";
const reviewed = "2c4a57baa2f03a080fd7bcc09c9b0c7bdab921e3";
const revision = "beyond20-flc-2.20.1-r2";
assert.equal(execFileSync("git", ["-C", upstream, "rev-parse", "--verify", `${reviewed}^{commit}`], { encoding: "utf8" }).trim(), reviewed);
const stage = mkdtempSync(join(tmpdir(), "beyond20-download-"));
const bundle = join(stage, revision);
const source = join(bundle, "source");
mkdirSync(source, { recursive: true });
// Only the reviewed commit's tracked build inputs enter the archive.
// Never copy a mutable working tree, installed dependencies or browser profile.
const archive = execFileSync("git", ["-C", upstream, "archive", reviewed, "src", "libs", "images", "scripts", "tests", "refresh-regression.test.cjs", ".node-version", "package.json", "package-lock.json", "gulpfile.js", "manifest.json", "manifest_ff.json", "options.html", "options.css", "popup.html", "default_popup.html", "README.md", "LICENSE", "LICENSE.MIT"], { maxBuffer: 32 * 1024 * 1024 });
execFileSync("tar", ["-xf", "-", "-C", source], { input: archive });
const nodeVersion = readFileSync(join(source, ".node-version"), "utf8").trim();
assert.equal(process.versions.node, nodeVersion, `Run this packager with Node ${nodeVersion}`);
const lock = JSON.parse(readFileSync(join(source, "package-lock.json"), "utf8"));
for (const dependency of Object.values(lock.packages)) {
  if (!dependency.resolved) continue;
  const url = new URL(dependency.resolved);
  assert.equal(url.origin, "https://registry.npmjs.org");
  assert.equal(url.username + url.password + url.search, "");
}
const env = {
  ...process.env,
  PATH: dirname(process.execPath) + delimiter + process.env.PATH,
  NO_UPDATE_NOTIFIER: "1",
  XDG_CONFIG_HOME: join(stage, "config"),
  XDG_CACHE_HOME: join(stage, "cache"),
  npm_config_cache: join(root, ".working", "beyond20-download-npm-cache"),
};
execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: source, env, stdio: "inherit" });
const manifestPath = join(source, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.name = "Beyond20 — Friday Lunch Crew (unofficial)";
manifest.version_name = "2.20.1 FLC refresh fix r2";
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
execFileSync(process.execPath, [join(root, "integrations/beyond20/refresh-regression.test.cjs"), source], { env, stdio: "inherit" });
for (const command of ["check", "build", "test"]) {
  execFileSync("npm", ["run", command], { cwd: source, env, stdio: "inherit" });
}
cpSync(join(source, "build/chrome"), join(bundle, "chrome"), { recursive: true });
for (const file of ["refresh-fix.patch", "refresh-regression.test.cjs", "DOWNLOAD-INSTRUCTIONS.md"]) cpSync(join(root, "integrations/beyond20", file), join(bundle, file));
writeFileSync(join(bundle, "reviewed-changes.patch"), execFileSync("git", ["-C", upstream, "diff", "--binary", base, reviewed], { maxBuffer: 16 * 1024 * 1024 }));
writeFileSync(join(bundle, "BUILD-PROVENANCE.json"), JSON.stringify({ upstreamCommit: base, reviewedCommit: reviewed, revision, nodeVersion, npmVersion: execFileSync("npm", ["--version"], { env, encoding: "utf8" }).trim() }, null, 2) + "\n");
for (const directory of ["node_modules", "build", "dist"]) rmSync(join(source, directory), { recursive: true, force: true });
const output = join(root, "public/downloads", revision + ".zip");
mkdirSync(join(root, "public/downloads"), { recursive: true });
// Generate a fresh archive in staging so reruns cannot retain removed entries.
const zipped = join(stage, "download.zip");
execFileSync("zip", ["-q", "-r", "-X", zipped, revision], { cwd: stage });
execFileSync("unzip", ["-tq", zipped], { stdio: "inherit" });
cpSync(zipped, output);
console.log(output);
