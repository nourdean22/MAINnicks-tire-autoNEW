/**
 * MEMORY CITATIONS — Apr 19.
 *
 * Goal: make Nick's replies traceable. When he says "your April 2
 * brain dump mentions X", the UI should link that claim back to the
 * actual memory row. Without citations, "Nick noticed" feels like
 * magic — with citations, it's "here's the receipt".
 *
 * How:
 *   1. Inject a short citation directive into the system prompt
 *      telling Nick HE CAN cite brain-block sources using an inline
 *      [brain:TAG] format — e.g. [brain:recall], [brain:ghost],
 *      [brain:contradiction:5d], [brain:skill:follow-up-calls].
 *   2. After the stream finishes, parse the reply for citation tags
 *      + surface them to the client (UI renders them as
 *      hover-previews or links to /brain#<source>).
 *
 * The model decides when to cite; we don't force it. On turns where
 * brain context wasn't load-bearing, no citations. On turns where it
 * was, the user sees the receipts.
 */

export interface ParsedCitation {
  raw: string;           // the full [brain:X] match
  tag: string;           // the bit after "brain:"
  category: string;      // normalized category for UI grouping
  detail?: string;       // anything after the category colon
  start: number;         // index in original text
  end: number;
}

// Known brain-block categories. Unknown tags still parse but render
// as "unknown" category in the UI.
const KNOWN_CATEGORIES = new Set([
  "recall",
  "skills",
  "skill",
  "identity",
  "ghost",
  "qualitative",
  "beliefs",
  "belief",
  "nudges",
  "nudge",
  "contradictions",
  "contradiction",
  "tasks",
  "task",
  "dump",
  "reflection",
  "law",         // strategic law citation
  "decision",
  "promise",
]);

const CITATION_RE = /\[brain:([a-z0-9_]+)(?::([^\]]+))?\]/gi;

/**
 * Extract all [brain:X] citations from a reply. Returns empty array
 * when no citations present (most casual turns).
 */
export function parseCitations(text: string): ParsedCitation[] {
  if (!text || typeof text !== "string") return [];
  const results: ParsedCitation[] = [];
  CITATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITATION_RE.exec(text)) !== null) {
    const category = m[1].toLowerCase();
    results.push({
      raw: m[0],
      tag: m[1],
      category: KNOWN_CATEGORIES.has(category) ? category : "unknown",
      detail: m[2]?.trim(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return results;
}

/**
 * Build the citation directive added to the system prompt. Short and
 * opt-in so the model only cites when it actually leaned on a block.
 */
export function buildCitationPrompt(): string {
  return `## Citation protocol
When a specific brain block drove your reply, cite it inline with [brain:TAG] format:
- [brain:recall] — past chat memory
- [brain:ghost] — ghost-nick prediction
- [brain:contradiction:5d] — "5d" = days since contradiction was flagged
- [brain:skill:follow-up-calls] — active skill by slug
- [brain:promise:nick] — overdue promise to a specific person
- [brain:law:33:1] — Greene law book:number

Only cite when you actually USED the source — don't sprinkle tags for flavor. One or two citations per reply is plenty; more is noise.`;
}

/**
 * Strip citation tags from a reply (for plain-text copy actions).
 */
export function stripCitations(text: string): string {
  if (!text) return text;
  return text.replace(CITATION_RE, "").replace(/\s{2,}/g, " ").trim();
}
