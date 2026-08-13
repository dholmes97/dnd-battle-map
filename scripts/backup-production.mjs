import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const hosting = JSON.parse(await readFile(join(projectRoot, ".openai", "hosting.json"), "utf8"));
const backupToken = process.env.PRODUCTION_BACKUP_TOKEN ?? process.env.CATALOG_IMPORT_TOKEN ?? "";
const siteUrl = (process.env.BATTLE_MAP_SITE_URL ?? "https://dnd-battle-map-poc.danholmes346.chatgpt.site").replace(/\/$/, "");
const backupRoot = resolve(process.env.BATTLE_MAP_BACKUP_ROOT ?? join(dirname(projectRoot), `${basename(projectRoot)} Backups`));
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const snapshotName = `production-${timestamp}`;
const finalDirectory = join(backupRoot, snapshotName);
const workingDirectory = `${finalDirectory}.incomplete`;
const authHeaders = { authorization: `Bearer ${backupToken}` };

if (backupToken.length < 32) {
  fail("Set PRODUCTION_BACKUP_TOKEN (or the existing CATALOG_IMPORT_TOKEN) to the production secret before backing up.");
}
if (new URL(siteUrl).protocol !== "https:" && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(siteUrl)) {
  fail("BATTLE_MAP_SITE_URL must use HTTPS unless it points to localhost.");
}
await assertAbsent(finalDirectory);
await assertAbsent(workingDirectory);
await mkdir(workingDirectory, { recursive: false, mode: 0o700 }).catch(async (error) => {
  if (error?.code !== "ENOENT") throw error;
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  await mkdir(workingDirectory, { recursive: false, mode: 0o700 });
});

try {
  console.log(`Creating production backup in ${finalDirectory}`);
  const d1Directory = join(workingDirectory, "d1");
  const r2Directory = join(workingDirectory, "r2", "objects");
  await mkdir(d1Directory, { recursive: true, mode: 0o700 });
  await mkdir(r2Directory, { recursive: true, mode: 0o700 });

  console.log("Downloading D1 schema and rows…");
  const d1Index = await fetchJson(`${siteUrl}/api/admin/production-backup/d1`);
  validateD1Index(d1Index);
  await writePrivateJson(join(d1Directory, "index.json"), d1Index);
  const d1Checksums = [];
  for (const table of d1Index.tables) {
    const tablePath = join(d1Directory, "tables", `${table.name}.ndjson`);
    await mkdir(dirname(tablePath), { recursive: true, mode: 0o700 });
    const file = await open(tablePath, "wx", 0o600);
    let offset = 0;
    let actualCount = 0;
    try {
      while (offset !== null) {
        const page = await fetchJson(`${siteUrl}/api/admin/production-backup/d1?table=${encodeURIComponent(table.name)}&offset=${offset}`);
        if (page.table !== table.name || page.offset !== offset || !Array.isArray(page.items)) {
          throw new Error(`Invalid D1 backup page for ${table.name} at offset ${offset}.`);
        }
        for (const row of page.items) await file.write(`${JSON.stringify(row)}\n`);
        actualCount += page.items.length;
        offset = page.nextOffset;
      }
    } finally {
      await file.close();
    }
    if (actualCount !== table.rowCount) {
      throw new Error(`D1 table ${table.name} changed during backup: expected ${table.rowCount} rows, downloaded ${actualCount}. Run the backup again while the site is idle.`);
    }
    d1Checksums.push({ table: table.name, rowCount: actualCount, path: posixRelative(workingDirectory, tablePath), sha256: await sha256File(tablePath) });
    console.log(`  ${table.name}: ${actualCount} rows`);
  }

  console.log("Building and validating a restorable SQLite copy…");
  const sqlitePath = join(d1Directory, "production.sqlite3");
  const sqliteImport = join(d1Directory, "restore.sql");
  const restoreSql = await buildRestoreSql(d1Index, d1Checksums, workingDirectory);
  await writeFile(sqliteImport, restoreSql, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await runCommand("sqlite3", [sqlitePath, ".read " + sqliteImport]);
  const integrity = (await runCommand("sqlite3", [sqlitePath, "PRAGMA integrity_check;"])).trim();
  if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${integrity}`);
  await chmod(sqlitePath, 0o600);

  console.log("Downloading R2 objects…");
  const r2Objects = [];
  let cursor = null;
  do {
    const pageUrl = new URL(`${siteUrl}/api/admin/production-backup/r2`);
    if (cursor) pageUrl.searchParams.set("cursor", cursor);
    const page = await fetchJson(pageUrl.href);
    if (!Array.isArray(page.objects)) throw new Error("Invalid R2 backup listing.");
    for (const object of page.objects) {
      validateR2Object(object);
      const objectPath = safeObjectPath(r2Directory, object.key);
      await mkdir(dirname(objectPath), { recursive: true, mode: 0o700 });
      const response = await fetch(`${siteUrl}/api/admin/production-backup/r2/object?key=${encodeURIComponent(object.encodedKey)}`, { headers: authHeaders });
      if (!response.ok || !response.body) throw new Error(`Could not download R2 object ${object.key}: HTTP ${response.status}.`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== object.size) {
        throw new Error(`R2 object ${object.key} changed during backup: expected ${object.size} bytes, downloaded ${bytes.byteLength}. Run the backup again while the site is idle.`);
      }
      await writeFile(objectPath, bytes, { mode: 0o600, flag: "wx" });
      r2Objects.push({
        key: object.key,
        path: posixRelative(workingDirectory, objectPath),
        size: object.size,
        etag: object.etag ?? null,
        uploaded: object.uploaded,
        contentType: object.contentType ?? null,
        sha256: sha256Bytes(bytes),
      });
      console.log(`  ${object.key}: ${object.size} bytes`);
    }
    cursor = page.truncated ? page.cursor : null;
    if (page.truncated && !cursor) throw new Error("R2 listing was truncated without a continuation cursor.");
  } while (cursor);

  const manifest = {
    formatVersion: 1,
    completedAt: new Date().toISOString(),
    source: { siteUrl, projectId: hosting.project_id, d1Binding: hosting.d1, r2Binding: hosting.r2 },
    d1: {
      capturedAt: d1Index.capturedAt,
      tableCount: d1Checksums.length,
      rowCount: d1Checksums.reduce((sum, table) => sum + table.rowCount, 0),
      tables: d1Checksums,
      restoreSql: posixRelative(workingDirectory, sqliteImport),
      restoreSqlSha256: await sha256File(sqliteImport),
      sqlite: posixRelative(workingDirectory, sqlitePath),
      sqliteSha256: await sha256File(sqlitePath),
      integrityCheck: integrity,
    },
    r2: {
      objectCount: r2Objects.length,
      byteCount: r2Objects.reduce((sum, object) => sum + object.size, 0),
      objects: r2Objects,
    },
  };
  const manifestPath = join(workingDirectory, "manifest.json");
  await writePrivateJson(manifestPath, manifest);
  await writeFile(join(workingDirectory, "COMPLETE"), `${manifest.completedAt}\n${await sha256File(manifestPath)}  manifest.json\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(workingDirectory, finalDirectory);
  console.log(`Backup complete: ${finalDirectory}`);
  console.log(`D1: ${manifest.d1.rowCount} rows across ${manifest.d1.tableCount} tables; R2: ${manifest.r2.objectCount} objects (${manifest.r2.byteCount} bytes).`);
} catch (error) {
  console.error(`Backup failed. Partial files remain at ${workingDirectory}`);
  throw error;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: authHeaders });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Backup request failed (${response.status}) for ${new URL(url).pathname}: ${message.slice(0, 300)}`);
  }
  return response.json();
}

function validateD1Index(index) {
  if (index?.formatVersion !== 1 || !Array.isArray(index.tables) || !Array.isArray(index.schema)) throw new Error("Invalid D1 backup index.");
  const names = new Set();
  for (const table of index.tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(table.name) || !Number.isSafeInteger(table.rowCount) || table.rowCount < 0 || names.has(table.name)) {
      throw new Error("Invalid D1 table metadata in backup index.");
    }
    names.add(table.name);
  }
}

function validateR2Object(object) {
  if (!object || typeof object.key !== "string" || !object.key || typeof object.encodedKey !== "string" || !Number.isSafeInteger(object.size) || object.size < 0) {
    throw new Error("Invalid R2 object metadata in backup listing.");
  }
}

function safeObjectPath(root, key) {
  const normalized = key.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe R2 object key: ${JSON.stringify(key)}`);
  }
  const path = resolve(root, ...normalized.split("/"));
  if (!path.startsWith(`${resolve(root)}/`)) throw new Error(`Unsafe R2 object key: ${JSON.stringify(key)}`);
  return path;
}

async function buildRestoreSql(index, tables, root) {
  const tableNames = new Set(tables.map((table) => table.table));
  const schemaEntries = index.schema.filter((entry) => entry && typeof entry.sql === "string" && tableNames.has(entry.tableName));
  const tableSchema = schemaEntries.filter((entry) => entry.type === "table");
  const otherSchema = schemaEntries.filter((entry) => entry.type !== "table");
  const lines = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];
  for (const entry of tableSchema) lines.push(`${entry.sql};`);
  for (const table of tables) {
    const text = await readFile(resolve(root, table.path), "utf8");
    const rows = text ? text.trimEnd().split("\n").map((line) => JSON.parse(line)) : [];
    for (const row of rows) {
      const columns = Object.keys(row);
      lines.push(`INSERT INTO ${quoteIdentifier(table.table)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${columns.map((column) => sqliteLiteral(row[column])).join(", ")});`);
    }
  }
  for (const entry of otherSchema) lines.push(`${entry.sql};`);
  lines.push("COMMIT;", "PRAGMA foreign_keys=ON;", "");
  return lines.join("\n");
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function sqliteLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot back up a non-finite number.");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  if (value && typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) {
    return `X'${Buffer.from(value.data).toString("hex")}'`;
  }
  throw new Error(`Unsupported D1 value type: ${typeof value}.`);
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

async function assertAbsent(path) {
  try {
    await access(path);
    throw new Error(`Refusing to overwrite existing backup path: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function sha256File(path) {
  return sha256Bytes(await readFile(path));
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function posixRelative(from, to) {
  return relative(from, to).split("\\").join("/");
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

function fail(message) {
  console.error(message);
  process.exit(1);
}
