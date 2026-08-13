# Battle Map Architecture

The application uses a lightweight ports-and-adapters (hexagonal) boundary. The goal is not a framework of abstractions; it is to make deterministic battle-map decisions executable without React, the browser, HTTP, Workers, or D1.

## Domain core

Framework-free, strictly typed modules live in `shared/`. They accept plain data,
return plain data, and have direct Node unit tests.

- `contracts.ts`: the one transport shape for encounter state and the typed command registry shared by both adapters.
- `battle-map-policies.ts`: movement authorization and stable map-scene identity.
- `battle-map-geometry.ts`: token bounds, distance, drawing hit-testing, and viewport navigation.
- `initiative-domain.ts`: roster grouping, initiative groups, and turn transitions.
- `map-workshop-domain.ts`: map-thumbnail paths, grid snapping, and note hit-testing.
- `encounter-domain.ts`: scenario codes, viewer-safe map projection, and history conflict messages.
- Existing health, token-control, action-history, map-package, spell-effect, creature, and full-scene modules follow the same boundary.

Domain modules must not import React, DOM APIs, Worker APIs, D1, R2, or networking code. If a rule needs the current time, randomness, persistence, or identity, pass that information in as data.

## Adapters

- `app/` is the React/browser adapter. It owns rendering, pointer events, canvas drawing, audio, local storage, and optimistic UI orchestration.
- `worker/` is the HTTP/persistence adapter. It owns request parsing, authorization lookup, D1/R2 queries, transactions, and response projection.

Adapters may translate framework-shaped records into domain-shaped data, invoke a domain function, and translate the result back. A decision used by both adapters belongs in `shared/`; it should not be reimplemented in each adapter.

## Testing convention

Every extracted rule gets a direct `node:test` contract in `tests/`. Tests should exercise behavior and edge cases. Source assertions in `rendered-html.test.mjs` are reserved for wiring, accessibility, and structural constraints that cannot be observed through a small domain input/output test.

The validation order is:

1. `npm test` for mandatory typechecking, the production build, and every
   automatically discovered direct/unit/source contract in `tests/*.test.mjs`.
2. `npm run lint` for adapter and test hygiene.
3. `BATTLE_MAP_BASE_URL=http://localhost:3000 npm run test:live` for the isolated
   `tests/live/` Worker/D1 and multi-client integration suite.
