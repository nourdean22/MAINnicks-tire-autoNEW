/**
 * Helpers for conversation-episode read surfaces.
 *
 * MySQL/TiDB JSON columns can arrive either as parsed arrays or JSON strings depending
 * on the driver path. Keep that ambiguity at one boundary instead of teaching every
 * caller how to parse it.
 */
export function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type TimedSegment = { start?: unknown; end?: unknown };

/**
 * Fraction of the clip covered by transcript segments, using the UNION of intervals.
 *
 * This deliberately distinguishes:
 * - null: coverage cannot be known (no valid clip duration)
 * - 0: duration is known and no valid transcript interval covered it
 *
 * Overlap is counted once and segments are clamped to the clip. Those details matter:
 * diarizers/transcribers can emit overlapping windows, and naively summing durations can
 * produce reassuring coverage above 100%.
 */
export function transcriptCoverage(
  transcript: unknown,
  totalSeconds: unknown,
): number | null {
  if (totalSeconds === null || totalSeconds === undefined) return null;
  const total = Number(totalSeconds);
  if (!Number.isFinite(total) || total <= 0) return null;

  const intervals = jsonArray(transcript)
    .flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const seg = raw as TimedSegment;
      const start = Number(seg.start);
      const end = Number(seg.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
      const clampedStart = Math.max(0, Math.min(total, start));
      const clampedEnd = Math.max(0, Math.min(total, end));
      return clampedEnd > clampedStart ? [[clampedStart, clampedEnd] as const] : [];
    })
    .sort((a, b) => a[0] - b[0]);

  if (!intervals.length) return 0;

  let covered = 0;
  let [start, end] = intervals[0];
  for (const [nextStart, nextEnd] of intervals.slice(1)) {
    if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      covered += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  covered += end - start;

  return Math.max(0, Math.min(1, covered / total));
}
