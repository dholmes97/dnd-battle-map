export const HANDOUT_INPUT_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
export const HANDOUT_STORED_MIME_TYPES = Object.freeze(["image/webp", "image/jpeg"]);
export const HANDOUT_INPUT_MAX_BYTES = 12 * 1024 * 1024;
export const HANDOUT_INPUT_MAX_PIXELS = 24_000_000;
export const HANDOUT_DISPLAY_MAX_EDGE = 2048;
export const HANDOUT_DISPLAY_MAX_BYTES = 1_500_000;
export const HANDOUT_THUMBNAIL_MAX_WIDTH = 360;
export const HANDOUT_THUMBNAIL_MAX_HEIGHT = 240;
export const HANDOUT_THUMBNAIL_MAX_BYTES = 120_000;
export const HANDOUT_MAX_PER_SCENARIO = 50;
export const HANDOUT_TITLE_MAX_LENGTH = 80;

export function cleanHandoutTitle(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, HANDOUT_TITLE_MAX_LENGTH)
    : "";
}

export function handoutUploadInputError({ contentType, byteLength, width, height }) {
  if (!HANDOUT_INPUT_MIME_TYPES.includes(contentType)) return "Choose a JPEG, PNG, or WebP image.";
  if (!Number.isFinite(byteLength) || byteLength < 1 || byteLength > HANDOUT_INPUT_MAX_BYTES) {
    return "Choose an image smaller than 12 MB.";
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return "That image's dimensions could not be read.";
  }
  if (width * height > HANDOUT_INPUT_MAX_PIXELS) {
    return "Choose an image smaller than 24 megapixels.";
  }
  return null;
}

export function inspectWebp(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 30) return null;
  const text = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP") return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = text(offset, 4);
    const size = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
    const payload = offset + 8;
    if (size < 0 || payload + size > bytes.length) return null;
    if (chunk === "VP8X" && size >= 10) {
      return {
        width: 1 + bytes[payload + 4] + (bytes[payload + 5] << 8) + (bytes[payload + 6] << 16),
        height: 1 + bytes[payload + 7] + (bytes[payload + 8] << 8) + (bytes[payload + 9] << 16),
      };
    }
    if (chunk === "VP8L" && size >= 5 && bytes[payload] === 0x2f) {
      return {
        width: 1 + bytes[payload + 1] + ((bytes[payload + 2] & 0x3f) << 8),
        height: 1 + (bytes[payload + 2] >> 6) + (bytes[payload + 3] << 2) + ((bytes[payload + 4] & 0x0f) << 10),
      };
    }
    if (chunk === "VP8 " && size >= 10 && bytes[payload + 3] === 0x9d && bytes[payload + 4] === 0x01 && bytes[payload + 5] === 0x2a) {
      return {
        width: (bytes[payload + 6] | (bytes[payload + 7] << 8)) & 0x3fff,
        height: (bytes[payload + 8] | (bytes[payload + 9] << 8)) & 0x3fff,
      };
    }
    offset = payload + size + (size % 2);
  }
  return null;
}

export function inspectJpeg(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 11 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += segmentLength;
  }
  return null;
}

export function inspectStoredHandout(bytes, contentType) {
  if (contentType === "image/webp") return inspectWebp(bytes);
  if (contentType === "image/jpeg") return inspectJpeg(bytes);
  return null;
}

export function storedHandoutVariantError({ variant, contentType, byteLength, width, height }) {
  if (!HANDOUT_STORED_MIME_TYPES.includes(contentType)) return "Prepared handouts must be WebP or JPEG images.";
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return "The prepared handout dimensions are invalid.";
  }
  if (variant === "thumbnail") {
    if (byteLength > HANDOUT_THUMBNAIL_MAX_BYTES) return "The handout thumbnail is too large.";
    if (width > HANDOUT_THUMBNAIL_MAX_WIDTH || height > HANDOUT_THUMBNAIL_MAX_HEIGHT) return "The handout thumbnail dimensions are too large.";
    return null;
  }
  if (byteLength > HANDOUT_DISPLAY_MAX_BYTES) return "The handout display image is too large.";
  if (width > HANDOUT_DISPLAY_MAX_EDGE || height > HANDOUT_DISPLAY_MAX_EDGE) return "The handout display dimensions are too large.";
  return null;
}

export function handoutVisibleToViewer({ senderName, recipientName }, viewer) {
  if (!viewer) return false;
  if (viewer.role === "dm" || recipientName === null) return true;
  return senderName === viewer.name || recipientName === viewer.name;
}
