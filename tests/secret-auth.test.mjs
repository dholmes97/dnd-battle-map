import assert from "node:assert/strict";
import test from "node:test";
import { bearerSecretMatches, emailSenderAllowed, parseEmailAllowlist } from "../shared/secret-auth.ts";

const secret = "a-strong-secret-with-at-least-32-characters";

test("dedicated bearer secrets fail closed and compare exact values", () => {
  assert.equal(bearerSecretMatches(`Bearer ${secret}`, secret), true);
  assert.equal(bearerSecretMatches(secret, secret), false);
  assert.equal(bearerSecretMatches(`Bearer ${secret}x`, secret), false);
  assert.equal(bearerSecretMatches("Bearer short", "short"), false);
  assert.equal(bearerSecretMatches(null, undefined), false);
});

test("email allowlists normalize exact addresses and fail closed when malformed", () => {
  const allowlist = parseEmailAllowlist(" UNCLETEV@gmail.com, dholmes97@gmail.com ");
  assert.deepEqual(allowlist, ["uncletev@gmail.com", "dholmes97@gmail.com"]);
  assert.equal(emailSenderAllowed("UncleTev@gmail.com", allowlist), true);
  assert.equal(emailSenderAllowed("dholmes97@gmail.com", allowlist), true);
  assert.equal(emailSenderAllowed("attacker@gmail.com", allowlist), false);
  assert.deepEqual(parseEmailAllowlist("uncletev@gmail.com,"), []);
  assert.deepEqual(parseEmailAllowlist("not-an-email"), []);
  assert.deepEqual(parseEmailAllowlist(undefined), []);
});
