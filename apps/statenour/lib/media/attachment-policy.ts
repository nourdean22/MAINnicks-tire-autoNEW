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
 * VIDEO: WAS REFUSED, NOW ROUTED (BDN-319, 2026-08-14)
 * Attachments here were inlined as `data:` URLs into the message parts
 * and stored with the message, and no upload route existed — so video
 * was refused outright, with the refusal naming that constraint rather
 * than pretending the type was unsupported. The constraint is now gone:
 * /api/ai/chat/media-upload puts the bytes in VideoDB and returns a
 * stream URL.
 *
 * Video is therefore ACCEPTED on the `upload` lane, never `inline`.
 * That distinction is load-bearing: accepting video without it would
 * silently send it down the base64 path — exactly the outcome the
 * original refusal existed to prevent, and what the plan warns against
 * ("do not send huge base64 files through the chat message").
 *
 * ★ The old refusal message was updated in the same commit as the route.
 * A rejection that outlives its constraint is how "Images only for now"
 * survived long past the day PDFs became renderable.
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

export type AttachmentKind = "image" | "audio" | "pdf" | "video";

/**
 * BDN-319 · which path the bytes take.
 *
 *   inline — base64'd into the message part and persisted with it.
 *            Fine for a screenshot, a voice memo, an invoice.
 *   upload — POSTed to /api/ai/chat/media-upload first; the message
 *            carries a stream URL, never the bytes.
 *
 * This distinction is the whole reason video was refused before the
 * upload route existed. Accepting video WITHOUT this field would have
 * silently routed it down the inline path — precisely the outcome the
 * earlier refusal was protecting against.
 */
export type AttachmentLane = "inline" | "upload";

export const MAX_BYTES_BY_KIND: Record<AttachmentKind, number> = {
  image: 10 * 1024 * 1024,
  audio: 8 * 1024 * 1024,
  pdf: 8 * 1024 * 1024,
  // Video never touches the message body, so the ceiling is the upload
  // route's, not base64's. Matches the session-capture route.
  video: 500 * 1024 * 1024,
};

/** Kinds whose bytes must go through the upload route. */
export const UPLOAD_LANE_KINDS: readonly AttachmentKind[] = ["video"];

export function laneFor(kind: AttachmentKind): AttachmentLane {
  return UPLOAD_LANE_KINDS.includes(kind) ? "upload" : "inline";
}

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
  "video/mp4",
  "video/webm",
  "video/quicktime",
].join(",");

export type AttachmentDecision =
  | { accepted: true; kind: AttachmentKind; lane: AttachmentLane }
  | { accepted: false; reason: string };

/** Minimal shape so this stays testable without a DOM File. */
export interface AttachmentCandidate {
  name: string;
  type: string;
  size: number;
}

function kindOf(candidate: AttachmentCandidate): AttachmentKind | null {
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

  if (kind === null) {
    return {
      accepted: false,
      reason: `${candidate.type || "That file type"} isn't supported — images, audio, video and PDFs only.`,
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

  return { accepted: true, kind, lane: laneFor(kind) };
}

/** Convenience for callers that only need the boolean. */
export function isAttachable(candidate: AttachmentCandidate): boolean {
  return decideAttachment(candidate).accepted;
}
