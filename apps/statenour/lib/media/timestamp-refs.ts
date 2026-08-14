/**
 * Timestamp references in Nick's replies (BDN-312) — media plan item #3.
 *
 * THE PLAN'S CORE RULE
 * "When Nick answers a question about a video, show the exact time range
 * used. That creates a real evidence trail instead of pretending the
 * model watched the entire file." This module is the reader for that:
 * it finds the time references in a reply so they can be rendered as
 * seek controls against the docked player.
 *
 * WHY PARSING AND NOT A STRUCTURED FIELD
 * A structured citation field would be better and is the right endpoint.
 * It is not reachable yet: `getTranscript` (lib/videodb/client.ts) reads
 * only `json.transcript ?? json.text` and returns a FLAT STRING, so no
 * segment or word-level timing survives the client today. Until that
 * changes there is nothing for the model to cite from, and inventing a
 * citation schema the pipeline cannot populate would be building a
 * receipt with no evidence behind it. Parsing what the model actually
 * writes is the honest interim.
 *
 * FALSE POSITIVES ARE THE WHOLE DIFFICULTY
 * "3:1" is a ratio. "John 3:16" is a verse. "10:30am" is a clock time.
 * "$4:99" is a typo for a price. A seek control on any of those is worse
 * than no control, because it teaches the operator that the timestamps
 * lie. The guards below are deliberately strict and will MISS some real
 * references rather than manufacture fake ones — a missed timestamp is
 * invisible, a wrong one is a broken promise.
 *
 * Pure: no I/O, no clock, no DOM.
 */

export interface TimestampRef {
  /** Start offset in seconds. */
  start: number;
  /** End offset in seconds, when the model wrote a range. */
  end?: number;
  /** The literal text matched, for rendering the label as written. */
  raw: string;
}

/**
 * A single time token: M:SS, MM:SS, or H:MM:SS (and HH:MM:SS).
 * Seconds are ALWAYS exactly two digits — this is the guard that rejects
 * "3:1" and most ratios.
 */
const TIME_TOKEN = String.raw`\d{1,2}:[0-5]\d(?::[0-5]\d)?`;

/**
 * A range is two time tokens joined by a dash (hyphen, en, em) or "to".
 * Matched BEFORE singles so "04:12–05:03" is one range, not two points.
 */
const RANGE_RE = new RegExp(
  String.raw`(?<![\w:])(${TIME_TOKEN})\s*(?:[-–—]|to)\s*(${TIME_TOKEN})(?![\w:])`,
  "g",
);

const SINGLE_RE = new RegExp(String.raw`(?<![\w:])(${TIME_TOKEN})(?![\w:])`, "g");

/**
 * Contexts that disqualify a match even when it looks like a time.
 * Checked against the characters immediately following the token.
 */
// Dotted forms FIRST and without a trailing \b: "p.m." ends in a period,
// and a period followed by a space is not a word boundary, so `p\.m\.\b`
// never matches. Only the bare forms need the boundary, to avoid eating
// the "am" in "ambient".
const CLOCK_SUFFIX_RE = /^\s*(?:a\.m\.|p\.m\.|am\b|pm\b)/i;

/**
 * Words immediately before a token that mean it is not a media offset.
 * Chapter-and-verse and score contexts are the common ones.
 */
const DISQUALIFYING_PREFIX_RE =
  /\b(?:john|matthew|mark|luke|acts|romans|genesis|psalm|psalms|isaiah|verse|chapter|score|ratio|odds)\s+$/i;

/** "1:02:33" → 3753 · "4:12" → 252. Returns null if out of range. */
export function parseTimeToken(token: string): number | null {
  const parts = token.split(":").map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return null;

  if (parts.length === 2) {
    const [m, s] = parts;
    if (s > 59) return null;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts;
    if (m > 59 || s > 59) return null;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

/** Seconds → "4:12" / "1:02:33". Used for labels we generate ourselves. */
export function formatTimestamp(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

function isDisqualified(text: string, matchIndex: number, matchLength: number): boolean {
  const after = text.slice(matchIndex + matchLength, matchIndex + matchLength + 6);
  if (CLOCK_SUFFIX_RE.test(after)) return true;
  const before = text.slice(Math.max(0, matchIndex - 24), matchIndex);
  if (DISQUALIFYING_PREFIX_RE.test(before)) return true;
  // A currency symbol immediately before is never a media offset.
  if (/[$£€]\s*$/.test(before)) return true;
  return false;
}

/**
 * Extract every media time reference from a reply, ranges first.
 *
 * Ordered by position in the text and de-duplicated on (start, end), so
 * a model that repeats "04:12" three times yields one control. Overlaps
 * are resolved in favor of the RANGE — a range carries strictly more
 * information than either endpoint alone.
 */
export function parseTimestampRefs(text: string): TimestampRef[] {
  const input = text ?? "";
  if (!input) return [];

  const refs: Array<TimestampRef & { index: number; length: number }> = [];
  const claimed: Array<[number, number]> = [];

  for (const m of input.matchAll(RANGE_RE)) {
    const index = m.index ?? 0;
    const span: [number, number] = [index, index + m[0].length];
    // Claim the span even when the range is REJECTED. Otherwise the
    // singles pass below re-matches both endpoints and a range we
    // deliberately refused comes back as two seek controls — which is
    // exactly the wrong-control failure this parser exists to avoid.
    claimed.push(span);

    if (isDisqualified(input, index, m[0].length)) continue;
    const start = parseTimeToken(m[1]);
    const end = parseTimeToken(m[2]);
    if (start === null || end === null) continue;
    // A backwards range is a model error, not a seek target.
    if (end < start) continue;
    refs.push({ start, end, raw: m[0], index, length: m[0].length });
  }

  for (const m of input.matchAll(SINGLE_RE)) {
    const index = m.index ?? 0;
    // Skip anything already inside a matched range.
    if (claimed.some(([lo, hi]) => index >= lo && index < hi)) continue;
    if (isDisqualified(input, index, m[0].length)) continue;
    const start = parseTimeToken(m[1]);
    if (start === null) continue;
    refs.push({ start, raw: m[0], index, length: m[0].length });
  }

  refs.sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  const out: TimestampRef[] = [];
  for (const r of refs) {
    const key = `${r.start}:${r.end ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ start: r.start, end: r.end, raw: r.raw });
  }
  return out;
}
