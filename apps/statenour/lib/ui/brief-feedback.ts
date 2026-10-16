/**
 * Brief feedback (UI v3 W2, 2026-10-16): Keep / Less on the Home brief rows, stored on the device.
 *
 * No schema, no server write: the brief writer stays server-side and a client filter applies this
 * map (components/home/brief-rows.tsx via hooks/use-brief-feedback.ts). Less hides a row KIND for
 * seven days; Keep clears it. Pure over a localStorage-shaped interface (the lib/ui/change-cursor.ts
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

export function writeBriefVerdict(storage: FeedbackStorage, kind: string, verdict: BriefVerdict, now = Date.now()): BriefFeedbackMap {
  const map = readBriefFeedback(storage);
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
