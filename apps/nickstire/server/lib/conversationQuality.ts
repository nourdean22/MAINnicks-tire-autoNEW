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

export type StoredFact = { kind: string; value: string; evidenceText: string; confidence: number | null };

/**
 * The stored `facts` JSON (ConversationFact[], services/conversationFacts.ts) as a read surface
 * may show it: entries without a kind or value are skipped, evidenceText is cut to 240 chars, and
 * a non-numeric confidence becomes null rather than a made-up number. `evidenceSegment` is dropped:
 * it indexes a transcript this surface never returns.
 */
export function storedFacts(value: unknown): StoredFact[] {
  return jsonArray(value).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const f = raw as Record<string, unknown>;
    if (typeof f.kind !== "string" || !f.kind.trim() || typeof f.value !== "string" || !f.value.trim()) return [];
    const confidence = typeof f.confidence === "number" && Number.isFinite(f.confidence) ? f.confidence : null;
    return [{
      kind: f.kind,
      value: f.value,
      evidenceText: typeof f.evidenceText === "string" ? f.evidenceText.slice(0, 240) : "",
      confidence,
    }];
  });
}

/**
 * True when a transcript segment holds no words: empty, or only whisper's non-speech tokens
 * ([BLANK_AUDIO], [MUSIC], (banging), *noise*, music notes). A line that mixes a token with words
 * ("(laughs) yeah it is") is speech.
 */
export function isNonSpeechText(text: string): boolean {
  return /^(?:\s|\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫.…\-–—])*$/u.test(text);
}

/** Where a conversation source's microphone is, in words (eufy-office -> "Office"); anything else names itself. */
export function conversationSourceLabel(source: string): string {
  return source === "eufy-office" ? "Office" : source;
}

type TimedSegment = { start?: unknown; end?: unknown; text?: unknown };

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
      // A clip of bangs is not a covered conversation (ears-v2): non-speech tokens are not words.
      if (typeof seg.text === "string" && isNonSpeechText(seg.text)) return [];
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
