# Production backups

Run a complete, read-only snapshot before destructive or non-additive production
migrations, bulk data or asset mutations, persistence refactors with a credible
data-loss risk, and deliberate disaster-recovery checkpoints:

```bash
PRODUCTION_BACKUP_TOKEN="…" npm run backup:production
```

Re-verify the newest completed snapshot independently at any time:

```bash
npm run backup:verify
```

Pass an absolute snapshot path after `--` to verify a particular backup.

The production Worker and the local command must share the dedicated
`PRODUCTION_BACKUP_TOKEN`. The catalog import secret is a separate credential
and cannot authorize a production backup. If `PRODUCTION_BACKUP_TOKEN` is
missing, the backup endpoint fails closed with `401 Unauthorized`.

By default, snapshots are written outside this repository to its sibling
directory:

```text
../D&D Battle Map Backups/production-YYYY-MM-DDTHH-MM-SS-mmmZ/
```

Set `BATTLE_MAP_BACKUP_ROOT` to use a different absolute or relative directory.
Set `BATTLE_MAP_SITE_URL` only when backing up a different deployment. Production
URLs must use HTTPS; HTTP is accepted only for localhost testing.

## Snapshot contents

- `manifest.json` identifies the Sites project and records counts, sizes, and
  SHA-256 checksums.
- `d1/production.sqlite3` is a locally validated SQLite copy of the structured
  data.
- `d1/restore.sql` is a D1-compatible SQL representation of the same schema and
  rows.
- `d1/tables/*.ndjson` contains the source rows used to build and verify the
  SQLite copy.
- `r2/objects/**` mirrors every R2 key and preserves its original path.
- `COMPLETE` exists only after all downloads, row and byte counts, checksums,
  and SQLite integrity validation succeed.

The separate verifier re-hashes the marker and manifest, every D1 artifact and
R2 object, compares all declared sizes and counts, rejects missing or unexpected
object files, and re-runs SQLite integrity and per-table count checks.

The command never overwrites an existing snapshot. If it fails, it leaves a
directory ending in `.incomplete` for diagnosis; that directory is not a valid
backup and should not be used for restoration.

## Operational rules

Run backups while the game is idle. D1 tables and R2 objects are paginated, so
the two stores cannot be captured as one transaction while players are changing
state. The command detects count and size changes, but it cannot detect every
same-size concurrent edit.

The backup endpoint is read-only, bearer protected, uncached, and deliberately
separate from participant sessions and catalog import. Never store the backup
token in the repository or in a backup directory.

Ordinary additive schema changes, bounded new APIs, UI-only releases, and normal
scenario-provisioning jobs do not require a backup. Their safety should come from
validation, idempotency, scoped writes, atomic transactions, and tests rather
than routine snapshots.

Restoration is intentionally not automated. It is destructive and should only
be performed after identifying the affected production resources and reviewing
the selected snapshot. Restore D1 and R2 to disposable local or staging storage
first whenever possible.
