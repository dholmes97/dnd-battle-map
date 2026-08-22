import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const persistenceDirectory = await mkdtemp(
  join(tmpdir(), "dnd-battle-map-browser-"),
);
const environment = {
  ...process.env,
  BATTLE_MAP_LOCAL_D1_STATE: persistenceDirectory,
};

try {
  await run(["run", "build"]);
  await run(["run", "db:bootstrap"]);
  await serve();
} finally {
  await rm(persistenceDirectory, { force: true, recursive: true });
}

function run(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", arguments_, {
      cwd: projectRoot,
      env: environment,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${arguments_.join(" ")} stopped with ${code ?? signal}.`));
    });
  });
}

function serve() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npm",
      ["run", "dev", "--", "--host", "localhost", "--port", "4173"],
      {
        cwd: projectRoot,
        env: environment,
        stdio: "inherit",
      },
    );
    const stop = (signal) => child.kill(signal);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") resolve();
      else reject(new Error(`Browser test server stopped with ${code ?? signal}.`));
    });
  });
}
