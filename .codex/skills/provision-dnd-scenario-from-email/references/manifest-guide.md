# Provisioning manifest guide

The project source is authoritative:

- Domain parser and limits: `/Volumes/OWC2TB/Projects/D&D Battle Map/shared/scenario-provisioning.ts`
- Trusted client: `/Volumes/OWC2TB/Projects/D&D Battle Map/scripts/provision-scenario.mjs`
- Feature requirements: `/Volumes/OWC2TB/Projects/D&D Battle Map/docs/DM-EMAIL-SCENARIO-PROVISIONING.md`

Do not maintain a second field-by-field schema here. Import or inspect the parser before building an envelope. The envelope has only two top-level keys:

- `manifest`: the versioned declarative production contract;
- `assets`: a local-only map from each parser-derived asset ID to `{ "path": "relative/file", "contentType": "image/..." }`.

The local `assets` object is never sent as part of the manifest. The client uploads only parser-derived asset IDs; the API derives every R2 key.

Operational invariants:

- The manifest source is Gmail and records stable mailbox/message/thread identity plus normalized sender.
- `create` requires a map and normally copies the established party at full health.
- `revise` requires a scenario code, never recopies the party, and preserves the current map when `map` is null.
- New catalog creatures require original and thumbnail PNG asset IDs; catalog reuse sets `create` to null.
- All map and token coordinates use cells, not pixels.
- Assets must be prepared before finalization; D1 changes become visible together.
- A retry with the same canonical manifest and idempotency key resumes the same job.
- A changed manifest requires a new revision and idempotency key.
