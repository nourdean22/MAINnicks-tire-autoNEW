/**
 * Warn when a condition CHANGES, not on every tick that sees it unchanged.
 *
 * Railway logs, 2026-10-30 07:14-12:55Z: 129 of 138 warnings were three lines repeating
 * unchanged every 5 or 15 minutes (railway-audit). A warning that never changes buries the
 * one that does. A key logs on its first occurrence, on every signature change (a cleared
 * condition is a change too, so its return logs), and again after `repeatAfterMs` so a
 * standing condition still shows up in a fresh log window.
 */
const last = new Map<string, { signature: string; at: number }>();

const LOG_ON_CHANGE_REPEAT_MS = 6 * 60 * 60 * 1000;

/** True when the caller should log now. Records `signature` either way. */
export function changedSinceLastLog(
  key: string,
  signature: string,
  now: number = Date.now(),
  repeatAfterMs: number = LOG_ON_CHANGE_REPEAT_MS,
): boolean {
  const prev = last.get(key);
  if (prev && prev.signature === signature && now - prev.at < repeatAfterMs) return false;
  last.set(key, { signature, at: now });
  return true;
}

/** Issue texts with their counts masked, so "1 of 25" and "2 of 26" are the same class of issue. */
export function issueClassSignature(issues: string[]): string {
  return [...new Set(issues.map((i) => i.replace(/\d+(\.\d+)?/g, "#")))].sort().join(" | ");
}
