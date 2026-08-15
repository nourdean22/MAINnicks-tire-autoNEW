/**
 * Session video registry (BDN-320) — url → VideoDB videoId.
 *
 * THE PROBLEM THIS SOLVES, AND ITS HONEST LIMIT
 * A transcript is fetched by VideoDB `videoId`. The chat message only
 * carries a `file` part — `{ url, mediaType, filename }` — with nowhere
 * to put an id. The composer DOES know both, because the upload route
 * returns them together, so this registers the pair at upload time.
 *
 * ★ IN-MEMORY AND SESSION-SCOPED ON PURPOSE.
 * After a reload this map is empty, and the transcript pane will say the
 * transcript is unavailable for older media. That is a real limitation
 * and it is stated rather than papered over:
 *
 *   - Persisting to localStorage would build a durable index of watched
 *     media as a side effect, which is the boundary item #7 draws.
 *   - Parsing the videoId out of the stream URL would be a GUESS. The
 *     URL format was not verifiable without a live key, and a parse that
 *     silently returns the wrong id is worse than admitting we have none.
 *
 * The durable fix is for the `file` part to carry the id — which means
 * changing the message-part contract, and that is a bigger change than a
 * transcript pane should smuggle in.
 */

const urlToVideoId = new Map<string, string>();

/** Record the pair the upload route returned. */
export function registerVideoId(url: string, videoId: string): void {
  if (!url?.trim() || !videoId?.trim()) return;
  urlToVideoId.set(url, videoId);
}

/** null = we do not know it, which is different from "no transcript". */
export function videoIdForUrl(url: string | undefined): string | null {
  if (!url) return null;
  return urlToVideoId.get(url) ?? null;
}
