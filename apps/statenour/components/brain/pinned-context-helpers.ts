/**
 * Pure helpers for PinnedContextPanel (wave 2V review, 2026-10-19). The /pins page that this panel replaced
 * flushed the prompt cache after a pin write and the chat "View pin" receipt scrolls to #pin-<id>; both live
 * here so they can be asserted without rendering the panel (tests/components/pinned-context-helpers.test.ts).
 */

/**
 * Create a pin, then flush the prompt cache so the next chat turn sees it instead of waiting out the TTL.
 * The flush is fire-and-forget: it runs only after a successful create and can never fail the pin.
 */
export async function createPinThenFlush<I, R>(
  create: (input: I) => Promise<R>,
  flush: (input: { reason: string }) => void,
  input: I,
): Promise<R> {
  const created = await create(input);
  try {
    flush({ reason: "pin write (manual)" });
  } catch {
    /* a flush failure must not fail the pin: the cache expires on its own TTL */
  }
  return created;
}

/** The element id a `#pin-<id>` hash points at, or null for any other hash. */
export function pinHashTarget(hash: string): string | null {
  const m = /^#(pin-.+)$/.exec(hash);
  return m ? m[1] : null;
}
