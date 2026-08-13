import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const backupRoot = resolve(process.env.BATTLE_MAP_BACKUP_ROOT ?? join(dirname(projectRoot), `${basename(projectRoot)} Backups`));
const backupDirectory = process.argv[2] ? resolve(process.argv[2]) : await findLatestCompleteBackup(backupRoot);

console.log(`Verifying production backup ${backupDirectory}`);
const completePath = join(backupDirectory, "COMPLETE");
const manifestPath = join(backupDirectory, "manifest.json");
const completeLines = (await readFile(completePath, "utf8")).trimEnd().split("\n");
if (completeLines.length !== 2 || !/^[a-f0-9]{64}  manifest\.json$/.test(completeLines[1])) throw new Error("Invalid COMPLETE marker.");
await assertHash(manifestPath, completeLines[1].slice(0, 64), "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
validateManifest(manifest);

let d1Rows = 0;
for (const table of manifest.d1.tables) {
  const path = safeManifestPath(backupDirectory, table.path);
  await assertHash(path, table.sha256, table.path);
  const actualRows = await countLines(path);
  if (actualRows !== table.rowCount) throw new Error(`${table.path} contains ${actualRows} rows; manifest expects ${table.rowCount}.`);
  d1Rows += actualRows;
}
if (d1Rows !== manifest.d1.rowCount) throw new Error(`D1 total is ${d1Rows}; manifest expects ${manifest.d1.rowCount}.`);
await assertHash(safeManifestPath(backupDirectory, manifest.d1.restoreSql), manifest.d1.restoreSqlSha256, manifest.d1.restoreSql);
const sqlitePath = safeManifestPath(backupDirectory, manifest.d1.sqlite);
await assertHash(sqlitePath, manifest.d1.sqliteSha256, manifest.d1.sqlite);
const integrity = (await runCommand("sqlite3", [sqlitePath, "PRAGMA integrity_check;"])).trim();
if (integrity !== "ok" || manifest.d1.integrityCheck !== "ok") throw new Error(`SQLite integrity check failed: ${integrity}`);
for (const table of manifest.d1.tables) {
  const count = Number((await runCommand("sqlite3", [sqlitePath, `SELECT COUNT(*) FROM ${quoteIdentifier(table.table)};`])).trim());
  if (count !== table.rowCount) throw new Error(`SQLite table ${table.table} contains ${count} rows; manifest expects ${table.rowCount}.`);
}

let r2Bytes = 0;
const objectRoot = join(backupDirectory, "r2", "objects");
const expectedObjectPaths = new Set();
for (const object of manifest.r2.objects) {
  const path = safeManifestPath(backupDirectory, object.path);
  expectedObjectPaths.add(relative(objectRoot, path).split("\\").join("/"));
  const details = await stat(path);
  if (!details.isFile() || details.size !== object.size) throw new Error(`${object.path} is ${details.size} bytes; manifest expects ${object.size}.`);
  await assertHash(path, object.sha256, object.path);
  r2Bytes += details.size;
}
if (r2Bytes !== manifest.r2.byteCount) throw new Error(`R2 total is ${r2Bytes} bytes; manifest expects ${manifest.r2.byteCount}.`);
const actualObjectPaths = new Set(await listFiles(objectRoot));
for (const path of expectedObjectPaths) if (!actualObjectPaths.has(path)) throw new Error(`Missing R2 object file: ${path}`);
for (const path of actualObjectPaths) if (!expectedObjectPaths.has(path)) throw new Error(`Unexpected R2 object file: ${path}`);

console.log(`Backup verified: ${manifest.d1.rowCount} D1 rows across ${manifest.d1.tableCount} tables; ${manifest.r2.objectCount} R2 objects (${manifest.r2.byteCount} bytes).`);

async function findLatestCompleteBackup(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isDirectory() && /^production-/.test(entry.name) && !entry.name.endsWith(".incomplete")).map((entry) => entry.name).sort().reverse();
  for (const name of candidates) {
    try {
      await access(join(root, name, "COMPLETE"));
      return join(root, name);
    } catch {
      // Keep looking for the newest snapshot with a completion marker.
    }
  }
  throw new Error(`No complete production backup found in ${root}.`);
}

function validateManifest(manifest) {
  if (manifest?.formatVersion !== 1 || !Array.isArray(manifest?.d1?.tables) || !Array.isArray(manifest?.r2?.objects)) throw new Error("Invalid backup manifest.");
  if (manifest.d1.tableCount !== manifest.d1.tables.length || manifest.r2.objectCount !== manifest.r2.objects.length) throw new Error("Manifest aggregate counts do not match its entries.");
  const paths = new Set();
  for (const entry of [...manifest.d1.tables, ...manifest.r2.objects]) {
    if (typeof entry.path !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256) || paths.has(entry.path)) throw new Error("Invalid or duplicate manifest path/checksum.");
    paths.add(entry.path);
  }
}

function safeManifestPath(root, path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.split(/[\\/]/).some((part) => !part || part === "." || part === "..")) throw new Error(`Unsafe manifest path: ${JSON.stringify(path)}`);
  const absolute = resolve(root, path);
  if (!absolute.startsWith(`${resolve(root)}/`)) throw new Error(`Unsafe manifest path: ${JSON.stringify(path)}`);
  return absolute;
}

async function assertHash(path, expected, label) {
  const actual = await sha256File(path);
  if (actual !== expected) throw new Error(`${label} checksum mismatch.`);
}

function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

async function countLines(path) {
  let count = 0;
  for await (const chunk of createReadStream(path)) for (const byte of chunk) if (byte === 10) count += 1;
  return count;
}

async function listFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await listFiles(root, path));
    else if (entry.isFile()) paths.push(relative(root, path).split("\\").join("/"));
    else throw new Error(`Unexpected non-file object in R2 mirror: ${path}`);
  }
  return paths;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function runCommand(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(`${command} failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
  });
}
