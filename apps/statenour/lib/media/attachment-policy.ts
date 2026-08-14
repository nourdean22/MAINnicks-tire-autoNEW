/**
 * Composer attachment policy (BDN-314) — media plan item #5.
 *
 * THE ASYMMETRY THIS FIXES
 * BDN-309 taught the message renderer to display video, audio and PDFs.
 * The composer never learned to accept them: `use-image-attachment`
 * rejected every non-image at intake with "Images only for now — PDFs
 * and docs aren't readable yet." So the app could RENDER media it
 * refused to let the operator ATTACH. This module is the widened gate.
 *
 * WHY VIDEO IS STILL REFUSED — and it is a refusal, not an oversight
 * Every attachment in this app is inlined as a `data:` URL into the
 * message parts and stored with the message. There is no upload route
 * anywhere under app/api (checked: no upload/blob/file endpoints), so
 * "attach a video" would mean base64-ing a video into a chat row —
 * roughly +33% over the wire, held in memory on both ends, persisted
 * forever. The originating plan says this explicitly: "do not send huge
 * base64 files through the chat message. Upload them first, then pass a
 * secure media URL plus metadata."
 *
 * So video stays refused until an upload lane exists, and the refusal
 * says so rather than pretending the type is unsupported. Shipping
 * base64 video would be building the exact thing the plan warns against.
 *
 * SIZE CAPS ARE DELIBERATELY CONSERVATIVE
 * base64 inflates ~33%, and the encoded string is persisted per message.
 * The incumbent 10 MB image cap is preserved; audio and PDF get 8 MB
 * because a voice memo or a scanned invoice is normally far under it and
 * the cost of being wrong here is a bloated conversation row that never
 * shrinks.
 *
 * The `accept` attribute is a hint the OS picker can bypass, and paste
 * and drag-drop ignore it entirely — which is why this policy is enforced
 * in code, exactly as the 2026-07-16 truthfulness-wave comment on the
 * incumbent hook already established.
 *
 * Pure: no I/O, no DOM, no clock.
 */

export type AttachmentKind = "image" | "audio" | "pdf";

export const MAX_BYTES_BY_KIND: Record<AttachmentKind, number> = {
  image: 10 * 1024 * 1024,
  audio: 8 * 1024 * 1024,
  pdf: 8 * 1024 * 1024,
};

/** What the file picker should advertise. Not a security boundary. */
export const ACCEPT_ATTRIBUTE = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/gif",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/x-m4a",
  "application/pdf",
].join(",");

export type AttachmentDecision =
  | { accepted: true; kind: AttachmentKind }
  | { accepted: false; reason: string };

/** Minimal shape so this stays testable without a DOM File. */
export interface AttachmentCandidate {
  name: string;
  type: string;
  size: number;
}

function kindOf(candidate: AttachmentCandidate): AttachmentKind | "video" | null {
  const type = (candidate.type ?? "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("video/")) return "video";

  // Same extension fallback the renderer uses: uploads routinely arrive
  // as application/octet-stream and a type-only gate would reject most
  // real files. One classifier shape across both surfaces.
  const name = (candidate.name ?? "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "heic"].includes(ext)) return "image";
  if (["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "webm"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (["mp4", "mov", "m4v", "ogv"].includes(ext)) return "video";
  return null;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Decide whether a candidate may be attached.
 *
 * Every rejection carries a reason the operator can act on — which type
 * it was, what the limit is, or what is missing. A bare "not supported"
 * teaches nothing and is how the incumbent message ("Images only for
 * now") ended up outliving the constraint that produced it.
 */
export function decideAttachment(candidate: AttachmentCandidate): AttachmentDecision {
  const kind = kindOf(candidate);

  if (kind === "video") {
    return {
      accepted: false,
      reason:
        "Video can't be attached yet — it would be inlined into the message as base64. Needs an upload lane first.",
    };
  }
  if (kind === null) {
    return {
      accepted: false,
      reason: `${candidate.type || "That file type"} isn't supported — images, audio and PDFs only.`,
    };
  }

  const max = MAX_BYTES_BY_KIND[kind];
  if (candidate.size > max) {
    return {
      accepted: false,
      reason: `That ${kind} is ${mb(candidate.size)} — the limit is ${mb(max)}.`,
    };
  }

  // A zero-byte file reads as a successful attach and then produces an
  // empty data: URL the model silently receives as nothing.
  if (candidate.size <= 0) {
    return {
      accepted: false,
      reason: "That file is empty (0 bytes) — nothing would reach Nick. Try re-exporting it.",
    };
  }

  return { accepted: true, kind };
}

/** Convenience for callers that only need the boolean. */
export function isAttachable(candidate: AttachmentCandidate): boolean {
  return decideAttachment(candidate).accepted;
}
