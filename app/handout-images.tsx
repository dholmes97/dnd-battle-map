"use client";

import { useEffect, useRef, useState } from "react";
import type { ParticipantSession } from "@/shared/contracts";
import {
  HANDOUT_DISPLAY_MAX_BYTES,
  HANDOUT_DISPLAY_MAX_EDGE,
  HANDOUT_THUMBNAIL_MAX_BYTES,
  HANDOUT_THUMBNAIL_MAX_HEIGHT,
  HANDOUT_THUMBNAIL_MAX_WIDTH,
  handoutUploadInputError,
} from "@/shared/handout-domain.ts";

function handoutAssetUrl(encounterCode: string, handoutId: string, variant: "thumbnail" | "display", revision: number | null) {
  return `/api/encounters/${encodeURIComponent(encounterCode)}/handouts/${encodeURIComponent(handoutId)}/${variant}?v=${revision ?? 0}`;
}

export function ProtectedHandoutImage({
  participant,
  encounterCode,
  handoutId,
  variant,
  revision,
  alt,
}: {
  participant: ParticipantSession;
  encounterCode: string;
  handoutId: string;
  variant: "thumbnail" | "display";
  revision: number | null;
  alt: string;
}) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(() => typeof IntersectionObserver === "undefined");
  const shellRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || shouldLoad || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: "120px" });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    if (!shouldLoad) return;
    let disposed = false;
    let objectUrl = "";
    void fetch(handoutAssetUrl(encounterCode, handoutId, variant, revision), {
      cache: "no-store",
      headers: {
        "x-participant-id": participant.id,
        "x-session-secret": participant.sessionSecret,
      },
    }).then(async (response) => {
      if (!response.ok) throw new Error("Handout unavailable");
      objectUrl = URL.createObjectURL(await response.blob());
      if (disposed) URL.revokeObjectURL(objectUrl);
      else setSource(objectUrl);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [encounterCode, handoutId, participant.id, participant.sessionSecret, revision, shouldLoad, variant]);

  return <span className="handout-image-shell" ref={shellRef}>
    {failed ? <span className="handout-image-status">Image unavailable</span>
      // Protected images are authenticated fetch blobs, so Next Image cannot address them directly.
      // eslint-disable-next-line @next/next/no-img-element
      : source ? <img src={source} alt={alt} />
      : <span className="handout-image-status">Loading image…</span>}
  </span>;
}

function canvasToStorageImage(canvas: HTMLCanvasElement, maxBytes: number, contentType: "image/webp" | "image/jpeg"): Promise<Blob | null> {
  const qualities = contentType === "image/webp"
    ? [0.82, 0.72, 0.62, 0.52, 0.44]
    : [0.86, 0.76, 0.66, 0.56, 0.46, 0.38];
  return new Promise((resolve, reject) => {
    const encode = (index: number) => {
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error("This browser could not prepare the image.")); return; }
        if (blob.type !== contentType) { resolve(null); return; }
        if (blob.size <= maxBytes) { resolve(blob); return; }
        if (index + 1 >= qualities.length) { reject(new Error("The image is too detailed to fit the handout storage limit.")); return; }
        encode(index + 1);
      }, contentType, qualities[index]);
    };
    encode(0);
  });
}

export async function prepareHandoutImages(file: File) {
  const initialPolicyError = handoutUploadInputError({
    contentType: file.type,
    byteLength: file.size,
    width: 1,
    height: 1,
  });
  if (initialPolicyError) throw new Error(initialPolicyError);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That image could not be read. Choose a JPEG, PNG, or WebP image.");
  }
  try {
    const policyError = handoutUploadInputError({
      contentType: file.type,
      byteLength: file.size,
      width: bitmap.width,
      height: bitmap.height,
    });
    if (policyError) throw new Error(policyError);
    const render = (maxWidth: number, maxHeight: number) => {
      const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("This browser could not prepare the image.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas;
    };
    const displayCanvas = render(HANDOUT_DISPLAY_MAX_EDGE, HANDOUT_DISPLAY_MAX_EDGE);
    const thumbnailCanvas = render(HANDOUT_THUMBNAIL_MAX_WIDTH, HANDOUT_THUMBNAIL_MAX_HEIGHT);
    let contentType: "image/webp" | "image/jpeg" = "image/webp";
    let display = await canvasToStorageImage(displayCanvas, HANDOUT_DISPLAY_MAX_BYTES, contentType);
    if (!display) {
      contentType = "image/jpeg";
      display = await canvasToStorageImage(displayCanvas, HANDOUT_DISPLAY_MAX_BYTES, contentType);
    }
    if (!display) throw new Error("This browser could not prepare a storage-efficient handout image.");
    const thumbnail = await canvasToStorageImage(thumbnailCanvas, HANDOUT_THUMBNAIL_MAX_BYTES, contentType);
    if (!thumbnail) throw new Error("This browser could not prepare a storage-efficient handout thumbnail.");
    return { display, thumbnail, width: displayCanvas.width, height: displayCanvas.height };
  } finally {
    bitmap.close();
  }
}
