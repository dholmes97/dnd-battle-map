import assert from "node:assert/strict";
import test from "node:test";

import { indexRowsByKey } from "../shared/projection-index.ts";
import {
  cleanCorrelationId,
  correlationSampleSelected,
  errorReference,
  requestOutcome,
} from "../shared/request-correlation.ts";
import {
  MAX_EFFECTS_PER_ENCOUNTER,
  MAX_TOKENS_PER_ENCOUNTER,
} from "../shared/resource-limits.ts";

test("maximum-size effect projection indexes every row exactly once", () => {
  let visits = 0;
  const effects = Array.from({ length: MAX_EFFECTS_PER_ENCOUNTER }, (_, index) => ({
    id: `effect-${index}`,
    token_id: `token-${index % MAX_TOKENS_PER_ENCOUNTER}`,
  }));
  const indexed = indexRowsByKey(effects, (effect) => {
    visits += 1;
    return effect.token_id;
  });

  assert.equal(visits, MAX_EFFECTS_PER_ENCOUNTER);
  assert.equal(indexed.size, MAX_TOKENS_PER_ENCOUNTER);
  assert.equal([...indexed.values()].reduce((total, rows) => total + rows.length, 0), MAX_EFFECTS_PER_ENCOUNTER);
  assert.deepEqual(indexed.get("token-0")?.map(({ id }) => id), ["effect-0", "effect-256", "effect-512", "effect-768"]);
});

test("request correlation accepts bounded opaque IDs and classifies outcomes", () => {
  assert.equal(cleanCorrelationId("client-operation:42"), "client-operation:42");
  assert.equal(cleanCorrelationId(" contains spaces "), null);
  assert.equal(cleanCorrelationId("x".repeat(65)), null);
  assert.equal(errorReference("12345678-abcd"), " Reference: 12345678.");
  assert.equal(errorReference("unsafe value"), "");
  assert.equal(requestOutcome(204), "success");
  assert.equal(requestOutcome(409), "conflict");
  assert.equal(requestOutcome(429), "rate_limited");
  assert.equal(requestOutcome(503), "server_error");
  assert.equal(correlationSampleSelected("stable-request", 32), correlationSampleSelected("stable-request", 32));
  assert.equal(correlationSampleSelected("anything", 1), true);
});
