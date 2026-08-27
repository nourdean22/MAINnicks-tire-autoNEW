/**
 * StreamingSpeechSegmenter — turns an append-only accumulating markdown
 * string (the AI SDK's streamed assistant text) into speakable spans,
 * each emitted EXACTLY once.
 *
 * Why not `split(/[.!?]/)` on the finished message: the operator hears
 * the first sentence while the rest of the reply is still generating.
 * Why not sentence terminators alone: LLM output is structured
 * markdown — paragraph breaks, list items and headings are speech
 * boundaries too, and abbreviations/decimals/URLs contain periods that
 * are NOT boundaries.
 *
 * Contract:
 *   · feed(fullText) — pass the ENTIRE accumulated text every update
 *     (exactly what React re-renders hand you). Returns only the NEW
 *     complete spans; an internal offset watermark guarantees no span
 *     is ever emitted twice, no matter how often React re-renders.
 *   · flush(fullText) — stream ended; returns everything not yet
 *     emitted (the final unterminated sentence, an unclosed code
 *     fence, a short tail below minChars).
 *   · Spans are RAW markdown slices — run each through
 *     sanitizeForSpeech() before handing to an engine.
 *
 * Invariant (tested directly): concat(emitted spans) === input text.
 */

const DEFAULT_MIN_CHARS = 24;
const DEFAULT_MAX_CHARS = 360;

/** Words whose trailing period does not end a sentence. */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "st", "jr", "sr", "vs", "etc", "approx",
  "e.g", "i.e", "no", "inc", "dept", "est", "min", "max", "sec", "ft",
  "oz", "lb", "lbs", "qty", "mi", "hr", "hrs",
]);

export interface SegmenterOptions {
  /** Spans shorter than this merge into the next boundary (flush excepted). */
  minChars?: number;
  /** A boundary is forced at the last whitespace once a span exceeds this. */
  maxChars?: number;
}

export class StreamingSpeechSegmenter {
  private offset = 0;
  private readonly minChars: number;
  private readonly maxChars: number;

  constructor(opts: SegmenterOptions = {}) {
    this.minChars = opts.minChars ?? DEFAULT_MIN_CHARS;
    this.maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  }

  feed(fullText: string): string[] {
    // A shrinking text means the message was replaced (regenerate) —
    // restart rather than emit garbage slices.
    if (fullText.length < this.offset) this.reset();

    const spans: string[] = [];
    // Loop: each pass emits at most one span; repeat until no boundary.
    for (;;) {
      const span = this.nextSpan(fullText, /* flushing */ false);
      if (span === null) break;
      spans.push(span);
    }
    return spans;
  }

  flush(fullText: string): string[] {
    if (fullText.length < this.offset) this.reset();
    const spans: string[] = [];
    for (;;) {
      const span = this.nextSpan(fullText, true);
      if (span === null) break;
      spans.push(span);
    }
    // Remaining tail — unterminated sentence, unclosed fence, short
    // fragment — all of it is emitted now; nothing is ever dropped.
    if (this.offset < fullText.length) {
      const tail = fullText.slice(this.offset);
      this.offset += tail.length;
      spans.push(tail);
    }
    return spans;
  }

  reset(): void {
    this.offset = 0;
  }

  /**
   * Find the next safe boundary after `offset`; return the span and
   * advance, or return null when no complete span is available yet.
   */
  private nextSpan(fullText: string, flushing: boolean): string | null {
    const pending = fullText.slice(this.offset);
    if (pending.length === 0) return null;

    // Fences: a fence block is held until its close, then emitted as ONE
    // atomic span (the sanitizer collapses it to "Code block omitted.").
    // `offset` therefore never sits inside a fence — no fence state to
    // desync. A fence marker only counts at line start.
    const fenceAt = findFenceMarker(pending, 0);

    if (fenceAt === 0) {
      const lineEnd = pending.indexOf("\n");
      if (lineEnd === -1) return null; // opener line still streaming
      const close = findFenceMarker(pending, lineEnd + 1);
      if (close === -1) return null; // fence still open — hold (flush() emits the tail)
      const closeLineEnd = pending.indexOf("\n", close);
      const spanEnd = closeLineEnd === -1 ? (flushing ? pending.length : -1) : closeLineEnd + 1;
      if (spanEnd === -1) return null; // closing ``` line may still be growing
      return this.take(pending, spanEnd);
    }

    let boundary = -1;
    const scanEnd = fenceAt === -1 ? pending.length : fenceAt;

    // 1 · newline boundaries — a completed markdown line (paragraph,
    // list item, heading) is always speakable.
    // 2 · sentence terminators inside the live partial line — the
    // time-to-first-audio path: paragraphs stream as one long line.
    for (let i = 0; i < scanEnd; i++) {
      const ch = pending[i];
      if (ch === "\n") {
        boundary = i + 1;
      } else if (ch === "." || ch === "!" || ch === "?") {
        const end = sentenceBoundary(pending, i, scanEnd, flushing);
        if (end !== -1) boundary = end;
      }
      if (boundary !== -1 && boundary >= this.minChars) {
        return this.take(pending, boundary);
      }
    }

    // Prose sitting before a fence opener is emittable as-is — the
    // opener itself waits for its close via the branch above.
    if (fenceAt > 0) {
      return this.take(pending, fenceAt);
    }

    // 3 · length pressure — a very long span with no boundary breaks at
    // the last whitespace so the engine never receives an unbounded blob.
    if (scanEnd > this.maxChars) {
      const cut = pending.lastIndexOf(" ", this.maxChars);
      if (cut > 0) return this.take(pending, cut + 1);
      return this.take(pending, this.maxChars);
    }

    return null;
  }

  private take(pending: string, end: number): string {
    const span = pending.slice(0, end);
    this.offset += span.length;
    return span;
  }
}

/** Index of the next ``` that begins a line (up to 3 leading spaces), or -1. */
function findFenceMarker(text: string, from: number): number {
  for (let i = from; i <= text.length - 3; i++) {
    if (text[i] === "`" && text[i + 1] === "`" && text[i + 2] === "`") {
      // must be at line start (allowing up to 3 spaces of indent)
      let j = i - 1;
      let spaces = 0;
      while (j >= 0 && text[j] === " " && spaces < 3) { j--; spaces++; }
      if (j < 0 || text[j] === "\n") return i;
      // not a line-start fence (inline ```) — skip past it
      i += 2;
    }
  }
  return -1;
}

/**
 * Is the terminator at index `i` a real sentence end? Returns the
 * boundary index (just past terminator + trailing quotes/space), or -1.
 */
function sentenceBoundary(text: string, i: number, scanEnd: number, flushing: boolean): number {
  const ch = text[i];

  if (ch === ".") {
    const prev = text[i - 1];
    const next = text[i + 1];
    // decimal (3.5) or version (1.2.3): digit on both sides
    if (prev !== undefined && next !== undefined && /\d/.test(prev) && /\d/.test(next)) return -1;
    // ellipsis interior
    if (next === ".") return -1;
    // abbreviation: word immediately before the period
    const wordStart = lastTokenStart(text, i);
    const word = text.slice(wordStart, i).toLowerCase();
    if (ABBREVIATIONS.has(word) || ABBREVIATIONS.has(word.replace(/\./g, ""))) return -1;
    // inside a URL/path token (no whitespace since scheme/www)
    const token = text.slice(wordStart, i);
    if (/^(https?:|www\.|[\w-]+\/)/.test(token) || token.includes("://")) return -1;
  }

  // Consume closing quotes/parens after the terminator.
  let end = i + 1;
  while (end < scanEnd && /["')\]]/.test(text[end])) end++;

  // A terminator is only PROVEN to end a sentence once whitespace (and,
  // unless flushing, at least one more character) has arrived after it.
  if (end >= scanEnd) return flushing ? end : -1;
  if (!/\s/.test(text[end])) return -1;
  // include the single following space so offsets stay contiguous
  return end + 1;
}

function lastTokenStart(text: string, before: number): number {
  let j = before - 1;
  while (j >= 0 && !/\s/.test(text[j])) j--;
  return j + 1;
}
