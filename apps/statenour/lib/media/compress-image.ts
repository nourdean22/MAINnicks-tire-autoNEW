/**
 * U5 (2026-10-30) · shrink a photo before it is sent inline as base64.
 *
 * A phone photo is 3-12 MB; ten of them as data: URLs in one chat POST is a 40-160 MB request
 * body. Long side capped at 2048 px, re-encoded as JPEG 0.85: about 300-700 KB each, and a
 * vision model gains nothing past ~2048 px. A small JPEG, PNG or WebP, a non-image, a GIF
 * (animation) or a browser that cannot decode it is sent as it is. Any other still format (HEIC
 * from an iPhone) is always re-encoded, whatever its size: the model providers do not read it.
 */
export const MAX_PHOTO_EDGE = 2048;
const SKIP_BELOW_BYTES = 600 * 1024;
const MODEL_READABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface PreparedFile {
  mimeType: string;
  base64: string;
  filename: string;
}

function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/** Target size for an image of w x h: unchanged when its long side is already within the cap. */
export function scaledSize(w: number, h: number, max = MAX_PHOTO_EDGE): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const k = max / long;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

async function shrink(file: File): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  try {
    const { w, h } = scaledSize(bitmap.width, bitmap.height);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // JPEG has no alpha: a transparent PNG would otherwise turn black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  } finally {
    bitmap.close?.();
    // iOS Safari keeps canvas memory until the size is zeroed; ten photos in a row add up.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** One file ready for a `file` message part. Never throws on a photo it cannot shrink: it sends the original. */
export async function prepareForSend(file: File): Promise<PreparedFile> {
  const isStill = file.type.startsWith("image/") && file.type !== "image/gif";
  const mustConvert = isStill && !MODEL_READABLE.has(file.type);
  if (isStill && (mustConvert || file.size > SKIP_BELOW_BYTES)) {
    try {
      const small = await shrink(file);
      if (small && (mustConvert || small.size < file.size)) {
        return { mimeType: "image/jpeg", base64: await readAsBase64(small), filename: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
      }
    } catch {
      // A format the browser cannot decode: the original goes, the server cap still bounds it.
    }
  }
  return { mimeType: file.type || "application/octet-stream", base64: await readAsBase64(file), filename: file.name };
}
