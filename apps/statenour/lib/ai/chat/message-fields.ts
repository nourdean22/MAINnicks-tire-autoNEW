/**
 * ChatMessage Batch A · v7.6 · Apr 29 · field-prep helpers
 *
 * Single-source-of-truth for transforming an incoming UIMessage into
 * the columns that hit chat_messages. Used by both the user-write
 * path and the assistant-write path so the rules stay consistent.
 *
 * What this module owns:
 *   · `extractParts`        — derives the rich `parts` JSON tree
 *   · `extractAttachments`  — pulls file/image parts (legacy compat)
 *   · `computeAttachmentsHash` — SHA-256 of sorted attachment URLs
 *   · `buildSearchableContent` — flattens parts → indexed plaintext
 *   · `extractClientMessageId` — pulls client-minted UUID for idempotency
 *
 * Everything is deterministic + side-effect-free → cheap to call,
 * test, and reason about.
 */

import { createHash } from "node:crypto";

/**
 * v10.0.185 · resolve a valid mediaType for a file/image part.
 *
 * Pre-fix: a part with neither `mediaType` nor `mimeType` ended up
 * stored as `mediaType: undefined`. On replay, the AI SDK's
 * provider validators emitted:
 *   "'file part media type ' functionality not supported."
 * (the empty space = the undefined interpolation). 26 chat-turn
 * failures in 72h came from this.
 *
 * Resolution order:
 *   1. part.mediaType (string)
 *   2. part.mimeType (string)
 *   3. derive from a data: URL prefix
 *   4. application/octet-stream (last-resort, valid placeholder)
 *
 * Always returns a non-empty string so downstream code can rely
 * on the type narrowing.
 */
export function resolveMediaType(
  part: { mediaType?: unknown; mimeType?: unknown },
  url?: string,
): string {
  if (typeof part.mediaType === "string" && part.mediaType.length > 0) {
    return part.mediaType;
  }
  if (typeof part.mimeType === "string" && part.mimeType.length > 0) {
    return part.mimeType;
  }
  if (url && url.startsWith("data:")) {
    const m = url.match(/^data:([^;,]+)/);
    if (m && m[1] && m[1].length > 0) return m[1];
  }
  return "application/octet-stream";
}

/**
 * Convenience predicate: is this part a file/image with a usable URL?
 * Used by the chat replay path to skip stripped/invalid attachments
 * rather than ship `{ url: undefined, mediaType: undefined }` to
 * streamText.
 */
export function isUsableFilePart(part: {
  type?: unknown;
  url?: unknown;
  image?: unknown;
  data?: unknown;
}): boolean {
  if (part.type !== "file" && part.type !== "image") return false;
  return (
    typeof part.url === "string" ||
    typeof part.image === "string" ||
    typeof part.data === "string"
  );
}

export interface PartFile {
  type: "file";
  mediaType?: string;
  url: string;
  filename?: string;
}

export interface PartText {
  type: "text";
  text: string;
}

export interface PartReasoning {
  type: "reasoning";
  text: string;
}

export interface PartToolCall {
  type: "tool-call";
  toolName: string;
  toolCallId?: string;
  args?: unknown;
}

export interface PartToolResult {
  type: "tool-result";
  toolName?: string;
  toolCallId?: string;
  result?: unknown;
}

export interface PartSource {
  type: "source";
  url: string;
  title?: string;
}

export type MessagePart =
  | PartText
  | PartFile
  | PartReasoning
  | PartToolCall
  | PartToolResult
  | PartSource;

interface AnyPart {
  type?: unknown;
  [k: string]: unknown;
}

/**
 * Build the canonical `parts` array from whatever shape the AI SDK
 * gave us. v6 sends:
 *   { type: "text", text }
 *   { type: "file", mediaType, url, filename? }
 *   { type: "reasoning", text }
 *   { type: "tool-call", toolName, args, toolCallId }
 *   { type: "tool-result", toolCallId, result }
 *   { type: "source", url, title }
 *
 * v4/v5 legacy: { type: "image", image } → up-converted to file.
 *
 * Returns null when there's nothing meaningful to persist (avoids
 * storing `[]` everywhere).
 */
export function extractParts(rawParts: unknown, fallbackText?: string): MessagePart[] | null {
  const out: MessagePart[] = [];

  if (Array.isArray(rawParts)) {
    for (const p of rawParts as AnyPart[]) {
      if (!p || typeof p !== "object") continue;
      const t = typeof p.type === "string" ? p.type : "";

      if (t === "text" && typeof p.text === "string" && p.text.length > 0) {
        out.push({ type: "text", text: p.text });
        continue;
      }

      if (t === "file") {
        const url = typeof p.url === "string" ? p.url : undefined;
        if (!url) continue;
        // v10.0.185 · use shared resolver so the same fallback rule
        // applies everywhere (this extractor + the chat-route replay
        // path that builds model messages).
        const mediaType = resolveMediaType(p as Record<string, unknown>, url);
        const filename = typeof p.filename === "string" ? p.filename : undefined;
        out.push({ type: "file", mediaType, url, filename });
        continue;
      }

      if (t === "image" && typeof p.image === "string") {
        const mediaType =
          typeof p.mediaType === "string"
            ? p.mediaType
            : typeof p.mimeType === "string"
              ? (p.mimeType as string)
              : "image/png";
        out.push({ type: "file", mediaType, url: p.image });
        continue;
      }

      if (t === "reasoning" && typeof p.text === "string" && p.text.length > 0) {
        out.push({ type: "reasoning", text: p.text });
        continue;
      }

      if (t === "tool-call" && typeof p.toolName === "string") {
        out.push({
          type: "tool-call",
          toolName: p.toolName,
          toolCallId: typeof p.toolCallId === "string" ? p.toolCallId : undefined,
          args: p.args,
        });
        continue;
      }

      if (t === "tool-result") {
        out.push({
          type: "tool-result",
          toolName: typeof p.toolName === "string" ? p.toolName : undefined,
          toolCallId: typeof p.toolCallId === "string" ? p.toolCallId : undefined,
          result: p.result,
        });
        continue;
      }

      if (t === "source" && typeof p.url === "string") {
        out.push({ type: "source", url: p.url, title: typeof p.title === "string" ? p.title : undefined });
        continue;
      }
    }
  }

  // If no parts came through but we have plaintext, synthesize a single
  // text part. Keeps the read path uniform (always parts-shaped).
  if (out.length === 0 && fallbackText && fallbackText.trim().length > 0) {
    out.push({ type: "text", text: fallbackText });
  }

  return out.length > 0 ? out : null;
}

/**
 * Pull just the file/image attachments from a parts tree. Used for
 * the legacy `attachments` column we kept for back-compat.
 */
export function extractAttachments(parts: MessagePart[] | null | undefined): PartFile[] {
  if (!parts) return [];
  return parts.filter((p): p is PartFile => p.type === "file");
}

/**
 * SHA-256 of the URLs in attachments, sorted for stability. Returns
 * null when there are no attachments. Used to dedupe re-uploads of
 * the same image and to look up "did this already get processed?"
 */
export function computeAttachmentsHash(attachments: readonly { url: string }[] | null | undefined): string | null {
  if (!attachments || attachments.length === 0) return null;
  const urls = attachments
    .map((a) => a.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0)
    .slice()
    .sort();
  if (urls.length === 0) return null;
  return createHash("sha256").update(urls.join("|")).digest("hex");
}

/**
 * Flatten `parts` to plaintext for the FTS index column. Includes
 * text, reasoning, tool-result summaries, and source titles. Drops
 * binary/data URLs so the index isn't bloated by base64.
 */
export function buildSearchableContent(parts: MessagePart[] | null | undefined, fallbackText?: string): string | null {
  if (!parts || parts.length === 0) {
    return fallbackText && fallbackText.trim().length > 0 ? fallbackText.trim() : null;
  }

  const chunks: string[] = [];
  for (const p of parts) {
    if (p.type === "text" && p.text) chunks.push(p.text);
    else if (p.type === "reasoning" && p.text) chunks.push(`[reasoning] ${p.text}`);
    else if (p.type === "tool-result" && p.result != null) {
      const summary = typeof p.result === "string" ? p.result : (JSON.stringify(p.result) ?? "undefined").slice(0, 800);
      chunks.push(`[tool:${p.toolName ?? "?"}] ${summary}`);
    } else if (p.type === "tool-call" && p.toolName) {
      chunks.push(`[call:${p.toolName}]`);
    } else if (p.type === "source" && (p.title || p.url)) {
      chunks.push(`[source] ${p.title ?? p.url}`);
    } else if (p.type === "file" && p.filename) {
      chunks.push(`[file] ${p.filename}`);
    }
  }
  const joined = chunks.join("\n").trim();
  return joined.length > 0 ? joined : fallbackText && fallbackText.trim().length > 0 ? fallbackText.trim() : null;
}

/**
 * Pull the client-minted message id from the incoming UIMessage if
 * present. AI SDK v6 assigns `id` per-message on the client (using
 * its `generateId` defaults — typically nanoid-shaped). We use that
 * as our idempotency key so retries (silent retry, network blip,
 * tab refresh mid-send) hit the same DB row.
 *
 * Contract — DO NOT remove this without updating the chat route's
 * upsert dedup logic:
 *   1. Client mints id once per logical user action.
 *   2. Server upserts on (conversationId, clientMessageId).
 *   3. Same id arriving twice = no-op suppress + 200.
 *
 * Falls back to undefined when:
 *   - msg is not an object
 *   - msg.id is missing / non-string / empty / > 64 chars
 * Server should then mint a deterministic fallback (see
 * synthesizeFallbackClientMessageId below).
 */
export function extractClientMessageId(msg: unknown): string | undefined {
  if (!msg || typeof msg !== "object") return undefined;
  const id = (msg as { id?: unknown }).id;
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return undefined;
  return id;
}

/**
 * v7.6 · C5 · Apr 29 — Server-side fallback idempotency key.
 *
 * When the client doesn't provide a message id (legacy clients,
 * non-SDK callers, future "raw fetch" integrations), mint one from
 * (conversationId + role + content + 10-second-rounded timestamp).
 *
 * The 10s rounding is the magic: silent retries within ~10s of the
 * original send produce the same fallback id, so the upsert
 * suppresses the dupe. Genuine separate messages (10s+ apart with
 * the same content) still get unique ids and persist normally.
 *
 * Returns a hash prefixed with "srv-" so logs can distinguish
 * client-minted ids from server fallbacks at a glance.
 */
export function synthesizeFallbackClientMessageId(args: {
  conversationId: string;
  role: string;
  content: string;
  /** Default `Date.now()`. Overridable for tests. */
  timestamp?: number;
}): string {
  const ts10s = Math.floor((args.timestamp ?? Date.now()) / 10_000) * 10;
  const composite = `${args.conversationId}|${args.role}|${args.content.slice(0, 1000)}|${ts10s}`;
  const hash = createHash("sha256").update(composite).digest("hex").slice(0, 32);
  return `srv-${hash}`;
}
