/**
 * Brief feedback (UI v3 W2, 2026-10-16): Keep / Less on the Home brief rows, stored on the device.
 *
 * No schema, no server write: the brief writer stays server-side and a client filter applies this
 * map (components/home/brief-rows.tsx via hooks/use-brief-feedback.ts). Less hides a row KIND for
 * seven days; Keep moves a row KIND up the brief for seven days (and replaces a Less). Pure over a localStorage-shaped interface (the lib/ui/change-cursor.ts
 * precedent), so the expiry and the corrupt-value paths are pinned by tests/lib/brief-feedback.test.ts
 * without a browser. A storage that throws (private mode, quota) reads as empty and writes as a no-op.
 */

export const BRIEF_FEEDBACK_KEY = "nour:brief-feedback";
export const BRIEF_LESS_TTL_MS = 7 * 86_400_000;

export type BriefVerdict = "keep" | "less";
export type BriefFeedbackMap = Record<string, { verdict: BriefVerdict; at: number }>;

export interface FeedbackStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readBriefFeedback(storage: FeedbackStorage): BriefFeedbackMap {
  try {
    const raw = storage.getItem(BRIEF_FEEDBACK_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: BriefFeedbackMap = {};
    for (const [kind, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const { verdict, at } = value as { verdict?: unknown; at?: unknown };
      if ((verdict !== "keep" && verdict !== "less") || typeof at !== "number" || !Number.isFinite(at)) continue;
      out[kind] = { verdict, at };
    }
    return out;
  } catch {
    return {};
  }
}

/** Kinds a Less still hides at `now`: the verdict is "less" and it is younger than the TTL. */
export function hiddenKinds(map: BriefFeedbackMap, now: number): string[] {
  return Object.entries(map)
    .filter(([, v]) => v.verdict === "less" && now - v.at < BRIEF_LESS_TTL_MS)
    .map(([kind]) => kind);
}

/**
 * Kinds a Keep still holds at `now`: the verdict is "keep" and it is younger than the TTL. The
 * brief reads this to move those kinds up and keep them above the "N more" fold
 * (lib/home/brief-rows.ts composeBriefRows); before 2026-10-23 nothing read a Keep.
 */
export function keptKinds(map: BriefFeedbackMap, now: number): string[] {
  return Object.entries(map)
    .filter(([, v]) => v.verdict === "keep" && now - v.at < BRIEF_LESS_TTL_MS)
    .map(([kind]) => kind);
}

/**
 * Merge one verdict into `prev` (the caller's in-memory map; a fresh read of storage when absent)
 * and persist the whole map. Merging into `prev` is what keeps a second verdict when `setItem`
 * throws: rebuilding from unchanged storage dropped the first one (review round 2).
 */
export function writeBriefVerdict(storage: FeedbackStorage, kind: string, verdict: BriefVerdict, now = Date.now(), prev?: BriefFeedbackMap): BriefFeedbackMap {
  const map: BriefFeedbackMap = { ...(prev ?? readBriefFeedback(storage)) };
  map[kind] = { verdict, at: now };
  try {
    storage.setItem(BRIEF_FEEDBACK_KEY, JSON.stringify(map));
  } catch {
    // quota or private mode: the in-memory map still applies for this page view
  }
  return map;
}

export function clearBriefFeedback(storage: FeedbackStorage): void {
  try {
    storage.setItem(BRIEF_FEEDBACK_KEY, "{}");
  } catch {
    // same as above
  }
}
