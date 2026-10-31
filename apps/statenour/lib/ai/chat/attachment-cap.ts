/**
 * U5 (2026-10-30) · the server's own limit on what one new chat message may carry inline.
 *
 * Attachments ride the chat POST as data: URLs. The client limits (lib/media/attachment-policy.ts,
 * hooks/use-image-attachment.ts) are hints a modified client skips, and the route had no byte cap
 * at all (a trust-boundary gap found in the U5 phase-1 read). Only the newest message is checked:
 * older turns are resent with their history and were checked when they were new.
 */
export const MAX_FILES_PER_MESSAGE = 10;
/** Base64 characters across the message's data: URLs: about 18 MB of file bytes. */
export const MAX_INLINE_CHARS = 24_000_000;

type AttachmentPart = { type?: unknown; url?: unknown; data?: unknown; image?: unknown; filename?: unknown };

/**
 * The inline payload an attachment part carries, in every shape build-model-messages.ts forwards:
 * v6 `{ type: "file", url }`, legacy `{ type: "file", data }` and `{ type: "image", image }`.
 * Null for a hosted http(s) URL (not inline); undefined for a part that is not an attachment.
 */
function inlinePayload(p: AttachmentPart | null | undefined): string | null | undefined {
  if (p?.type !== "file" && p?.type !== "image") return undefined;
  // A url is inline only as a data: URL: a hosted one (https, or a relative /api/images/... from
  // lib/ai/chat/handlers/image.ts) carries no bytes and stays in history.
  if (p.type === "file" && typeof p.url === "string") return p.url.startsWith("data:") ? p.url : null;
  const v = p.type === "image" ? p.image : p.data;
  return typeof v === "string" && !/^(https?:\/\/|\/)/i.test(v) ? v : null;
}

export function attachmentCapProblem(message: unknown): string | null {
  const parts = (message as { parts?: unknown })?.parts;
  if (!Array.isArray(parts)) return null;
  let files = 0;
  let chars = 0;
  for (const p of parts as AttachmentPart[]) {
    const inline = inlinePayload(p);
    if (inline === undefined) continue;
    files += 1;
    if (inline) chars += inline.length;
  }
  if (files > MAX_FILES_PER_MESSAGE) return `At most ${MAX_FILES_PER_MESSAGE} files per message (got ${files}).`;
  if (chars > MAX_INLINE_CHARS) return "Those attachments are too large to send together. Send fewer photos at a time.";
  return null;
}

type WireMessage = { role?: unknown; parts?: unknown };

/**
 * The request body for a chat send: inline (data:) files stay only on the newest user message.
 * Every older turn swaps its file bytes for a one-line note. The server persists only the newest
 * user message, so nothing stored changes; without this, each photo was resent with every later
 * turn, and three turns of photos passed the proxy's body limit.
 */
/** Index of the newest user message (a regenerate ends with an assistant one), or -1. */
export function newestUserIndex(messages: readonly WireMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === "user") return i;
  return -1;
}

export function withoutOlderInlineFiles<T extends WireMessage>(messages: T[]): T[] {
  const newestUser = newestUserIndex(messages);
  return messages.map((m, i) => {
    if (i === newestUser || !Array.isArray(m?.parts)) return m;
    const parts = m.parts as AttachmentPart[];
    if (!parts.some((p) => inlinePayload(p))) return m;
    return {
      ...m,
      parts: parts.map((p) =>
        inlinePayload(p)
          ? { type: "text", text: `[Attachment sent earlier${typeof p.filename === "string" ? `: ${p.filename}` : ""}. Not resent.]` }
          : p,
      ),
    };
  });
}
