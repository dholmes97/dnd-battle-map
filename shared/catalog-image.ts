import {
  CATALOG_ORIGINAL_MAX_EDGE,
  CATALOG_ORIGINAL_MAX_PIXELS,
  CATALOG_THUMBNAIL_MAX_EDGE,
  CATALOG_THUMBNAIL_MAX_PIXELS,
} from "./resource-limits.ts";

export type CatalogImageVariant = "original" | "thumbnail";
export type CatalogPngInspection = { width: number; height: number };
export type CatalogWebpInspection = { width: number; height: number };

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const IHDR = [73, 72, 68, 82];

export function inspectCatalogPng(
  bytes: Uint8Array,
  variant: CatalogImageVariant,
): CatalogPngInspection | null {
  if (bytes.byteLength < 33) return null;
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return null;
  if (readUint32(bytes, 8) !== 13 || IHDR.some((byte, index) => bytes[12 + index] !== byte)) return null;
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  const maximumEdge = variant === "original" ? CATALOG_ORIGINAL_MAX_EDGE : CATALOG_THUMBNAIL_MAX_EDGE;
  const maximumPixels = variant === "original" ? CATALOG_ORIGINAL_MAX_PIXELS : CATALOG_THUMBNAIL_MAX_PIXELS;
  if (width < 1 || height < 1 || width > maximumEdge || height > maximumEdge || width * height > maximumPixels) {
    return null;
  }
  return { width, height };
}

export function inspectCatalogWebp(bytes: Uint8Array): CatalogWebpInspection | null {
  if (bytes.byteLength < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  if (readUint32LittleEndian(bytes, 4) + 8 !== bytes.byteLength) return null;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const kind = ascii(bytes, offset, 4);
    const length = readUint32LittleEndian(bytes, offset + 4);
    const data = offset + 8;
    if (data + length > bytes.byteLength) return null;
    let dimensions: CatalogWebpInspection | null = null;
    if (kind === "VP8X" && length >= 10) {
      dimensions = {
        width: 1 + readUint24LittleEndian(bytes, data + 4),
        height: 1 + readUint24LittleEndian(bytes, data + 7),
      };
    } else if (kind === "VP8L" && length >= 5 && bytes[data] === 0x2f) {
      dimensions = {
        width: 1 + bytes[data + 1] + ((bytes[data + 2] & 0x3f) << 8),
        height: 1 + ((bytes[data + 2] & 0xc0) >> 6) + (bytes[data + 3] << 2) + ((bytes[data + 4] & 0x0f) << 10),
      };
    } else if (kind === "VP8 " && length >= 10 &&
      bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      dimensions = {
        width: readUint16LittleEndian(bytes, data + 6) & 0x3fff,
        height: readUint16LittleEndian(bytes, data + 8) & 0x3fff,
      };
    }
    if (dimensions) {
      if (dimensions.width < 1 || dimensions.height < 1 ||
          dimensions.width > CATALOG_ORIGINAL_MAX_EDGE || dimensions.height > CATALOG_ORIGINAL_MAX_EDGE ||
          dimensions.width * dimensions.height > CATALOG_ORIGINAL_MAX_PIXELS) return null;
      return dimensions;
    }
    offset = data + length + (length % 2);
  }
  return null;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  ) >>> 0;
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100;
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000;
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000 + bytes[offset + 3] * 0x1000000) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
