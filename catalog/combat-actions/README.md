# Creature combat-action enrichment

This directory is the data-only staging source for future creature action imports. It does not load or modify D1 or R2.

## Contents

- `manifest.json` records aggregate counts plus the SHA-256 digest and creature count for every batch.
- `batches/source-batch-001.json` through `source-batch-083.json` contain the 829 source-backed catalog creatures in source-catalog order, with at most ten creatures per file.
- `verification.json` records the latest full coverage, constraint, provenance, action-accounting, and checksum audit.

Raw API responses and the resumable research scripts are intentionally kept under the ignored `.working/catalog-action-enrichment/` directory. The normalized batch files are the durable future-import source.

## Creature records

Every creature records its existing catalog ID and name, readiness status, total source action count, source provenance, normalized supported attacks, explicitly omitted source actions, and unresolved review issues. A completed artifact has no `needs-review` statuses and no review issues.

Statuses are:

- `ready`: at least one supported attack and no manual riders.
- `ready-with-manual-riders`: at least one supported attack and at least one attack requiring DM resolution beyond primary damage.
- `no-supported-action`: the source has no attack-vs-AC action with supported primary damage. Saving-throw-only, effect-only, and other unsupported actions remain omitted.

Each source action is accounted for exactly once as either a normalized action or an `omittedSourceActions` entry. Multiattack is omitted rather than represented as one executable roll.

## Action contract

Normalized actions contain:

- `sourceActionIndex`: stable position in the downloaded source action list.
- `name`, `attackBonus`, and `attackKind`.
- structured primary `damage` and `damageType`.
- optional display-only `reachFeet` and `rangeFeet`.
- `manualRider` and conditionally required `manualRiderText`, bounded to 320 characters.
- optional structured `alternateDamage`.
- bounded `sourceRef` provenance.

`manualRiderText` concisely identifies secondary damage, saves, conditions, movement, ongoing effects, or damage-type choices that require DM attention. It is `null` when `manualRider` is false. Future persistence should snapshot this text into the immutable roll record so later catalog edits cannot change pending or historical adjudication context.

## Future import

After the production schema and action-only import endpoint are deployed, run `npm run catalog:import-actions` with `CATALOG_IMPORT_TOKEN` set. The command verifies every batch checksum and performs a server-side dry run only. After a verified production backup, append `-- --apply`; that mode repeats the complete dry run before submitting the batches in manifest order. The endpoint accepts at most ten existing creature IDs per request, replaces only those creatures' action profiles atomically, and leaves creature metadata and artwork untouched.

The source metadata retains SRD/Open5e document and publisher provenance. Preserve the applicable open-license attribution when importing or redistributing these derived action values.
