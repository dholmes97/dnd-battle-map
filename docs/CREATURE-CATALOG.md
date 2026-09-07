# Creature catalog

Each catalog record is ready to place without setup: name, family/type, size, average HP, hit dice, armor class, challenge rating, and walk/fly/swim/climb/burrow speeds. Placing a creature initializes current and maximum HP to its average HP.

Metadata for standard creatures is derived from the open D&D System Reference Document. All creature artwork in this project is newly generated for this catalog and must not reproduce published monster illustrations.

This work includes material from the System Reference Document 5.1/5.2 by Wizards of the Coast LLC, available under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/legalcode).

Production imports use `scripts/import-creature-batch.mjs`, one to ten creatures per manifest. `CATALOG_IMPORT_TOKEN` is a Sites secret and must never be written to the repository.

## Retiring original catalog PNGs

Original catalog PNGs may be retired only through an exact manifest created from
a verified production backup and the complete WebP conversion manifest:

```bash
npm run catalog:plan-png-retirement -- \
  "/absolute/path/to/verified-backup" \
  .working/creature-display-webp-v1/manifest.json \
  catalog/retirement-manifests/creature-original-png-v1.json
```

The generator verifies the backup first, then requires every candidate to have
matching catalog metadata, a versioned D1 display-variant row, matching PNG and
WebP checksums in R2, and decodable image bytes. The resulting manifest permits
only `creature-catalog/original/**.png`; creature thumbnails, provisioned
creatures, maps, and handouts are protected namespaces.

Before any production deletion, prove the selected snapshot can restore the
entire manifest into a new disposable directory path:

```bash
npm run catalog:test-png-restoration -- \
  "/absolute/path/to/verified-backup" \
  catalog/retirement-manifests/creature-original-png-v1.json \
  "/absolute/path/to/new-restore-target"
```

The restore target path must not exist. The test refuses a different backup,
unsafe keys, checksum drift, or invalid PNG bytes. `RESTORE-COMPLETE.json` is written
only after every restored object is re-hashed successfully. This command does
not mutate production R2.

## Executing the reviewed retirement

The bounded `/api/admin/creature-png-retirement` maintenance endpoint accepts
only the compiled retirement manifest digest and fixed ten-creature batches
0–99. It requires a dedicated `CREATURE_PNG_RETIREMENT_TOKEN` and a future
`CREATURE_PNG_RETIREMENT_EXPIRES_AT`; backup, catalog-import, and participant
credentials never authorize deletion. Keep the temporary secret in Keychain
service `dnd-battle-map-png-retirement`, account `dnd-battle-map`, and disable it
when cleanup finishes.

The endpoint checks catalog/variant rows, thumbnails, original and replacement
checksums, and image formats before any deletion. It shares both catalog-writer
locks, writes a durable R2 intent before deletion, verifies absence afterward,
and writes completion receipts under `maintenance/creature-png-retirement-v1/`.
Retries resume the same fixed batch; later batches require the preceding batch's
completion. No campaign, encounter, token, or catalog rows are changed.

Reviewed legacy PNG URLs redirect to their WebP replacements. Thumbnail routes
retain their PNG thumbnails but cannot regenerate or fall back to a retired
original. Unlisted and provisioned creature assets retain their existing behavior.

After verified backup and local restoration, run a dry run followed by the canary:

```bash
node scripts/retire-creature-pngs.mjs
node scripts/retire-creature-pngs.mjs --apply
```

The client defaults to batch zero and records local receipts. It checks and
decodes every WebP through its legacy URL and every thumbnail after each batch.
Only after reviewing the canary, continue with `--apply --from 1 --through 99`.
Stop on any failed check and inspect receipts before resuming. Restoration means
re-uploading only the exact missing originals from the verified snapshot under
their original keys; never roll back current D1 data for an image-only recovery.
