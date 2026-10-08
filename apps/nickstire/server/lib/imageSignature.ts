/**
 * Identify an image by its BYTES, never by the name or the declared type
 * (2026-10-08).
 *
 * Every upload route (booking.uploadPhoto is public; services.uploadPhoto and
 * instagramStudio.uploadEvidencePhoto are admin) accepted a client-declared
 * `mimeType` from an allowlist and stored the bytes under it without looking at
 * them, so any payload could enter storage labelled image/jpeg and later reach
 * sharp, ffmpeg and the vision critic. The sniffer that already existed lived
 * privately in higgsfieldStudio.ts; it now lives here and both use it.
 *
 * Mislabelled REAL photos are normal (phones and browsers disagree about HEIC
 * vs JPEG), so callers accept any image the bytes prove and store it under the
 * sniffed type; only non-images are refused.
 */
export type SniffedImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);

export function sniffImageMime(buf: Buffer): SniffedImageMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  // ISO-BMFF: [size:4]["ftyp"][major brand:4]
  if (buf.length >= 12 && buf.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("ascii");
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    if (HEIF_BRANDS.has(brand)) return "image/heif";
  }
  return null;
}

/** The message a refused upload shows: what is wrong and what to send instead. */
export const NOT_AN_IMAGE_MESSAGE = "That file is not a photo. Send a JPEG, PNG, WebP or HEIC image.";
