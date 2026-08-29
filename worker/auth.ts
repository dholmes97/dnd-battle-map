import {
  AUTH_OAUTH_STATE_DURATION_MS,
  AUTH_SESSION_COOKIE,
  AUTH_SESSION_DURATION_MS,
  AUTH_STATE_COOKIE,
  cookieValue,
  isLocalAuthRequest,
  normalizeLoginEmail,
  safeReturnTo,
  type AuthenticatedIdentity,
} from "../shared/auth-domain.ts";
import { API_JSON_BODY_MAX_BYTES } from "../shared/resource-limits.ts";
import type { Env } from "./types.ts";
import { readBoundedJsonObject } from "./request-security.ts";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
const CANONICAL_PRODUCTION_ORIGIN = "https://dnd.fridaylunchcrew.com";
const GOOGLE_RESPONSE_MAX_BYTES = 64 * 1024;
const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1_000;

type GoogleIdClaims = {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  nonce?: unknown;
  exp?: unknown;
  iat?: unknown;
};

type AuthSessionRow = {
  id: string;
  display_name: string;
  login_email: string;
  can_create_campaigns: number;
  can_use_qa_sessions: number;
  last_seen_at: number;
};

type GoogleJsonWebKey = JsonWebKey & { kid?: string };

let cachedGoogleKeys: { expiresAt: number; keys: GoogleJsonWebKey[] } | null = null;

export async function handleAuthRequest(request: Request, env: Env, route: string): Promise<Response> {
  if (route === "session") return authSessionResponse(request, env);
  if (route === "dev-login") return devLogin(request, env);
  if (route === "logout") return logout(request, env);
  if (route === "google/start") return startGoogleLogin(request, env);
  if (route === "google/callback") return finishGoogleLogin(request, env);
  return json({ error: "Authentication route not found." }, { status: 404 });
}

export async function authenticatedIdentity(request: Request, env: Env): Promise<AuthenticatedIdentity | null> {
  const rawToken = cleanOpaqueToken(cookieValue(request.headers.get("cookie"), AUTH_SESSION_COOKIE));
  if (!rawToken) return null;
  const now = Date.now();
  const tokenHash = await sha256Hex(rawToken);
  const row = await env.DB.prepare(
    `SELECT i.id, i.display_name, i.login_email, i.can_create_campaigns, i.can_use_qa_sessions, s.last_seen_at
     FROM auth_sessions s
     JOIN identities i ON i.id = s.identity_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? LIMIT 1`,
  ).bind(tokenHash, now).first<AuthSessionRow>();
  if (!row) return null;
  if (row.last_seen_at <= now - SESSION_TOUCH_INTERVAL_MS) {
    await env.DB.prepare(
      "UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ? AND last_seen_at = ?",
    ).bind(now, tokenHash, row.last_seen_at).run();
  }
  return identityFromRow(row);
}

async function authSessionResponse(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const identity = await authenticatedIdentity(request, env);
  if (!identity) {
    return json({
      authenticated: false,
      googleConfigured: googleConfigured(env),
      devLoginAvailable: isLocalAuthRequest(request),
    }, { status: 401 });
  }
  return json({
    authenticated: true,
    identity,
    googleConfigured: googleConfigured(env),
    devLoginAvailable: isLocalAuthRequest(request),
  });
}

async function devLogin(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!isLocalAuthRequest(request)) return json({ error: "Development login is unavailable." }, { status: 404 });
  const body = await readBoundedJsonObject(request, API_JSON_BODY_MAX_BYTES);
  const identityId = cleanIdentifier(body.identityId);
  const row = await env.DB.prepare(
    `SELECT id, display_name, login_email, can_create_campaigns, can_use_qa_sessions, 0 AS last_seen_at
     FROM identities WHERE id = ? AND id NOT LIKE 'identity-combat-qa-%' LIMIT 1`,
  ).bind(identityId).first<AuthSessionRow>();
  if (!row) return json({ error: "That development identity is unavailable." }, { status: 404 });
  const issued = await issueSession(env, row.id, request);
  return json({ authenticated: true, identity: identityFromRow(row) }, {
    headers: { "set-cookie": sessionCookie(issued.rawToken, request, AUTH_SESSION_DURATION_MS) },
  });
}

async function logout(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const rawToken = cleanOpaqueToken(cookieValue(request.headers.get("cookie"), AUTH_SESSION_COOKIE));
  if (rawToken) {
    await env.DB.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .bind(Date.now(), await sha256Hex(rawToken)).run();
  }
  return json({ signedOut: true }, { headers: { "set-cookie": expiredCookie(AUTH_SESSION_COOKIE, request) } });
}

async function startGoogleLogin(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  if (!googleConfigured(env)) return json({ error: "Google sign-in has not been configured yet." }, { status: 503 });
  const now = Date.now();
  const url = new URL(request.url);
  const state = randomToken(32);
  const verifier = randomToken(48);
  const nonce = randomToken(32);
  const stateHash = await sha256Hex(state);
  const challenge = await sha256Base64Url(verifier);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_oauth_states WHERE expires_at <= ?").bind(now),
    env.DB.prepare(
      `INSERT INTO auth_oauth_states
       (state_hash, pkce_verifier, nonce, return_to, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(stateHash, verifier, nonce, safeReturnTo(url.searchParams.get("returnTo")), now, now + AUTH_OAUTH_STATE_DURATION_MS),
  ]);
  const authorization = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  authorization.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID!);
  authorization.searchParams.set("redirect_uri", googleCallbackUrl(request));
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", "openid email profile");
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("nonce", nonce);
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", "S256");
  authorization.searchParams.set("prompt", "select_account");
  return new Response(null, {
    status: 302,
    headers: {
      location: authorization.toString(),
      "cache-control": "no-store",
      "set-cookie": stateCookie(state, request, AUTH_OAUTH_STATE_DURATION_MS),
    },
  });
}

async function finishGoogleLogin(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  if (!googleConfigured(env)) return authRedirect(request, "/?authError=configuration", expiredCookie(AUTH_STATE_COOKIE, request));
  const url = new URL(request.url);
  const state = cleanOpaqueToken(url.searchParams.get("state"));
  const cookieState = cleanOpaqueToken(cookieValue(request.headers.get("cookie"), AUTH_STATE_COOKIE));
  const code = cleanAuthorizationCode(url.searchParams.get("code"));
  if (!state || !cookieState || !constantTimeEqual(state, cookieState) || !code || url.searchParams.has("error")) {
    return authRedirect(request, "/?authError=cancelled", expiredCookie(AUTH_STATE_COOKIE, request));
  }
  const stateHash = await sha256Hex(state);
  const now = Date.now();
  const pending = await env.DB.prepare(
    `DELETE FROM auth_oauth_states WHERE state_hash = ? AND expires_at > ?
     RETURNING pkce_verifier, nonce, return_to`,
  ).bind(stateHash, now).first<{ pkce_verifier: string; nonce: string; return_to: string }>();
  if (!pending) return authRedirect(request, "/?authError=expired", expiredCookie(AUTH_STATE_COOKIE, request));

  const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET!,
      code,
      code_verifier: pending.pkce_verifier,
      grant_type: "authorization_code",
      redirect_uri: googleCallbackUrl(request),
    }),
  });
  if (!tokenResponse.ok) return authRedirect(request, "/?authError=provider", expiredCookie(AUTH_STATE_COOKIE, request));
  const tokenPayload = await readBoundedResponseJson(tokenResponse, GOOGLE_RESPONSE_MAX_BYTES);
  const idToken = typeof tokenPayload.id_token === "string" ? tokenPayload.id_token : "";
  const claims = await verifyGoogleIdToken(idToken, env.GOOGLE_OAUTH_CLIENT_ID!, pending.nonce);
  if (!claims) return authRedirect(request, "/?authError=provider", expiredCookie(AUTH_STATE_COOKIE, request));

  const email = normalizeLoginEmail(claims.email);
  const subject = cleanProviderSubject(claims.sub);
  if (!email || !subject) return authRedirect(request, "/?authError=provider", expiredCookie(AUTH_STATE_COOKIE, request));
  const existing = await env.DB.prepare(
    `SELECT i.id, i.display_name, i.login_email, i.can_create_campaigns, i.can_use_qa_sessions, 0 AS last_seen_at
     FROM auth_accounts a JOIN identities i ON i.id = a.identity_id
     WHERE a.provider = 'google' AND a.provider_subject = ? LIMIT 1`,
  ).bind(subject).first<AuthSessionRow>();
  const invited = existing ?? await env.DB.prepare(
    `SELECT id, display_name, login_email, can_create_campaigns, can_use_qa_sessions, 0 AS last_seen_at
     FROM identities WHERE login_email = ? AND id NOT LIKE 'identity-combat-qa-%' LIMIT 1`,
  ).bind(email).first<AuthSessionRow>();
  if (!invited) return authRedirect(request, "/?authError=not-invited", expiredCookie(AUTH_STATE_COOKIE, request));

  if (existing) {
    await env.DB.prepare(
      "UPDATE auth_accounts SET verified_email = ?, updated_at = ? WHERE provider = 'google' AND provider_subject = ?",
    ).bind(email, now, subject).run();
  } else {
    const alreadyLinked = await env.DB.prepare(
      "SELECT provider_subject FROM auth_accounts WHERE identity_id = ? AND provider = 'google' LIMIT 1",
    ).bind(invited.id).first<{ provider_subject: string }>();
    if (alreadyLinked) return authRedirect(request, "/?authError=account-conflict", expiredCookie(AUTH_STATE_COOKIE, request));
    try {
      await env.DB.prepare(
        `INSERT INTO auth_accounts
         (id, identity_id, provider, provider_subject, verified_email, created_at, updated_at)
         VALUES (?, ?, 'google', ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), invited.id, subject, email, now, now).run();
    } catch {
      return authRedirect(request, "/?authError=account-conflict", expiredCookie(AUTH_STATE_COOKIE, request));
    }
  }
  const issued = await issueSession(env, invited.id, request);
  const headers = new Headers({ location: safeReturnTo(pending.return_to), "cache-control": "no-store" });
  headers.append("set-cookie", expiredCookie(AUTH_STATE_COOKIE, request));
  headers.append("set-cookie", sessionCookie(issued.rawToken, request, AUTH_SESSION_DURATION_MS));
  return new Response(null, { status: 302, headers });
}

async function issueSession(env: Env, identityId: string, request: Request): Promise<{ rawToken: string }> {
  const now = Date.now();
  const rawToken = randomToken(32);
  const tokenHash = await sha256Hex(rawToken);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL").bind(now),
    env.DB.prepare(
      `UPDATE auth_sessions SET revoked_at = ?
       WHERE identity_id = ? AND revoked_at IS NULL AND token_hash IN (
         SELECT token_hash FROM auth_sessions WHERE identity_id = ? AND revoked_at IS NULL
         ORDER BY created_at DESC, token_hash DESC LIMIT -1 OFFSET 19
       )`,
    ).bind(now, identityId, identityId),
    env.DB.prepare(
      `INSERT INTO auth_sessions (token_hash, identity_id, created_at, last_seen_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).bind(tokenHash, identityId, now, now, now + AUTH_SESSION_DURATION_MS),
  ]);
  void request;
  return { rawToken };
}

export async function verifyGoogleIdToken(
  token: string,
  clientId: string,
  expectedNonce: string,
  now = Date.now(),
  loadKeys: () => Promise<GoogleJsonWebKey[]> = googleSigningKeys,
): Promise<{ sub: string; email: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || token.length > 16_384) return null;
  const header = decodeJwtPart(parts[0]) as { alg?: unknown; kid?: unknown } | null;
  const claims = decodeJwtPart(parts[1]) as GoogleIdClaims | null;
  const signature = decodeBase64Url(parts[2]);
  if (!header || header.alg !== "RS256" || typeof header.kid !== "string" || !claims || !signature) return null;
  const keys = await loadKeys();
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig"));
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!validSignature) return null;
  const nowSeconds = Math.floor(now / 1_000);
  const issuerValid = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  const audienceValid = claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId));
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";
  if (!issuerValid || !audienceValid || claims.nonce !== expectedNonce || !emailVerified) return null;
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds || typeof claims.iat !== "number" || claims.iat > nowSeconds + 300) return null;
  const sub = cleanProviderSubject(claims.sub);
  const email = normalizeLoginEmail(claims.email);
  return sub && email ? { sub, email } : null;
}

async function googleSigningKeys(): Promise<GoogleJsonWebKey[]> {
  const now = Date.now();
  if (cachedGoogleKeys && cachedGoogleKeys.expiresAt > now) return cachedGoogleKeys.keys;
  const response = await fetch(GOOGLE_JWKS_ENDPOINT, { headers: { accept: "application/json" } });
  if (!response.ok) return [];
  const payload = await readBoundedResponseJson(response, GOOGLE_RESPONSE_MAX_BYTES);
  const keys = Array.isArray(payload.keys) ? payload.keys.filter((key): key is GoogleJsonWebKey => Boolean(key && typeof key === "object")) : [];
  cachedGoogleKeys = { keys, expiresAt: now + 60 * 60 * 1_000 };
  return keys;
}

async function readBoundedResponseJson(response: Response, limit: number): Promise<Record<string, unknown>> {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Google response exceeded the allowed size.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function googleConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_OAUTH_CLIENT_ID?.trim() && env.GOOGLE_OAUTH_CLIENT_SECRET?.trim());
}

function googleCallbackUrl(request: Request): string {
  const origin = isLocalAuthRequest(request) ? new URL(request.url).origin : CANONICAL_PRODUCTION_ORIGIN;
  return `${origin}/api/auth/google/callback`;
}

function authRedirect(request: Request, path: string, cookie: string): Response {
  const origin = isLocalAuthRequest(request) ? new URL(request.url).origin : CANONICAL_PRODUCTION_ORIGIN;
  return new Response(null, { status: 302, headers: { location: `${origin}${safeReturnTo(path)}`, "set-cookie": cookie, "cache-control": "no-store" } });
}

function sessionCookie(value: string, request: Request, durationMs: number): string {
  return `${AUTH_SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(durationMs / 1_000)}${isLocalAuthRequest(request) ? "" : "; Secure"}`;
}

function stateCookie(value: string, request: Request, durationMs: number): string {
  return `${AUTH_STATE_COOKIE}=${encodeURIComponent(value)}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(durationMs / 1_000)}${isLocalAuthRequest(request) ? "" : "; Secure"}`;
}

function expiredCookie(name: string, request: Request): string {
  const path = name === AUTH_STATE_COOKIE ? "/api/auth/google" : "/";
  return `${name}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0${isLocalAuthRequest(request) ? "" : "; Secure"}`;
}

function identityFromRow(row: AuthSessionRow): AuthenticatedIdentity {
  return {
    id: row.id,
    displayName: row.display_name,
    loginEmail: row.login_email,
    canCreateCampaigns: Boolean(row.can_create_campaigns),
    canUseQaSessions: Boolean(row.can_use_qa_sessions),
  };
}

function cleanIdentifier(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64) : "";
}

function cleanProviderSubject(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(value) ? value : "";
}

function cleanAuthorizationCode(value: unknown): string {
  return typeof value === "string" && value.length >= 8 && value.length <= 2_048 && /^[A-Za-z0-9._\/-]+$/.test(value) ? value : "";
}

function cleanOpaqueToken(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(value) ? value : "";
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function randomToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64Url(bytes);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Base64Url(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch { return null; }
}

function decodeJwtPart(value: string): Record<string, unknown> | null {
  const bytes = decodeBase64Url(value);
  if (!bytes || bytes.byteLength > 8_192) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function methodNotAllowed(allow: string): Response {
  return json({ error: "Method not allowed." }, { status: 405, headers: { allow } });
}

function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}
