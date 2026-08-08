import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const [, , outputArgument, ...ids] = process.argv;
if (!outputArgument || ids.length < 1 || ids.length > 10) {
  console.error("Usage: node scripts/create-creature-batch.mjs catalog/batches/batch-001.json creature-id …");
  process.exitCode = 1;
} else {
  const outputPath = resolve(outputArgument);
  const outputDirectory = dirname(outputPath);
  const catalog = JSON.parse(await readFile(resolve("catalog/creatures.json"), "utf8"));
  const creatures = [];
  for (const id of ids) {
    const metadata = catalog.additions.find((creature) => creature.id === id);
    if (!metadata) throw new Error(`Unknown creature ID: ${id}`);
    const imagePath = resolve(`catalog/art/full/${id}.png`);
    const thumbnailPath = resolve(`catalog/art/thumbnails/${id}.png`);
    await Promise.all([access(imagePath), access(thumbnailPath)]);
    creatures.push({
      ...metadata,
      image: relative(outputDirectory, imagePath),
      thumbnail: relative(outputDirectory, thumbnailPath),
    });
  }
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ creatures }, null, 2)}\n`);
  console.log(`Wrote ${creatures.length} creatures to ${outputPath}`);
}
