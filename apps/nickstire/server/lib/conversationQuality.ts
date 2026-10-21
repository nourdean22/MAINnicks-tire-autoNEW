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

/** [..], (..) and *..* tags as whisper writes them around sounds. */
const TAG = /\[([^\]]*)\]|\(([^)]*)\)|\*([^*]*)\*/g;

/**
 * A tag is a SOUND when its inner text is short and is not a "Speaker: words" line: "(banging)",
 * "[BLANK_AUDIO]", "(door slams)". "(Customer: I'm going to Firestone)" is speech the transcriber
 * bracketed, and is kept (skeptic review of #3213).
 */
function isSoundTag(inner: string): boolean {
  const t = inner.trim();
  return !t.includes(":") && t.split(/\s+/).filter(Boolean).length <= 4;
}

/**
 * True when a transcript segment holds no words: empty, or only sound tags ([BLANK_AUDIO],
 * [MUSIC], (banging), *noise*) and music notes. A line that mixes a tag with words ("(laughs)
 * yeah it is") or brackets real speech is speech.
 */
export function isNonSpeechText(text: string): boolean {
  let words = false;
  const rest = text.replace(TAG, (_m, a?: string, b?: string, c?: string) => {
    if (!isSoundTag(a ?? b ?? c ?? "")) words = true;
    return " ";
  });
  return !words && /^[\s♪♫.…\-–—]*$/u.test(rest);
}

/** The segment's words with sound tags removed; a bracketed speech line keeps its words. */
export function heardText(text: string): string {
  return text.replace(TAG, (_m, a?: string, b?: string, c?: string) => {
    const inner = a ?? b ?? c ?? "";
    return isSoundTag(inner) ? " " : ` ${inner} `;
  });
}

/**
 * Cut to `max` characters without leaving a guess or a gap open: a cut inside "(inferred: ..."
 * would render the rest of the guess as heard (Codex on #3213). The cut goes before any marker
 * still open at the limit and ends " (cut)". Used for the stored account and the digest's input.
 */
export function cutAtMarkerBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const suffix = " (cut)";
  let cut = text.slice(0, Math.max(0, max - suffix.length));
  for (const [open, close] of [["(inferred:", ")"], ["[inaudible:", "]"]] as const) {
    const at = cut.lastIndexOf(open);
    if (at >= 0 && !cut.includes(close, at)) cut = cut.slice(0, at);
  }
  return cut.trimEnd() + suffix;
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
  const covered = speechCoveredSeconds(transcript, totalSeconds);
  return covered === null ? null : Math.max(0, Math.min(1, covered / Number(totalSeconds)));
}

/**
 * Seconds of the clip covered by SPEECH segments (same union, clamping and non-speech rule as
 * transcriptCoverage). The route measures this itself and gives it to the extractor's coverage
 * gate (Codex on #3213): the producer's coveredSeconds counts [BLANK_AUDIO] and (banging) spans.
 * null when the clip duration is unknown.
 */
export function speechCoveredSeconds(transcript: unknown, totalSeconds: unknown): number | null {
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

  return Math.max(0, Math.min(total, covered));
}
