/**
 * lib/brain/display-label.ts · 2026-09-02 · brain-map legibility pass (WP-1).
 *
 * A node label and a node's full text are different things. The graph stores
 * the full text — a task title, a journal's first sentence — and the canvas
 * was asked to draw it. Measured on production 2026-09-02: P90 label length
 * 98 chars, max 297, 87 of 148 nodes over 40.
 *
 * The renderer already hard-sliced at 34 characters, so the failure was never
 * "unreadable smears" — it was a mid-word cut with no semantic head:
 *   "Create recurring Monday task 7:30-8:00 AM – Prep: email and inventory…"
 * became "Create recurring Monday task 7:30-…". This produces "Recurring
 * Monday task" instead: cut at the first structural delimiter, drop a leading
 * imperative verb, then truncate on a WORD boundary.
 *
 * $0 DOCTRINE: pure string work. No I/O, no network, no model call. The full
 * text survives as `fullLabel` — tooltips, search and detail panels use it,
 * and nothing here may be the only copy of anything.
 */

/** Max rendered characters. The canvas draws ~11px type; beyond this the label
 *  overlaps its neighbours at the 668px width measured on the MAP tab. */
export const DISPLAY_LABEL_MAX = 28;

/**
 * Structural delimiters, longest-first so ` — ` wins before ` - `.
 * Each marks "the head is the name, the tail is detail".
 */
const DELIMITERS = [" — ", " – ", " -- ", " - ", ": ", " (", ", "];

/**
 * Leading imperatives that carry no identifying information — every task
 * starts with one, so they cost 5-7 chars of a 28-char budget and make every
 * label look alike. Allowlisted deliberately: stripping arbitrary first words
 * would mangle "Review process" into "process".
 */
const LEADING_VERBS = [
  "Create", "Define", "Improve", "Copy", "Review", "Draft", "Set up", "Fix",
  "Add", "Update", "Build", "Write", "Check", "Send", "Call", "Plan",
];

/** Below this, stripping the verb would leave a stub less informative than the verb. */
const MIN_REMAINDER_AFTER_VERB = 12;

/** Scripts written without spaces between words — one character can be a word. */
const CJK_OR_HANGUL = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Truncate on a word boundary, never mid-word, appending a single ellipsis. */
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = max - 1; // leave space for the ellipsis
  const slice = text.slice(0, room);
  const lastSpace = slice.lastIndexOf(" ");
  const head = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${head.replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/**
 * Derive the short, drawable label for a graph node.
 *
 * Deterministic and idempotent: `displayLabel(displayLabel(x))` equals
 * `displayLabel(x)` for every input, which the test suite asserts — a label
 * that shrinks on every render would drift as the payload is re-shaped.
 */
export function displayLabel(raw: string | null | undefined, max: number = DISPLAY_LABEL_MAX): string {
  const original = collapse(String(raw ?? ""));
  if (!original) return "";

  // 1. Cut at the FIRST structural delimiter — keep the head.
  let head = original;
  let cutAt = -1;
  for (const d of DELIMITERS) {
    const i = original.indexOf(d);
    if (i > 0 && (cutAt === -1 || i < cutAt)) cutAt = i;
  }
  if (cutAt > 0) head = original.slice(0, cutAt);
  head = collapse(head);

  // 2. Drop a leading imperative verb when what remains still says something.
  for (const verb of LEADING_VERBS) {
    if (head.length <= verb.length) continue;
    if (!head.startsWith(verb)) continue;
    const next = head[verb.length];
    if (next !== " ") continue;
    const remainder = collapse(head.slice(verb.length + 1));
    if (remainder.length < MIN_REMAINDER_AFTER_VERB) break; // refuse: too little left
    head = remainder.charAt(0).toUpperCase() + remainder.slice(1);
    break;
  }

  // 3. Word-boundary truncation.
  let result = head.length > max ? truncateAtWord(head, max) : head;

  // 4. Anything shorter than this is noise — fall back to the original text.
  //    The threshold is script-aware: the spec's flat "< 3 chars" rule is
  //    Latin-centric and would discard a valid two-character CJK label
  //    ("目標" is a word, not a stub), so scripts without inter-word spaces
  //    only need one character to be meaningful.
  const body = result.replace(/…$/, "").trim();
  const minMeaningful = CJK_OR_HANGUL.test(body) ? 1 : 3;
  if (body.length < minMeaningful) {
    result = original.length > max ? truncateAtWord(original, max) : original;
  }
  return result;
}
