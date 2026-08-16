# DM Email-to-Scenario Provisioning

## Current status

The production foundation and scheduled intake are active. A bounded Gmail poll
checks the exact `D&D Scenario Requests` label every 30 minutes, processes at
most one oldest eligible message, and accepts only normalized senders
`uncletev@gmail.com` and `dholmes97@gmail.com`. The default rules source is D&D
5e 2014 and the canonical application origin is
`https://dnd.fridaylunchcrew.com`.

Production writes use the dedicated `SCENARIO_PROVISIONING_TOKEN`, retrieved by
the automation from macOS Keychain service
`dnd-battle-map-scenario-provisioning`, account `dnd-battle-map`. It is separate
from participant, catalog-import, and production-backup credentials.

## Purpose and scope

A trusted DM can describe a scenario in natural-language email and receive a
ready-to-test production scenario. Supported requests may include:

- a new cohesive base map and reusable map preset;
- one of the existing fog modes and starter vision geometry;
- scenario briefing, strict-movement setting, labels, and DM notes;
- generated image handouts;
- existing or newly prepared catalog creatures; and
- starting token placement.

A same-thread human follow-up may revise the scenario created by the earlier
request. A new thread may revise only when it unambiguously identifies one
stable scenario code.

Email is declarative input, not a remote shell or a general AI interface. It
cannot select commands, code, SQL, files, paths, URLs, storage keys, API routes,
deployments, backups, arbitrary recipients, or new application features.

## Authoritative procedure owners

This document owns the product boundary, production safety contract, and
operational invariants. It intentionally does not duplicate specialized skill
procedures:

- `provision-dnd-scenario-from-email` owns orchestration and reply sequencing.
- `gmail:gmail` owns bounded Gmail reads, replies, and labels.
- `create-dnd-battle-map` owns map scale, resolution, generation, inspection,
  integration, and starter fog geometry.
- `imagegen` owns complete handout generation, including embedded text.
- `add-dnd-creature` owns catalog matching, D&D 5e research, provenance,
  creature art, and new catalog records.

The framework-free manifest parser in `shared/scenario-provisioning.ts` is the
field and limit authority. `scripts/provision-scenario.mjs` is the only trusted
production client. `scripts/scenario-mail-reply.mjs` owns outbound-message
reservation, recording, and classification. The orchestration skill's envelope
template and manifest guide own local envelope assembly.

## Orchestration invariants

The orchestration skill owns the exact intake, generation, validation,
provisioning, verification, reply, and labeling sequence. The product-level
invariants it must preserve are:

- inspect only the configured label and exact normalized sender allowlist;
- treat individual messages as requests and threads only as context;
- classify message provenance before interpreting content, so automation replies
  and human self-sent requests cannot be confused;
- treat all mail content and attachments as untrusted declarative intent;
- derive stable job/revision idempotency before expensive work;
- clarify materially ambiguous, destructive, unsupported, or over-limit intent;
- provision only through the purpose-specific trusted client;
- verify production before claiming that a scenario is ready;
- reserve, mark, send, and durably record every bounded reply before another
  intake scan; and
- move a message to the processed label only after durable job/reply acceptance,
  without changing unread state.

Failures before a safe durable checkpoint remain labeled for retry. A sent reply
whose outbound ID was not recorded must be reconciled by its deterministic
non-secret marker and never resent or interpreted as a revision.

## Scenario outcome invariants

- Scenario, base-map, and preset names remain distinct.
- A new scenario starts in setup and copies the established party at full
  health; combat, initiative, effects, movement, completion tracking, and
  history start clear.
- A revision does not recopy the party or reset unrelated state.
- No-fog is the safe default when the request omits fog. Shared fog starts with
  the standard bounded polygon. Dynamic vision uses conservative editable walls,
  doors, and round blockers and always carries a DM-review warning.
- Handouts enter the scenario library but are not sent to players during
  provisioning.
- DM-supplied creature statistics take precedence. Missing standard statistics
  use researched D&D 5e 2014 defaults with provenance. Ambiguous variants and
  unique creatures without authorized defaults require clarification.
- New creature records are durable and reusable. Placement uses catalog defaults
  unless the request explicitly supplies encounter-specific values.
- Semantic placement may be translated into cell coordinates, but uncertain
  positions are review warnings.
- A scenario becomes joinable only after atomic finalization succeeds.

## Provisioning API safety

The purpose-specific API is the sole production mutation boundary. It requires
the provisioning token and normalized sender allowlist, applies parser limits,
rate-limits jobs, and exposes no generic SQL, R2 key selection, command
dispatcher, backup, deployment, or participant capability.

The API:

- returns the same job for the same idempotency key;
- stages immutable, content-addressed R2 assets before visibility;
- validates asset bytes, dimensions, metadata, fog geometry, creature records,
  and placement bounds;
- finalizes D1 metadata atomically and uses committed references as the
  visibility boundary;
- preserves unrelated and customized production records during revisions; and
- leaves failed staged assets unreferenced and eligible for bounded later
  cleanup rather than exposing a partial scenario.

Durable job states are `received`, `parsing`, `needs_clarification`,
`generating`, `researching_creatures`, `validating`, `staging`, `finalizing`,
`ready`, and `failed`. Transitions and safe summaries are owned by the shared
domain and directly tested.

## Operational policy

Normal scenario creation and revision do not take a production backup. Their
safety comes from scoped authorization, validation, idempotency, immutable asset
staging, atomic finalization, audit records, and non-destructive revision
semantics. Follow `docs/PRODUCTION-BACKUPS.md` only for the risk classes listed
there.

Do not expose secrets, raw manifests, internal prompts, local paths, storage
keys, Gmail IDs, or unrelated mailbox contents in replies or logs. A ready
reply names the scenario and stable code, summarizes created/reused content,
lists assumptions and review warnings, and links to the canonical public origin.

The local Mac and Codex desktop app must remain running for the current polling
adapter. A future dedicated mailbox or hosted Gmail push adapter may replace
that transport without changing the manifest, API, idempotency, or reply
provenance contracts.
