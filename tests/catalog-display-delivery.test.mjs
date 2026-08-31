import assert from "node:assert/strict";
import test from "node:test";

test("versioned catalog display routes serve immutable WebP bytes from R2", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("catalog-display-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const webp = Uint8Array.from([82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80]);
  const response = await worker.fetch(
    new Request("http://localhost/creature-assets/display/v1/tokens/catalog/owlbear.webp"),
    {
      MAP_ASSETS: {
        async get(key) {
          assert.equal(key, "creature-catalog/display/tokens/catalog/owlbear.webp");
          return { body: webp, httpEtag: '"display-etag"' };
        },
      },
    },
    executionContext(),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("x-creature-asset-source"), "r2-display-webp-v1");
  assert.match(response.headers.get("cache-control") ?? "", /immutable/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), webp);
});

test("a missing display variant fails explicitly without falling back to PNG", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("catalog-display-fallback-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/creature-assets/display/v1/tokens/catalog/future-creature.webp", { redirect: "manual" }),
    {
      MAP_ASSETS: {
        async get() { return null; },
      },
    },
    executionContext(),
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-creature-asset-source"), "missing-display-webp-v1");
  assert.equal(response.headers.get("location"), null);
  assert.match(await response.text(), /unavailable/i);
});

function executionContext() {
  return { waitUntil() {}, passThroughOnException() {} };
}
