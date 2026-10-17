/**
 * The one reader for chat-history text. A history message is either a v6
 * UIMessage (`parts`, no `content`: what app/api/ai/chat/route.ts sends) or a
 * legacy `{ role, content }`. Kept apart from gate.ts (which re-exports it) so
 * a reader in the brain lane does not pull the gate's rate-limit and budget
 * imports. Do not copy this: import it.
 */

/** Both history shapes. A `.content` read on this union fails typecheck on purpose. */
export type ChatHistoryMessage =
  | { role: string; content: string }
  | { id?: string; role: string; parts: ReadonlyArray<{ type: string; text?: string }> };

/**
 * Extract plain text from a UIMessage. Handles both legacy string
 * content + v6 parts arrays. Tolerant of malformed input.
 */
export function extractText(message: object): string {
  const msg = (message ?? {}) as Record<string, unknown>;
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.parts)) {
    const textParts = (msg.parts as Array<Record<string, unknown>>)
      .filter((p) => p?.type === "text" && typeof p?.text === "string")
      .map((p) => p.text as string);
    if (textParts.length > 0) return textParts.join(" ");
  }
  if (msg.content != null) return JSON.stringify(msg.content);
  return "";
}
