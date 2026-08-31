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
