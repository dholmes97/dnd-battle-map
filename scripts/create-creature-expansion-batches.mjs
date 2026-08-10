import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const expansionPath = resolve("catalog/creatures-expansion-1000.json");
const outputDirectory = resolve("catalog/batches");
const expansion = JSON.parse(await readFile(expansionPath, "utf8"));
const creatures = expansion.creatures;

if (!Array.isArray(creatures) || creatures.length !== 500) {
  throw new Error("The expansion catalog must contain exactly 500 creatures.");
}

await mkdir(outputDirectory, { recursive: true });
for (let offset = 0; offset < creatures.length; offset += 10) {
  const batchNumber = 50 + offset / 10;
  const batchPath = resolve(outputDirectory, `batch-${String(batchNumber).padStart(3, "0")}.json`);
  const batchCreatures = [];
  for (const creature of creatures.slice(offset, offset + 10)) {
    const imagePath = resolve(`catalog/art/full/${creature.id}.png`);
    const thumbnailPath = resolve(`catalog/art/thumbnails/${creature.id}.png`);
    await Promise.all([access(imagePath), access(thumbnailPath)]);
    batchCreatures.push({
      ...creature,
      image: relative(outputDirectory, imagePath),
      thumbnail: relative(outputDirectory, thumbnailPath),
    });
  }
  await writeFile(batchPath, `${JSON.stringify({ creatures: batchCreatures }, null, 2)}\n`);
  console.log(`Wrote ${batchCreatures.length} creatures to ${relative(resolve(), batchPath)}`);
}
