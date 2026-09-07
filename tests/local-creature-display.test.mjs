import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { localCreatureDisplay, localCreatureDisplayBytes } from '../build/local-creature-display.ts';

test('every bundled creature uses an existing WebP and has no superseded PNG', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/assets/tokens/manifest.json', import.meta.url), 'utf8'));
  const creatures = manifest.assets.filter(asset => /\/tokens\/(creatures|monsters)\//.test(asset.path));
  assert.equal(creatures.length, 17);
  for (const asset of creatures) {
    assert.ok(asset.path.endsWith('.webp'));
    const file = new URL(`../public${asset.path}`, import.meta.url);
    const metadata = await sharp(await readFile(file)).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.hasAlpha, true);
    await assert.rejects(access(new URL(file.href.replace(/\.webp$/, '.png'))), { code: 'ENOENT' });
  }
});

test('local preview serves bundled WebP bytes unchanged without production storage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-creature-display-'));
  try {
    const source = join(root, 'public/assets/tokens/creatures');
    await mkdir(source, { recursive: true });
    const bundled = await sharp({ create: { width: 4, height: 5, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).webp().toBuffer();
    await writeFile(join(source, 'ogre.webp'), bundled);
    const result = await localCreatureDisplayBytes(root, '/creature-assets/display/v1/tokens/creatures/ogre.webp');
    const metadata = await sharp(result).metadata();
    assert.deepEqual(result, bundled);
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 4);
    assert.equal(metadata.height, 5);
    assert.equal(metadata.hasAlpha, true);
    const prepared = join(root, '.working/creature-display-webp-v1/r2/creature-catalog/display/tokens/creatures');
    await mkdir(prepared, { recursive: true });
    const exact = await sharp(result).webp({ lossless: true }).toBuffer();
    await writeFile(join(prepared, 'ogre.webp'), exact);
    assert.deepEqual(await localCreatureDisplayBytes(root, '/creature-assets/display/v1/tokens/creatures/ogre.webp'), exact);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local adapter excludes builds, provisioned creatures, traversal, thumbnails, and unknown assets', async () => {
  assert.equal(localCreatureDisplay().apply, 'serve');
  for (const path of ['/creature-assets/tokens/creatures/ogre.png', '/creature-assets/display/v1/tokens/provisioned/job/file.webp', '/creature-assets/display/v1/tokens/creatures/../../secret.webp', '/creature-assets/display/v1/tokens/creatures/%2e%2e.webp', '/creature-assets/display/v1/tokens/creatures/missing.webp']) {
    assert.equal(await localCreatureDisplayBytes('/private/tmp/nonexistent-creature-fixture', path), null);
  }
});
