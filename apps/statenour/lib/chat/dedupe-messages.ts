/**
 * Dedupe an array of messages by id, keeping the LAST occurrence of
 * any duplicate so the freshest stream state wins. The AI SDK's
 * internal state can momentarily hold the same message twice during
 * reconnects / strict-mode double-mounts / HMR replays — React throws
 * duplicate-key warnings and the chat UI goes spotty if we pass those
 * straight through.
 *
 * This defensive dedupe runs O(n) and is a pure function so React's
 * render is deterministic even when the underlying store isn't.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · was a
 * top-level function in the page module · lifted out so the unit
 * tests can import it directly and the page module shrinks.
 */
export function dedupeMessages<T extends { id?: string }>(messages: T[]): T[] {
  const seen = new Map<string, number>();
  // First pass — record the LAST index for each id
  messages.forEach((m, i) => {
    if (!m.id) return;
    seen.set(m.id, i);
  });
  // Second pass — keep only the last occurrence and any id-less items
  return messages.filter((m, i) => {
    if (!m.id) return true;
    return seen.get(m.id) === i;
  });
}
