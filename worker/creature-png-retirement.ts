import manifest from "../catalog/retirement-manifests/creature-original-png-v1.json" with { type: "json" };
import { bearerSecretMatches } from "../shared/secret-auth.ts";
import { inspectCatalogPng, inspectCatalogWebp } from "../shared/catalog-image.ts";
import { acquireOperationLease, consumeRateLimit, releaseOperationLease } from "./adapters/d1-request-guard.ts";
import { readBoundedJsonObject, RequestBodyError } from "./request-security.ts";
import type { Env } from "./types.ts";

export const PNG_RETIREMENT_SHA256 = "43a690e25cf66a690ae578c8f2533732bbee322de09d42761371ad27c2a48ed1";
const receiptPrefix = "maintenance/creature-png-retirement-v1/";
const legacyReplacements = new Map(manifest.candidates.map((candidate) => [
  candidate.original.key.slice("creature-catalog/original/".length),
  `/creature-assets/display/v1/${candidate.replacement.key.slice("creature-catalog/display/".length)}`,
]));

/** Canonical legacy identities stay valid, but never depend on retired PNG bytes. */
export function retiredPngReplacement(key: string): string | undefined {
  return legacyReplacements.get(key);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** One reviewed manifest, 100 fixed batches, dedicated expiring credential, no caller-supplied keys. */
export async function handleCreaturePngRetirement(request: Request, env: Env, plan = manifest): Promise<Response> {
  const expiresAt = Date.parse(env.CREATURE_PNG_RETIREMENT_EXPIRES_AT ?? "");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() ||
      !bearerSecretMatches(request.headers.get("authorization"), env.CREATURE_PNG_RETIREMENT_TOKEN)) {
    return json({ error: "PNG retirement authorization failed." }, 401);
  }
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!env.MAP_ASSETS) return json({ error: "Storage unavailable." }, 503);
  const leases: Array<[string, string]> = [];
  try {
    const body = await readBoundedJsonObject(request, 1024);
    if (body.manifestSha256 !== PNG_RETIREMENT_SHA256 || typeof body.apply !== "boolean" ||
        typeof body.batch !== "number" || !Number.isInteger(body.batch) || body.batch < 0 || body.batch >= 100 ||
        Object.keys(body).some((key) => !["manifestSha256", "apply", "batch"].includes(key))) {
      return json({ error: "Expected the reviewed manifest, a fixed batch 0–99, and explicit apply boolean." }, 400);
    }
    const rate = await consumeRateLimit(env.DB, "png-retirement", { limit: 240, windowMs: 60_000 });
    if (!rate.allowed) return json({ error: "Retirement rate limit." }, 429);
    // These are the same locks used by both catalog writers. No import can replace checked bytes mid-batch.
    const startedAt = Date.now();
    for (const key of ["catalog-import", "catalog-display-import"]) {
      const lease = await acquireOperationLease(env.DB, key, 120_000);
      if (!lease) return json({ error: "A catalog operation is already running." }, 409);
      leases.push([key, lease]);
    }
    const storage = env.MAP_ASSETS;
    const candidates = plan.candidates.slice(body.batch * 10, body.batch * 10 + 10);
    const receiptKey = `${receiptPrefix}batch-${body.batch}.json`;
    const priorObject = await storage.get(receiptKey);
    const prior = priorObject ? await priorObject.json<{ manifestSha256: string; status: string }>() : null;
    if (prior && prior.manifestSha256 !== PNG_RETIREMENT_SHA256) return json({ error: "Receipt conflict." }, 409);
    if (body.apply && body.batch > 0) {
      const previousObject = await storage.get(`${receiptPrefix}batch-${body.batch - 1}.json`);
      const previous = previousObject ? await previousObject.json<{ status: string; manifestSha256: string }>() : null;
      if (previous?.status !== "complete" || previous.manifestSha256 !== PNG_RETIREMENT_SHA256) {
        return json({ error: "Complete the preceding batch first." }, 409);
      }
    }
    const present: string[] = [];
    for (const candidate of candidates) {
      const sourceKey = candidate.original.key.slice("creature-catalog/original/".length);
      const row = await env.DB.prepare(
        `SELECT c.token_asset, v.r2_key, v.sha256, v.byte_length FROM creature_catalog c
         JOIN creature_asset_variants v ON v.creature_catalog_id = c.id
         WHERE c.id = ? AND v.variant = 'display' AND v.version = 1`,
      ).bind(candidate.creatureId).first<{ token_asset: string; r2_key: string; sha256: string; byte_length: number }>();
      if (!row || row.token_asset !== `/creature-assets/${sourceKey}` ||
          row.r2_key !== candidate.replacement.key || row.sha256 !== candidate.replacement.sha256 ||
          row.byte_length !== candidate.replacement.byteLength) throw new Error(`Catalog metadata changed: ${candidate.creatureId}`);
      const thumbnail = await storage.head(`creature-catalog/thumbnails/${sourceKey}`);
      if (!thumbnail?.size) throw new Error(`Thumbnail missing: ${candidate.creatureId}`);
      for (const kind of ["replacement", "original"] as const) {
        const expected = candidate[kind];
        const object = await storage.get(expected.key);
        if (!object && kind === "original" && prior) continue; // Resume only a durably recorded deletion intent.
        if (!object || object.size !== expected.byteLength) throw new Error(`Missing or resized ${kind}: ${candidate.creatureId}`);
        const bytes = new Uint8Array(await object.arrayBuffer());
        if (await checksum(bytes) !== expected.sha256 ||
            !(kind === "replacement" ? inspectCatalogWebp(bytes) : inspectCatalogPng(bytes, "original"))) {
          throw new Error(`Invalid ${kind}: ${candidate.creatureId}`);
        }
        if (kind === "original") present.push(expected.key);
      }
    }
    const receipt = {
      manifestSha256: PNG_RETIREMENT_SHA256, sourceSnapshot: manifest.source.snapshot,
      batch: body.batch, candidates, candidateCount: candidates.length,
      originalBytes: candidates.reduce((sum, candidate) => sum + candidate.original.byteLength, 0),
    };
    if (!body.apply) return json({ ...receipt, status: "verified", originalsPresent: present.length });
    // Leave substantial lease headroom. On any failure the durable intent permits exact, idempotent recovery.
    if (Date.now() - startedAt > 60_000 || Date.now() >= expiresAt) throw new Error("Verification took too long; retry without deleting.");
    await storage.put(receiptKey, JSON.stringify({ ...receipt, status: "intent", updatedAt: new Date().toISOString() }), {
      httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
    });
    if (present.length) await storage.delete(present);
    for (const candidate of candidates) {
      if (await storage.head(candidate.original.key)) throw new Error(`Deletion not confirmed: ${candidate.creatureId}`);
      const replacement = await storage.head(candidate.replacement.key);
      if (replacement?.size !== candidate.replacement.byteLength) throw new Error(`Replacement changed: ${candidate.creatureId}`);
    }
    const complete = { ...receipt, status: "complete", updatedAt: new Date().toISOString(), deletedThisRequest: present.length };
    await storage.put(receiptKey, JSON.stringify(complete), { httpMetadata: { contentType: "application/json", cacheControl: "no-store" } });
    return json(complete);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "PNG retirement failed." }, error instanceof RequestBodyError ? error.status : 409);
  } finally {
    for (const [key, lease] of leases.reverse()) await releaseOperationLease(env.DB, key, lease);
  }
}
