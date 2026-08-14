# DM Email-to-Scenario Provisioning

## Status

The provisioning foundation and supervised workflow are implemented: typed
domain validation, dedicated secret-protected API, D1 job/audit records,
content-addressed R2 staging, atomic scenario finalization, a trusted local
client, DM briefing display, and the `add-dnd-creature` and
`provision-dnd-scenario-from-email` skills. Mailbox activation, production
secrets, and recurring processing remain intentionally disabled until the
Gmail label is configured and unattended operation is
explicitly approved.

## Product summary

Kevin, the Dungeon Master, or Dan, the application owner, should be able to describe a scenario in an email
and receive a ready-to-test scenario in the deployed D&D Battle Map application.
The request may include a new base map, a map preset, fog-of-war preparation,
creatures, starting token placement, handouts, DM notes, and scenario settings.
Kevin should also be able to reply in the same email thread with revisions.

The system should turn the natural-language request into a validated,
declarative scenario manifest; generate any required assets; safely provision
the resulting content through a purpose-built production API; verify the
result; and reply with a concise completion report or clarification request.

Email is an intake and status surface. It is not a general-purpose remote shell,
a way to request arbitrary code changes, or a substitute for authorization at
the production API boundary.

## Goals

1. Let the trusted DM go from an emailed idea to a complete, ready-to-test
   scenario without needing access to Codex or the Map Workshop.
2. Generate cohesive high-resolution full-scene maps with the same map-making
   workflow and quality standards used elsewhere in this project.
3. Generate complete image handouts, including their embedded text, with
   ImageGen.
4. Prepare map presets, fog settings, vision geometry, scenario settings,
   handouts, creatures, and token placements as one coherent job.
5. Expand the durable creature catalog when a requested creature is missing,
   including placement metadata and original token art.
6. Support safe, idempotent revisions through follow-up messages in the same
   email thread.
7. Make normal scenario provisioning safe enough that it does not require a
   full D1/R2 production backup before every job.
8. Preserve the existing lightweight hexagonal architecture and server-
   authoritative production data model.

## Non-goals

- General AI chat inside the deployed battle-map application.
- Arbitrary shell commands, SQL, file paths, URLs, or code supplied by email.
- Automatic implementation or deployment of new application features requested
  in an email.
- Automatic combat balancing, encounter difficulty guarantees, or rules
  adjudication unless those are separately specified in a future requirement.
- Starting combat or sending live chat messages to players as part of scenario
  provisioning.
- Replacing the Map Workshop or the DM's ability to make final adjustments.
- Restoring the retired fragmented-map, terrain-tile, or scene-sticker workflows.

## Actors and trust boundaries

### Dungeon Master

- Kevin is the only initially authorized request sender.
- Authorization must use the normalized email address, not the display name.
- The authorized address must be configuration, not a hard-coded personal
  address committed to the repository.

### Mailbox owner

- The first version may use the owner's already connected Gmail account through
  OAuth. No mailbox password is stored or shared.
- The automation must search only a dedicated Gmail label and the authorized
  sender. It must not scan or summarize unrelated personal mail.
- A dedicated scenario-provisioning mailbox may replace the personal mailbox
  later without changing the job or provisioning contracts.

### Scheduled Codex task

- A scheduled task polls the bounded Gmail query and invokes a dedicated
  scenario-email skill.
- The task may use the local project, trusted project scripts, Gmail, ImageGen,
  web research, and the scenario-provisioning API.
- While the scheduled task depends on local project files, the Mac must remain
  powered on and the Codex desktop app must be running.
- A future server-hosted Gmail push/webhook intake may remove that dependency,
  but it is not required for the first release.

### Production provisioning API

- The API is the only path by which the email workflow changes production
  scenario, preset, handout, map, token, or creature data.
- The API accepts a versioned declarative manifest and prepared bounded assets.
  It never accepts executable code, SQL, shell commands, or arbitrary storage
  keys from the email.
- The API uses a dedicated `SCENARIO_PROVISIONING_TOKEN`, stored as a production
  secret and separate from participant sessions, `CATALOG_IMPORT_TOKEN`, and
  `PRODUCTION_BACKUP_TOKEN`.
- Possession of the selectable accountless DM role must not authorize this API.

## Skill contracts and ownership

The automation should compose named skills instead of copying their reusable
procedures into this feature specification. A skill is the authoritative home
for how its specialized work is performed; this document owns the product
outcome, trust boundaries, production API contract, and acceptance criteria.

### Existing skills

- **`create-dnd-battle-map`** is authoritative for translating a scene request
  into a scale-correct cohesive base map, including map dimensions, source
  resolution, aspect ratio, square-cell geometry, generation, map QA, package
  integration, and local validation. This feature requires an accepted map
  package from that skill and does not restate its internal map-making rules.
- **`imagegen`** is authoritative for general image-generation mechanics used
  by handouts and creature art, including its documented in-image text,
  reference-image, validation, iteration, transparency, and file-handling
  workflows.
- **`gmail:gmail`** is authoritative for Gmail search, thread reading, replies,
  and label operations. This feature still owns the narrower sender allowlist,
  request-label, idempotency, and reply-policy requirements because those are
  security and product behavior rather than Gmail mechanics.

### Skills required before unattended operation

- The project-specific **`add-dnd-creature`** skill owns catalog matching, supplied-stat precedence,
  rules research, provenance capture, creature-art production, catalog
  validation, and bounded import procedure. The current creature catalog schema
  and importer remain the authoritative data and write contracts.
- The project-specific **`provision-dnd-scenario-from-email`** orchestration
  skill invokes the Gmail, map-making, ImageGen, and creature skills; builds
  the typed manifest; calls only the purpose-built provisioning API; verifies
  the result; and sends the bounded
  status reply.

Both skills must remain valid before unattended processing is enabled. Their
procedures should not be duplicated back into this requirements document.

## User experience

### New scenario request

A typical email subject is:

```text
D&D Scenario: The Sunken Chapel
```

The body may remain natural language. A rigid form is not required. Helpful
information includes:

- Scenario and optional preset names.
- Desired map dimensions and environment.
- A detailed map description, important landmarks, entrances, doors, hazards,
  and lighting.
- Fog mode: no fog, DM-controlled shared fog, or dynamic player vision.
- Creatures, approximate positions, and any custom statistics.
- Handout descriptions and exact wording when text matters.
- DM-only notes or clues.
- Strict movement or other supported scenario settings.
- Important requirements and things to avoid.
- Optional safe image attachments to use as visual references.

The system should accept a well-written free-form request and should not force
Kevin to learn an API schema. The resulting manifest is an internal contract.

### Revision request

Kevin replies in the original thread, for example:

```text
Keep the map. Replace the invitation with a shorter version, change fog to
DM-controlled, and add two vampire spawn near the organ.
```

The same Gmail thread remains associated with the same provisioning job and
scenario code. A new thread must name the target scenario unambiguously before
it can modify existing content.

### Email responses

The automation may send only bounded replies to the authorized sender in the
matching request thread.

It supports four response types:

1. **Received**: the request was accepted and assigned a job.
2. **Needs clarification**: one or more choices would materially change the
   result, so no scenario is finalized until Kevin answers.
3. **Ready to test**: the scenario is provisioned and verified.
4. **Failed safely**: the job could not finish and no partial scenario became
   visible.

A ready response must summarize:

- Scenario name and stable scenario code.
- Base map name, dimensions, and resolution.
- Preset name and fog mode.
- Handouts created.
- Creatures placed.
- Any new catalog creatures and the provenance of researched defaults.
- Warnings or items the DM should visually review.
- A link to the deployed battle-map application.

## Intake requirements

1. Gmail messages are candidates only when all of the following are true:
   - They carry the dedicated scenario-request label.
   - Their normalized sender is on the configured allowlist.
   - Their message ID has not already produced the same job revision.
2. `is:unread` may be used as a convenience filter, but unread state must not be
   the idempotency mechanism.
3. Each accepted message receives a stable job ID and revision number.
4. Message and thread identifiers are job correlation data only; they must not
   be exposed in normal user-facing replies or logs.
5. Supported attachments are bounded PNG, JPEG, and WebP reference images.
   Executables, archives, documents with active content, and unknown types are
   rejected rather than opened.
6. Links in email are untrusted. The system must not sign in, download private
   data, or follow a link merely because the email asks it to.
7. Email text may describe desired content but cannot choose commands, scripts,
   filesystem paths, environment variables, storage keys, or deployment steps.
8. Requests for unsupported application behavior become clarification or
   backlog notes. They never trigger autonomous code changes.

## Scenario manifest

Every accepted request is normalized into a versioned manifest before asset
generation or production writes begin.

The manifest must contain or derive:

- Schema version.
- Job ID, revision, and idempotency key.
- Operation: create a new scenario or revise an identified scenario.
- Scenario name, stable code when revising, and DM briefing/description.
- Base map specification:
  - Name.
  - Grid width and height.
  - Feet per cell.
  - Visual description and negative constraints.
- Preset name and description.
- Fog specification:
  - Mode.
  - Shared polygon when applicable.
  - Vision walls, vision doors, and round blockers when applicable.
- Supported scenario settings, including strict movement when supplied.
- Handout specifications, including exact text, composition, aspect ratio, and
  intended audience or later use.
- Creature specifications and starting placements.
- Party-copy behavior and any requested deviations supported by the product.
- DM-only labels and notes.
- Explicit assumptions and review warnings.

Manifest validation must be framework-free and directly unit tested. Invalid or
materially ambiguous manifests do not reach the provisioning API.

## Base-map outcome

When a request needs a new map, the orchestrator must invoke
`create-dnd-battle-map` and receive a map package that the skill has accepted.
The resulting map must depict the requested environment and important
landmarks well enough to prepare tokens and fog geometry. This feature adds no
second map-generation specification or validation path.

The base map receives a durable base-map name. The prepared configuration
receives a separate preset name.

## Fog and vision requirements

The three existing fog modes are supported:

### No fog

- The entire map is visible.
- This is the safe default when the request does not specify a fog mode.

### DM-controlled shared fog

- The initial hidden polygon defaults to the complete map with corners plus one
  midpoint on each side.
- Email instructions may request a different starting revealed area.
- The DM can reshape the polygon normally during play.

### Dynamic player vision

- The workflow may infer free-angle vision walls, doors, and round blockers from
  the generated map and scenario description.
- Doors must be represented as doors rather than permanent walls when their
  gameplay state is expected to change.
- Columns, trees, boulders, statues, and similar round obstructions use round
  blockers when appropriate.
- Geometry is validated to map bounds and complexity limits.
- The ready email must explicitly flag generated dynamic-vision geometry for DM
  review before play. Review is not required before the scenario can be created
  and tested.

## Handout generation requirements

1. Use the `imagegen` skill as the authoritative generation and validation
   workflow.
2. The requested deliverable is the complete finished handout, including its
   embedded text. Programmatic typesetting is not the default merely because a
   handout contains prose.
3. Handouts may include invitations, letters, clues, maps, portraits, heraldry,
   objects, murals, and other scenario materials.
4. Prepared display and thumbnail assets follow the existing bounded handout
   pipeline, prefer WebP with a JPEG fallback, and store derived bytes in R2 and
   metadata in D1.
5. Handouts are loaded into the scenario's handout library but are not sent to
   players or marked as read during provisioning.
6. The DM chooses when and to whom a prepared handout is sent during play unless
   a separate supported delivery feature is explicitly added later.
7. Replacing a handout stages and validates the new asset before atomically
   switching the durable metadata reference.

## Creature-library outcomes

### Catalog lookup

1. The future `add-dnd-creature` skill owns catalog matching and duplicate
   prevention.
2. Reuse an existing catalog record when it represents the requested creature
   and rules variant.
3. A missing creature must become one durable reusable catalog entry rather
   than a scenario-only substitute.

### Statistics

1. DM-supplied statistics take precedence when they are explicit.
2. A new record must satisfy the current placement-ready creature-catalog
   contract before the scenario can use it. This document does not copy that
   evolving field list.
3. When the DM supplies only some values, preserve those values and research the
   missing defaults. When none are supplied, research reasonable defaults for
   the configured rules edition.
4. Retain source URLs and a short provenance note in the provisioning job. List
   the sources or clearly identify derived defaults in the ready email.
5. If the creature name maps to materially different editions or variants and
   the configured campaign rules do not resolve the choice, ask Kevin rather
   than silently choosing.
6. Unique NPCs or homebrew names without supplied statistics require
   clarification unless the email explicitly authorizes reasonable generated
   defaults.

### Creature art and storage

1. The `add-dnd-creature` skill uses the `imagegen` skill when suitable art is
   not already in the catalog. The creature skill owns token-art requirements;
   generic ImageGen mechanics remain in `imagegen`.
2. Store original and thumbnail bytes in R2 and searchable metadata in D1 using
   the existing lazy creature-library model.
3. Scenario placement must initialize current and maximum HP from the resolved
   catalog default unless the email explicitly supplies encounter-specific HP.
4. Existing customized catalog data must never be overwritten by a researched
   default.
5. Catalog creation remains secret-protected and processes new creatures in
   batches of at most ten. A request containing more than ten missing creatures
   may be completed through sequential bounded batches under the same job.
6. A newly created catalog creature is immediately reusable by later scenario
   requests and visible in the creature palette.

## Scenario and preset requirements

1. A new scenario starts in setup with combat state, round, active turn,
   movement tracking, effects, completed-turn tracking, and history cleared.
2. The established player party is copied at full health unless the request
   explicitly specifies another supported starting state.
3. Scenario, base-map, and preset names remain distinct:
   - Base-map name identifies the generated artwork.
   - Preset name identifies the base map plus prepared fog, notes, and settings.
   - Scenario name identifies the playable encounter and its handouts/tokens.
4. Requested monsters and summons are placed within map bounds and use the
   resolved catalog defaults.
5. Semantic positions such as "near the organ" may be translated into map
   coordinates using the generated map, but uncertain placement must be listed
   as a DM review item.
6. Scenario descriptions and DM briefings are durable and visible to the DM.
7. The scenario does not appear in the join chooser until finalization succeeds.
8. A revision changes only the resources and settings named or necessarily
   affected by the request. It must not reset unrelated combat or scenario data
   unless Kevin explicitly requests a reset and the API supports it safely.

## Safe production provisioning API

### API shape

The exact routes may change during implementation, but the capability must be
purpose-specific. A representative contract is:

```text
POST /api/scenario-provisioning/jobs
GET  /api/scenario-provisioning/jobs/{jobId}
PATCH /api/scenario-provisioning/jobs/{jobId}
PUT   /api/scenario-provisioning/jobs/{jobId}/assets/{assetId}
POST /api/scenario-provisioning/jobs/{jobId}/finalize
```

The API must not expose generic SQL, arbitrary D1 table mutation, arbitrary R2
keys, shell execution, or the application's general command dispatcher.

### Authentication and authorization

1. Require `SCENARIO_PROVISIONING_TOKEN` and fail closed when it is absent.
2. Require the normalized manifest sender to exactly match an address in the
   separately configured comma-separated `SCENARIO_PROVISIONING_SENDERS`
   allowlist. The initial production allowlist contains `uncletev@gmail.com`
   (Kevin) and `dholmes97@gmail.com` (Dan).
3. Use constant-time credential comparison where supported by the runtime.
4. Rate-limit new jobs and bound manifest and asset sizes.
5. The token grants only scenario-provisioning capabilities. It cannot call the
   backup endpoint, catalog importer outside the job, or participant APIs as a
   user.
6. Never commit the token, embed it in a remote URL, include it in email, or
   write it into job logs.

### Idempotency

1. Every revision carries an idempotency key derived from the authorized
   mailbox, Gmail message identity, and manifest revision.
2. Retrying the same accepted email returns the same job/result and does not
   create duplicate scenarios, handouts, catalog records, tokens, or R2 objects.
3. Concurrent requests for the same revision serialize or return the existing
   in-progress job.
4. A revised email creates a new revision linked to the prior completed job.

### Atomicity and storage safety

1. Upload generated bytes to job-scoped, immutable, content-addressed R2 staging
   keys before any scenario becomes visible.
2. Validate image formats, dimensions, byte limits, map metadata, handout
   metadata, creature records, fog geometry, and token bounds before finalization.
3. Finalize all D1 metadata and scenario records in one transaction whenever
   D1 supports the affected operations.
4. The committed D1 references are the visibility boundary. A failed job must
   not expose a partially prepared scenario in the join chooser.
5. If R2 succeeds and D1 finalization fails, the retry reuses the same
   content-addressed objects. Unreferenced staged objects are eligible for
   bounded garbage collection after a retention period.
6. For revisions, stage new objects first, then atomically swap metadata
   references. Superseded objects are deleted only after the new revision is
   committed and a retention policy permits cleanup.
7. The API must never delete or overwrite unrelated scenarios, presets,
   handouts, creatures, or assets.

### Production backup policy

Normal scenario creation and revision must **not** invoke the full production
backup command before each API job. A safe production application is expected
to perform bounded writes through validated, transactional, idempotent APIs.

Production backups remain a separate operational control for:

- Schema migrations.
- Deployments that materially change persistence behavior or stored-asset
  interpretation.
- Bulk destructive maintenance.
- Manual disaster-recovery snapshots.
- An independent scheduled backup cadence if desired.

The scenario API's normal safety comes from scoped authorization, validation,
idempotency, immutable asset staging, D1 transactions, audit records, and
non-destructive revision semantics—not from taking a snapshot before every
request.

## Job lifecycle

A durable provisioning job uses these states:

```text
received
parsing
needs_clarification
generating
researching_creatures
validating
staging
finalizing
ready
failed
```

Requirements:

1. State transitions are monotonic except for an explicit retry from `failed`
   or a new revision after `needs_clarification`/`ready`.
2. Each phase records timestamps and a bounded human-readable summary.
3. Failures record a safe error category without credentials or private mailbox
   contents.
4. A failed or timed-out job can be retried without duplicating visible data.
5. The email reply is sent only after the corresponding durable state is saved.

## Hexagonal architecture

The feature follows the project's lightweight ports-and-adapters preference.

### Framework-free core

A shared domain module owns deterministic decisions such as:

- Manifest validation and defaults.
- Sender/job idempotency keys.
- Scenario/preset/base-map naming rules.
- Create-versus-revise policy.
- Placement-ready creature validation through the current shared catalog
  contract.
- Fog defaults and geometry bounds.
- Job-state transitions.
- Clarification reasons and safe completion summaries.

It accepts plain typed data and has direct unit tests. It does not import Gmail,
React, browser APIs, ImageGen, Worker APIs, D1, R2, or network clients.

### Ports

Narrow ports represent:

- Mail search/read/reply/label operations.
- Image generation.
- Creature-stat research.
- Prepared-asset storage.
- Provisioning-job persistence.
- Scenario/preset/handout/creature persistence.
- Clock and stable ID generation.

### Adapters

- Gmail and the scheduled Codex task are intake/orchestration adapters.
- ImageGen and web research are generation/research adapters.
- The Worker is the authenticated HTTP adapter.
- D1 and R2 adapters implement the persistence ports.
- A trusted local provisioning client translates generated artifacts into the
  versioned API request.

The orchestrator may perform a long sequence of work, but production mutations
remain behind the narrow API and repository ports.

## Clarification policy

The system should make reversible, low-risk assumptions and report them. It
must ask Kevin before proceeding when a missing answer would materially change
the scenario, including:

- Ambiguous map size or orientation that changes room layout.
- Multiple materially different creature rules variants.
- An unclear target scenario for a revision.
- Contradictory fog requirements.
- A request to overwrite or delete existing content.
- A request requiring an application feature that does not exist.
- Unique/homebrew creatures without statistics when generated defaults were not
  authorized.

Clarification stays in the same email thread. A reply produces a new job
revision rather than mutating the original request record.

## Operational limits

Initial limits should be configurable and enforced at both orchestration and API
boundaries. They should include:

- Maximum email and manifest size.
- Maximum reference attachment count and bytes.
- Maximum map dimensions and pixels.
- Maximum handout count and per-handout bytes.
- Maximum generated creatures per job and batches of at most ten.
- Maximum token count.
- Maximum fog vertices, vision segments, doors, and round blockers.
- Maximum retries and total job duration.
- Maximum concurrent provisioning jobs.

A request over a limit produces a clarification response rather than silently
dropping content.

## Performance and service expectations

- Poll authorized scenario mail every 30 minutes by default.
- Send a received or clarification response within one successful poll cycle.
- Complete a typical map plus several handouts within two hours, subject to
  ImageGen availability and usage limits.
- Process only one production-finalization step at a time initially.
- Generation and research may run concurrently when they do not write the same
  artifact or exceed service limits.
- Ordinary battle-map traffic and live synchronization must remain unaffected by
  provisioning work.

## Audit and observability

1. Record the job ID, revision, authorized sender hash/reference, scenario code,
   manifest version, created resource IDs, timestamps, and outcome.
2. Do not store mailbox OAuth tokens, provisioning tokens, full unrelated email
   content, or secret headers in D1 logs.
3. Record asset byte counts and content hashes for retry and cleanup.
4. Track created versus reused catalog creatures.
5. Track generation/research warnings surfaced to the DM.
6. Provide enough information to explain whether a failed job changed any
   visible production state.

## Testing requirements

### Domain tests

- Manifest defaults and validation.
- New versus revision policy.
- Sender normalization and idempotency keys.
- Job-state transitions.
- Fog defaults and geometry limits.
- Required creature metadata and supplied-stat precedence.
- Clarification decisions.

### API and repository tests

- Missing or incorrect provisioning token is rejected.
- Selectable DM sessions cannot call the provisioning API.
- Duplicate idempotency keys return the same result.
- D1 finalization is atomic.
- R2 failure leaves no visible scenario.
- D1 failure leaves only reclaimable staged assets.
- Revision swaps only requested metadata references.
- Existing customized catalog data is preserved.
- More than ten missing creatures are split into bounded sequential batches.
- Oversized maps, handouts, attachments, and geometry are rejected.

### Email adapter tests

- Only the dedicated label and authorized sender are processed.
- Display-name spoofing is rejected.
- A processed message is not processed twice even if it remains unread.
- A same-thread reply targets the correct scenario and creates a new revision.
- An unrelated thread cannot revise a scenario without a stable identifier.
- Replies go only to the authorized sender in the request thread.
- Prompt-injection attempts cannot select scripts, commands, files, URLs, or API
  capabilities.

### Asset and content tests

- Generated maps pass the current `create-dnd-battle-map` acceptance checks.
- Complete handouts, including embedded text, pass the current `imagegen`
  inspection workflow and the battle-map handout upload contract.
- Handout display and thumbnail variants meet storage limits.
- New creature art and thumbnails load through the lazy catalog path.
- Resolved creature statistics initialize the placed token correctly.
- Dynamic vision geometry is bounded and editable in Map Workshop.

### End-to-end tests

1. A new authorized email creates one ready scenario with a generated map,
   preset, handouts, party, and requested monsters.
2. Reprocessing the same email creates nothing new.
3. A missing catalog creature is researched, illustrated, cataloged, and placed.
4. A revision replaces one handout without changing the map or unrelated data.
5. A failed finalization sends a safe failure response and leaves no partial
   joinable scenario.
6. Unauthorized mail is ignored and cannot reach production provisioning.

## Acceptance criteria

The feature is ready when all of the following are true:

1. Kevin can send one natural-language email and, without using Codex or Map
   Workshop, find a correctly named ready-to-test scenario in the production
   join chooser.
2. The scenario contains the generated cohesive base map, saved preset,
   requested fog mode/geometry, full-health party, requested tokens, DM notes,
   and prepared handouts.
3. Complete ImageGen handouts, including embedded text, render correctly in the
   existing Fit and Actual-size viewer modes.
4. Missing creatures are added once to the durable creature palette with
   placement-ready statistics and generated art, then reused by future jobs.
5. Retrying or polling the same email cannot duplicate any production record or
   asset.
6. A failure at any phase cannot expose a partially prepared scenario.
7. A same-thread revision updates only the requested parts and reports what
   changed.
8. Unauthorized senders, arbitrary commands, and unsupported feature requests
   cannot mutate production.
9. Normal successful provisioning does not take or require a full production
   backup.
10. The full unit, component, integration, security-boundary, and browser
    verification suites pass.

## Rollout plan

### Phase 1: Provisioning foundation

- Define the typed manifest and framework-free validation domain.
- Create and validate the project-specific `add-dnd-creature` and
  `provision-dnd-scenario-from-email` skills with non-overlapping ownership.
- Add job persistence, the secret-protected purpose-specific API, R2 staging,
  idempotency, and atomic finalization.
- Add a trusted manual client that provisions a fixture manifest without Gmail.
- Verify the complete API locally and with a disposable production scenario.

### Phase 2: Supervised email pilot

- Connect the validated `provision-dnd-scenario-from-email` skill to the bounded
  Gmail label/sender query.
- Process several real Kevin requests only when manually triggered.
- Review map, handout text, creature research, fog geometry, email summaries,
  retries, and revisions.

### Phase 3: Scheduled operation

- Create the scheduled Codex task at the chosen polling interval.
- Allow automatic received, clarification, ready, and failure replies within the
  authorized thread.
- Review the first several unattended runs and tune limits and prompts.

### Phase 4: Dedicated mailbox and hosted intake

- Move from the personal mailbox to a dedicated OAuth-connected account.
- Optionally replace polling with Gmail push/webhook intake.
- Keep the manifest, job, API, idempotency, and security contracts unchanged.

## Decisions captured from product review

1. **No per-job production backup.** Normal content provisioning must be safe by
   API design. Backups remain independent operational/disaster-recovery controls.
2. **ImageGen renders complete handouts.** Embedded text is part of the finished
   image by default; execution follows the `imagegen` skill.
3. **Creature creation is in scope.** A missing requested creature becomes a
   placement-ready reusable catalog entry and can be placed in the scenario;
   execution follows the future `add-dnd-creature` skill.
4. **Email remains declarative.** It cannot run arbitrary commands or initiate
   autonomous application feature development.

## Open product decisions

These do not block documenting the feature but should be resolved before the
scheduled pilot:

- The Gmail label name.
- The campaign's default D&D edition/rules source for creature research.
- The final polling interval and acceptable monthly ImageGen usage.
- Default map dimensions when omitted.
- Retention period for failed-job staging assets and superseded revision assets.
- Whether ready scenarios should be immediately visible to all four trusted
  identities or remain DM-only until Kevin marks them ready.
