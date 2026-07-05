/**
 * cognitive-partner-brief · once-per-day gate for the proactive
 * "morning brief" LLM stream.
 *
 * The CognitivePartner dock auto-fires an LLM stream on mount when it
 * has no messages. But useChat state does not survive unmount/remount,
 * so `messages.length === 0` is true on EVERY visit — which meant a paid
 * LLM stream fired on every Home mount. This helper day-stamps the last
 * fire in localStorage so the brief fires at most once per calendar day.
 *
 * The decision logic (`shouldFireBrief`) is pure and unit-tested; the
 * localStorage read/write wrappers are SSR-guarded + try/catch per the
 * repo idiom (see components/ultron/ask/omni-capture.tsx).
 */

export const BRIEF_STORAGE_KEY = "nour:cognitive-partner-brief";

/** Today's date as an ISO calendar day (YYYY-MM-DD). */
export function todayStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Pure decision: should the proactive brief fire?
 *
 * @param lastStamp  the YYYY-MM-DD stamp from the last fire, or null if
 *                   never fired / unreadable storage.
 * @param today      today's YYYY-MM-DD stamp.
 * @returns true only when today differs from the last recorded fire.
 */
export function shouldFireBrief(lastStamp: string | null, today: string): boolean {
  return lastStamp !== today;
}

/** Read the last-fired day stamp. SSR-safe; returns null on any failure. */
export function readBriefStamp(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(BRIEF_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Record that the brief fired today. SSR-safe; swallows storage errors. */
export function markBriefFired(today: string = todayStamp()): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BRIEF_STORAGE_KEY, today);
  } catch {
    /* ignore — a failed write just means the brief may re-fire */
  }
}
