/**
 * extract-message-text · v10.0.272 · centralized helper for pulling
 * the text content out of a chat Message.
 *
 * The /chat page had 4 inline copies of
 *   const parts = (msg as unknown as { parts?: Array<{ type: string; text?: string }> }).parts || [];
 *   const text = parts.filter(p => p.type === 'text' && typeof p.text === 'string')
 *                     .map(p => p.text as string).join(' ').trim();
 *
 * Same shape, same casts, 4× duplication. Centralized here so:
 *   · Each call site is 1 line instead of 6
 *   · The unsafe cast lives in one place (the function boundary)
 *   · Future Message-shape changes (e.g. AI SDK version bump) only
 *     touch this file
 *
 * Why the cast at all? AI SDK v6 UIMessage has `parts: UIMessagePart[]`
 * but the `useChat()` return type erases the discriminated-union of
 * UIMessagePart inside `parts`. We cast to a minimal known-shape
 * (only the fields we actually read) instead of pulling in the full
 * UIMessage type which would couple us to AI SDK internals.
 */

interface MessageLike {
  parts?: Array<{ type: string; text?: string }>;
}

/**
 * Concatenates the text parts of a chat message into a single string.
 * Returns "" if the message has no parts or no text parts.
 */
export function extractMessageText(msg: unknown): string {
  const parts = (msg as MessageLike).parts ?? [];
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join(" ")
    .trim();
}

/**
 * Returns the raw parts array of a chat message (or [] if none).
 * Use when callers need to iterate parts directly (e.g., to count
 * tool-call parts vs text parts).
 */
export function getMessageParts(
  msg: unknown,
): Array<{ type: string; text?: string }> {
  return (msg as MessageLike).parts ?? [];
}
