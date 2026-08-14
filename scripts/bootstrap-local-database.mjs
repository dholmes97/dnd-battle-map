import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationDirectory = join(projectRoot, "drizzle");
const persistenceDirectory = resolve(process.env.BATTLE_MAP_LOCAL_D1_STATE ?? join(projectRoot, ".wrangler", "state"));
const d1Directory = join(persistenceDirectory, "v3", "d1", "miniflare-D1DatabaseObject");
const migrationFiles = (await readdir(migrationDirectory))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

if (migrationFiles.length === 0) throw new Error("No checked-in database migrations were found.");

let migratedLegacyDatabase = false;
for (const name of await readdir(d1Directory).catch(() => [])) {
  if (!name.endsWith(".sqlite") || name === "metadata.sqlite") continue;
  const database = join(d1Directory, name);
  const hasMaintenance = (await capture(
    "sqlite3",
    [database, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_maintenance';"],
  )).trim();
  if (!hasMaintenance) {
    continue;
  }
  const provisioningUpgrades = [
    ["scenario-provisioning-v1", "0019_"],
    ["scenario-provisioning-revision-guard-v1", "0020_"],
    ["scenario-mail-provenance-v1", "0021_"],
  ];
  for (const [marker, migrationPrefix] of provisioningUpgrades) {
    const applied = (await capture(
      "sqlite3",
      [database, `SELECT 1 FROM app_maintenance WHERE id = '${marker}' LIMIT 1;`],
    )).trim();
    if (applied) continue;
    const migration = migrationFiles.find((candidate) => candidate.startsWith(migrationPrefix));
    if (!migration) throw new Error(`Required migration ${migrationPrefix} is missing.`);
    await capture("sqlite3", [database], await readFile(join(migrationDirectory, migration), "utf8"));
  }
  await capture("sqlite3", [database], `
    CREATE TABLE IF NOT EXISTS d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    BEGIN;
    ${migrationFiles.map((migration) => `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${migration}');`).join("\n")}
    COMMIT;
  `);
  migratedLegacyDatabase = true;
}

function capture(command, arguments_, input = null) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: projectRoot,
      stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(`${command} exited with status ${code}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    if (input !== null) child.stdin.end(input);
  });
}

if (migratedLegacyDatabase) {
  console.log("Upgraded the existing project-local database without replacing its data.");
} else {
  await run("npx", [
  "wrangler",
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
  "--persist-to",
  persistenceDirectory,
  "--config",
  join(projectRoot, "dist", "server", "wrangler.json"),
  ]);
}

console.log(`Local database is current through ${migrationFiles.at(-1)}.`);

function run(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: projectRoot,
      env: {
        ...process.env,
        CI: "1",
        WRANGLER_WRITE_LOGS: "false",
        WRANGLER_LOG_PATH: join(projectRoot, ".wrangler", "wrangler.log"),
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with status ${code}.`));
    });
  });
}
