import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RequestBodyError,
  readBoundedFormData,
  readBoundedJsonObject,
  readBoundedRequestBytes,
} from "../worker/request-security.ts";

test("declared oversized bodies are rejected from headers", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array([1]));
      controller.close();
    },
  });
  const request = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-length": "101" },
    body: stream,
    duplex: "half",
  });
  await assert.rejects(readBoundedRequestBytes(request, 100), (error) =>
    error instanceof RequestBodyError && error.status === 413 && error.code === "request_too_large");
});

test("chunked bodies stop at the byte ceiling even without Content-Length", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(64));
      controller.enqueue(new Uint8Array(64));
    },
    cancel() { cancelled = true; },
  });
  const request = new Request("http://localhost/upload", { method: "POST", body: stream, duplex: "half" });
  await assert.rejects(readBoundedRequestBytes(request, 100), (error) =>
    error instanceof RequestBodyError && error.status === 413);
  assert.equal(cancelled, true);
});

test("bounded JSON accepts only an object and detects dishonest lengths", async () => {
  assert.deepEqual(await readBoundedJsonObject(new Request("http://localhost", {
    method: "POST", body: JSON.stringify({ safe: true }),
  }), 100), { safe: true });
  await assert.rejects(readBoundedJsonObject(new Request("http://localhost", {
    method: "POST", headers: { "content-length": "999" }, body: "{}",
  }), 1_000), (error) => error instanceof RequestBodyError && error.code === "request_size_invalid");
  await assert.rejects(readBoundedJsonObject(new Request("http://localhost", {
    method: "POST", body: "[]",
  }), 100), (error) => error instanceof RequestBodyError && error.code === "json_invalid");
});

test("multipart parsing happens only after the complete form is bounded", async () => {
  const source = new FormData();
  source.set("title", "Map");
  source.set("display", new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }), "map.webp");
  const request = new Request("http://localhost", { method: "POST", body: source });
  const parsed = await readBoundedFormData(request, 10_000);
  assert.equal(parsed.get("title"), "Map");
  await assert.rejects(readBoundedFormData(new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=test", "content-length": "100" },
    body: "oversized",
  }), 10), (error) => error instanceof RequestBodyError && error.status === 413);
});

test("Worker write routes use the bounded body boundary instead of direct request buffering", async () => {
  const sources = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/scenario-provisioning-api.ts", import.meta.url), "utf8"),
  ]);
  const writeBoundaries = sources.join("\n");
  assert.doesNotMatch(writeBoundaries, /request\.(?:json|formData|arrayBuffer)\s*\(/);
  assert.match(writeBoundaries, /readBoundedJsonObject/);
  assert.match(writeBoundaries, /readBoundedFormData/);
  assert.match(writeBoundaries, /readBoundedRequestBytes/);
});
