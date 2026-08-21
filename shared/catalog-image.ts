import {
  CATALOG_ORIGINAL_MAX_EDGE,
  CATALOG_ORIGINAL_MAX_PIXELS,
  CATALOG_THUMBNAIL_MAX_EDGE,
  CATALOG_THUMBNAIL_MAX_PIXELS,
} from "./resource-limits.ts";

export type CatalogImageVariant = "original" | "thumbnail";
export type CatalogPngInspection = { width: number; height: number };

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

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  ) >>> 0;
}
