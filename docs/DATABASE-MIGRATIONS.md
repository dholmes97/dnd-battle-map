# Database migrations

Checked-in SQL files under `drizzle/` are the only schema-evolution and
one-time data-migration path. Application requests never create tables, alter
columns, seed records, backfill data, or perform retired-feature cleanup.

## Authoring a change

1. Change `db/schema.ts`.
2. Run `npm run db:generate` to create the next numbered migration.
3. Add any required bounded seed, backfill, or cleanup SQL to that migration.
   Make it preserve already-customized production values and safe to apply once.
4. Add or update `tests/schema-migrations.test.mjs` so a fresh database and a
   representative existing database both exercise the change.
5. Run `npm test` and `npm run lint`.

The initial production seed and the historical request-time maintenance were
captured in `0017_blushing_moondragon.sql`. Its deterministic data SQL can be
regenerated with `npm run db:generate-bootstrap` when reviewing that migration;
it is not an ordinary command for future migrations.

## Local development

Build once, then apply every unapplied checked-in migration to the project-local
Miniflare D1 database before starting the server:

```bash
npm run build
npm run db:bootstrap
npm run dev
```

Wrangler records applied local migrations and only applies new files on later
runs. The Worker performs a read-only check for the marker written by migration
0017 and fails closed with a clear error when local storage was not bootstrapped.

## Tests

`tests/schema-migrations.test.mjs` applies all numbered migrations in order to a
new SQLite database. It also applies the latest compatibility migration to a
copy of a populated fixture and proves custom scenario, token, and creature data
is preserved. The live suite uses the same locally migrated D1 storage through
the development server.

## Sites production

The build copies numbered migrations into `dist/.openai/drizzle/`. The Sites
packager includes that directory, and Sites applies previously unapplied files
before the new Worker version begins serving. Its migration ledger is included
in production backups.

Before a persistence-changing production release:

1. Run and independently verify `npm run backup:production` as described in
   `docs/PRODUCTION-BACKUPS.md`.
2. Validate the migration against a disposable copy of that snapshot.
3. Deploy the exact tested commit.
4. Confirm the new migration is in the production ledger and compare table
   counts and key scenario records with the pre-deployment snapshot.

Never restore into production as part of a routine release. Recovery is a
separate, deliberate operation using a disposable rehearsal first.
