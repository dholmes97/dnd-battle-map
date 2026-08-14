import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import sharp from "sharp";

import { inspectWebp, storedHandoutVariantError } from "../shared/handout-domain.ts";
import { inspectPng } from "../shared/scenario-provisioning.ts";

const projectRoot = new URL("../", import.meta.url);

test("trusted preparation commands create bounded handout and transparent creature variants", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scenario-assets-"));
  try {
    const handoutSource = join(directory, "invitation.png");
    await sharp({ create: { width: 1800, height: 2400, channels: 4, background: { r: 232, g: 220, b: 184, alpha: 1 } } }).png().toFile(handoutSource);
    const handout = JSON.parse(await run("scripts/prepare-scenario-handout.mjs", [handoutSource, join(directory, "invitation")]));
    const display = new Uint8Array(await readFile(handout.display.path));
    const thumbnail = new Uint8Array(await readFile(handout.thumbnail.path));
    const displayDimensions = inspectWebp(display);
    const thumbnailDimensions = inspectWebp(thumbnail);
    assert.equal(storedHandoutVariantError({ variant: "display", contentType: "image/webp", byteLength: display.byteLength, ...displayDimensions }), null);
    assert.equal(storedHandoutVariantError({ variant: "thumbnail", contentType: "image/webp", byteLength: thumbnail.byteLength, ...thumbnailDimensions }), null);

    const creatureSource = join(directory, "shadow-bat.png");
    await sharp({ create: { width: 700, height: 900, channels: 4, background: { r: 40, g: 15, b: 70, alpha: 0.8 } } }).png().toFile(creatureSource);
    const creature = JSON.parse(await run("scripts/prepare-creature-art.mjs", [creatureSource, join(directory, "shadow-bat")]));
    assert.deepEqual(inspectPng(new Uint8Array(await readFile(creature.original.path))), { width: 700, height: 900 });
    assert.deepEqual(inspectPng(new Uint8Array(await readFile(creature.thumbnail.path))), { width: 199, height: 256 });
    assert.equal((await sharp(creature.original.path).metadata()).hasAlpha, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function run(script, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...arguments_], { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(Buffer.concat(stdout).toString("utf8"))
      : reject(new Error(Buffer.concat(stderr).toString("utf8"))));
  });
}
