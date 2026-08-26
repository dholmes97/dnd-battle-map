import assert from "node:assert/strict";
import test from "node:test";
import {
  cookieValue,
  isLocalAuthRequest,
  normalizeLoginEmail,
  safeReturnTo,
} from "../shared/auth-domain.ts";
import { verifyGoogleIdToken } from "../worker/auth.ts";

test("authentication input helpers normalize invited emails, cookies, and return paths", () => {
  assert.equal(normalizeLoginEmail("  DHolmes97@GMAIL.COM "), "dholmes97@gmail.com");
  assert.equal(normalizeLoginEmail("not-an-email"), "");
  assert.equal(cookieValue("first=one; dnd_session=abc_def-123; last=three", "dnd_session"), "abc_def-123");
  assert.equal(safeReturnTo("/campaigns?open=one"), "/campaigns?open=one");
  assert.equal(safeReturnTo("//attacker.example"), "/");
  assert.equal(safeReturnTo("https://attacker.example"), "/");
  assert.equal(isLocalAuthRequest(new Request("http://localhost:3000/")), true);
  assert.equal(isLocalAuthRequest(new Request("https://dnd.fridaylunchcrew.com/")), false);
});

test("Google ID tokens require a valid signature, audience, nonce, expiry, and verified email", async () => {
  const keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  publicKey.kid = "test-key";
  const now = 1_800_000_000_000;
  const claims = {
    iss: "https://accounts.google.com",
    aud: "client-id",
    sub: "google-subject-123",
    email: "DHolmes97@gmail.com",
    email_verified: true,
    nonce: "expected-nonce",
    iat: Math.floor(now / 1_000) - 5,
    exp: Math.floor(now / 1_000) + 300,
  };
  const token = await signedToken(keys.privateKey, claims);
  assert.deepEqual(
    await verifyGoogleIdToken(token, "client-id", "expected-nonce", now, async () => [publicKey]),
    { sub: "google-subject-123", email: "dholmes97@gmail.com" },
  );
  assert.equal(await verifyGoogleIdToken(token, "wrong-client", "expected-nonce", now, async () => [publicKey]), null);
  assert.equal(await verifyGoogleIdToken(token, "client-id", "wrong-nonce", now, async () => [publicKey]), null);
  const unverified = await signedToken(keys.privateKey, { ...claims, email_verified: false });
  assert.equal(await verifyGoogleIdToken(unverified, "client-id", "expected-nonce", now, async () => [publicKey]), null);
  const expired = await signedToken(keys.privateKey, { ...claims, exp: Math.floor(now / 1_000) - 1 });
  assert.equal(await verifyGoogleIdToken(expired, "client-id", "expected-nonce", now, async () => [publicKey]), null);
});

async function signedToken(privateKey, claims) {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" }));
  const payload = base64Url(JSON.stringify(claims));
  const content = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(content));
  return `${content}.${base64Url(new Uint8Array(signature))}`;
}

function base64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes).toString("base64url");
}
