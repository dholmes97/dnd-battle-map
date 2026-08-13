import assert from "node:assert/strict";
import test from "node:test";
import {
  HANDOUT_DISPLAY_MAX_BYTES,
  cleanHandoutTitle,
  handoutUploadInputError,
  handoutVisibleToViewer,
  inspectJpeg,
  inspectStoredHandout,
  inspectWebp,
  storedHandoutVariantError,
} from "../shared/handout-domain.ts";

function vp8x(width, height) {
  const bytes = new Uint8Array(30);
  bytes.set([..."RIFF"].map((character) => character.charCodeAt(0)), 0);
  bytes.set([..."WEBP"].map((character) => character.charCodeAt(0)), 8);
  bytes.set([..."VP8X"].map((character) => character.charCodeAt(0)), 12);
  bytes[16] = 10;
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;
  bytes[24] = encodedWidth & 255; bytes[25] = (encodedWidth >> 8) & 255; bytes[26] = (encodedWidth >> 16) & 255;
  bytes[27] = encodedHeight & 255; bytes[28] = (encodedHeight >> 8) & 255; bytes[29] = (encodedHeight >> 16) & 255;
  return bytes;
}

function jpeg(width, height) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x02,
    0xff, 0xc0, 0x00, 0x07, 0x08,
    (height >> 8) & 255, height & 255,
    (width >> 8) & 255, width & 255,
  ]);
}

test("handout policy normalizes titles and bounds source uploads", () => {
  assert.equal(cleanHandoutTitle("  Strahd's   invitation  "), "Strahd's invitation");
  assert.equal(handoutUploadInputError({ contentType: "image/png", byteLength: 2_000_000, width: 4000, height: 3000 }), null);
  assert.match(handoutUploadInputError({ contentType: "image/gif", byteLength: 10, width: 2, height: 2 }), /JPEG/);
  assert.match(handoutUploadInputError({ contentType: "image/png", byteLength: 100, width: 6000, height: 5000 }), /24 megapixels/);
});

test("server validation reads WebP and Safari JPEG dimensions and rejects oversized prepared assets", () => {
  assert.deepEqual(inspectWebp(vp8x(1600, 900)), { width: 1600, height: 900 });
  assert.deepEqual(inspectJpeg(jpeg(1600, 900)), { width: 1600, height: 900 });
  assert.deepEqual(inspectStoredHandout(jpeg(1600, 900), "image/jpeg"), { width: 1600, height: 900 });
  assert.equal(storedHandoutVariantError({ variant: "display", contentType: "image/webp", byteLength: 500_000, width: 1600, height: 900 }), null);
  assert.equal(storedHandoutVariantError({ variant: "display", contentType: "image/jpeg", byteLength: 500_000, width: 1600, height: 900 }), null);
  assert.match(storedHandoutVariantError({ variant: "display", contentType: "image/webp", byteLength: HANDOUT_DISPLAY_MAX_BYTES + 1, width: 1600, height: 900 }), /too large/);
  assert.match(storedHandoutVariantError({ variant: "thumbnail", contentType: "image/webp", byteLength: 50_000, width: 500, height: 240 }), /dimensions/);
});

test("handout delivery follows public and DM-private chat visibility", () => {
  const privateToDan = { senderName: "Kevin", recipientName: "Dan" };
  assert.equal(handoutVisibleToViewer(privateToDan, { name: "Kevin", role: "dm" }), true);
  assert.equal(handoutVisibleToViewer(privateToDan, { name: "Dan", role: "player" }), true);
  assert.equal(handoutVisibleToViewer(privateToDan, { name: "Barry", role: "player" }), false);
  assert.equal(handoutVisibleToViewer({ senderName: "Kevin", recipientName: null }, { name: "Barry", role: "player" }), true);
});
