/**
 * The one way client code builds a GET /api/brain/recall URL (2026-10-01).
 *
 * `preview=1` makes the route run recall read-only: no lastSeen bump (recall
 * scoring boosts memories seen in the last 14 days, so a bump changes what
 * real chat recalls) and no recall-quality metric. Both client callers are
 * views: the /brain recall preview panel and the chat memory inspector.
 * Looking at memories must not change which ones Nick recalls next. The chat
 * turn recalls server-side and keeps both writes.
 *
 * Pure and dependency-free so client bundles can import it.
 * tests/brain/recall-preview-no-side-effects.test.ts sends this URL through
 * the real route, and fails if client code builds the URL any other way.
 */
export function recallPreviewUrl(q: string, includePrompt = false): string {
  return `/api/brain/recall?q=${encodeURIComponent(q)}&limit=8&includePrompt=${includePrompt ? "1" : "0"}&preview=1`;
}
