#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import {
  parseScenarioProvisioningManifest,
  requiredScenarioProvisioningAssets,
} from "../shared/scenario-provisioning.ts";

const inputPath = process.argv[2];
if (!inputPath || inputPath === "--help" || inputPath === "-h") {
  printUsage();
  process.exit(inputPath ? 0 : 1);
}

const token = process.env.SCENARIO_PROVISIONING_TOKEN?.trim() ?? "";
if (token.length < 32) fail("Set SCENARIO_PROVISIONING_TOKEN to the dedicated scenario-provisioning secret.");
const siteUrl = cleanSiteUrl(process.env.BATTLE_MAP_SITE_URL);
if (!siteUrl) fail("Set BATTLE_MAP_SITE_URL to the deployed battle-map origin, such as https://example.com.");

const absoluteInputPath = resolve(inputPath);
const envelope = await readEnvelope(absoluteInputPath);
const parsed = parseScenarioProvisioningManifest(envelope.manifest);
if (!parsed.ok) fail(`Manifest validation failed: ${parsed.errors.join(" ")}`);
const expectedAssets = requiredScenarioProvisioningAssets(parsed.manifest);
const localAssets = validateLocalAssetDeclarations(envelope.assets, expectedAssets, dirname(absoluteInputPath));

const created = await apiJson("/api/scenario-provisioning/jobs", {
  method: "POST",
  body: JSON.stringify(parsed.manifest),
  headers: { "content-type": "application/json" },
});
const job = created.job;
if (!job?.id) fail("The provisioning API did not return a job ID.");
console.log(`${created.created ? "Created" : "Resuming"} provisioning job ${job.id} (${job.status}).`);

if (job.status === "ready") {
  printResult(job.result);
  process.exit(0);
}

await updateStatus(job.id, "validating", "Prepared manifest and local assets validated.");
for (const spec of expectedAssets) {
  const local = localAssets.get(spec.id);
  const bytes = await readFile(local.path);
  if (bytes.byteLength < 1 || bytes.byteLength > spec.maxBytes) {
    fail(`Asset ${spec.id} is ${bytes.byteLength} bytes; its limit is ${spec.maxBytes}.`);
  }
  await apiJson(`/api/scenario-provisioning/jobs/${encodeURIComponent(job.id)}/assets/${encodeURIComponent(spec.id)}`, {
    method: "PUT",
    body: bytes,
    headers: {
      "content-type": local.contentType,
      "content-length": String(bytes.byteLength),
    },
  });
  console.log(`Staged ${spec.id} (${bytes.byteLength} bytes).`);
}

const finalized = await apiJson(`/api/scenario-provisioning/jobs/${encodeURIComponent(job.id)}/finalize`, {
  method: "POST",
});
printResult(finalized.result);

function validateLocalAssetDeclarations(value, expected, inputDirectory) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Envelope assets must be an object keyed by manifest asset ID.");
  const expectedById = new Map(expected.map((spec) => [spec.id, spec]));
  const result = new Map();
  for (const [assetId, declaration] of Object.entries(value)) {
    const spec = expectedById.get(assetId);
    if (!spec) fail(`Envelope declares unexpected local asset ${assetId}.`);
    if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) fail(`Local asset ${assetId} must declare path and contentType.`);
    const path = typeof declaration.path === "string" ? resolve(inputDirectory, declaration.path) : "";
    const contentType = typeof declaration.contentType === "string" ? declaration.contentType.toLowerCase() : inferredContentType(path);
    if (!path || !spec.contentTypes.includes(contentType)) fail(`Local asset ${assetId} must use ${spec.contentTypes.join(" or ")}.`);
    result.set(assetId, { path, contentType });
  }
  const missing = expected.filter((spec) => !result.has(spec.id));
  if (missing.length) fail(`Envelope is missing local assets: ${missing.map((spec) => spec.id).join(", ")}.`);
  return result;
}

async function updateStatus(jobId, status, summary) {
  try {
    await apiJson(`/api/scenario-provisioning/jobs/${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, summary }),
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    if (!String(error.message).includes("status_transition_invalid")) throw error;
  }
}

async function apiJson(path, init) {
  const response = await fetch(`${siteUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(120_000),
  }).catch((error) => fail(`Provisioning request failed: ${error.message}`));
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { fail(`Provisioning API returned non-JSON status ${response.status}.`); }
  if (!response.ok) fail(`Provisioning API ${body.code ?? response.status}: ${body.error ?? "request failed"}`);
  return body;
}

async function readEnvelope(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch (error) {
    fail(`Could not read provisioning envelope ${path}: ${error.message}`);
  }
}

function inferredContentType(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".png") return "image/png";
  return "";
}

function cleanSiteUrl(value) {
  try {
    const url = new URL(value ?? "");
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== "/") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function printResult(result) {
  if (!result?.scenario?.code) fail("The provisioning API did not return a completed scenario.");
  console.log(`Scenario ready: ${result.scenario.name} (${result.scenario.code}).`);
  console.log(`Preset: ${result.presetId ?? "unchanged"}; handouts: ${result.handoutIds?.length ?? 0}; tokens: ${result.placedTokenIds?.length ?? 0}.`);
  if (result.createdCatalogIds?.length) console.log(`Created creatures: ${result.createdCatalogIds.join(", ")}.`);
  if (result.reusedCatalogIds?.length) console.log(`Reused creatures: ${result.reusedCatalogIds.join(", ")}.`);
  for (const warning of result.reviewWarnings ?? []) console.log(`Review: ${warning}`);
}

function printUsage() {
  console.log("Usage: npm run scenario:provision -- path/to/envelope.json");
  console.log("Envelope: { manifest: <versioned manifest>, assets: { <assetId>: { path, contentType? } } }");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
