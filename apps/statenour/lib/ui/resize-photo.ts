/**
 * Shrink a phone photo before upload · 2026-10-29 (task photos).
 *
 * Decode through an <img> (Safari decodes HEIC there and applies the EXIF
 * rotation), draw onto a canvas no longer than 1600 px on its long edge, and
 * re-encode. Re-encoding from a canvas drops every EXIF tag, GPS included.
 * WebP first; Safari's toBlob silently hands back PNG for WebP, so the blob's
 * real type is checked and JPEG is the fallback. Quality, then size, steps
 * down until the file fits the server's 512 KB cap.
 */
import { TASK_PHOTO_MAX_BYTES as PHOTO_MAX_BYTES } from "@/lib/services/task-attachments-limits";

export const PHOTO_MAX_EDGE = 1600;

type Encode = (type: "image/webp" | "image/jpeg", quality: number, scale: number) => Promise<Blob | null>;

const QUALITIES = [0.85, 0.75, 0.65, 0.5];
const SCALES = [1, 0.8, 0.6, 0.45];

/** The search, separated from the DOM so it can be tested. Null = nothing fit. */
export async function encodeUnderCap(encode: Encode, maxBytes = PHOTO_MAX_BYTES): Promise<{ blob: Blob; scale: number } | null> {
  let type: "image/webp" | "image/jpeg" = "image/webp";
  for (const scale of SCALES) {
    for (const quality of QUALITIES) {
      let blob = await encode(type, quality, scale);
      if (type === "image/webp" && blob?.type !== "image/webp") {
        type = "image/jpeg";
        blob = await encode(type, quality, scale);
      }
      if (blob && blob.type === type && blob.size <= maxBytes) return { blob, scale };
    }
  }
  return null;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This photo could not be read on this device."));
    };
    img.src = url;
  });
}

export async function resizePhoto(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(file);
  const fit = Math.min(1, PHOTO_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize photos.");
  let size = { width: 0, height: 0 };
  const encode: Encode = (type, quality, scale) => {
    size = {
      width: Math.max(1, Math.round(img.naturalWidth * fit * scale)),
      height: Math.max(1, Math.round(img.naturalHeight * fit * scale)),
    };
    canvas.width = size.width;
    canvas.height = size.height;
    ctx.drawImage(img, 0, 0, size.width, size.height);
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  };
  const out = await encodeUnderCap(encode);
  if (!out) throw new Error("This photo stays over 512 KB even when shrunk.");
  return { blob: out.blob, ...size };
}
