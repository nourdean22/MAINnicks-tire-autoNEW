/**
 * JOURNAL AUTO-CLASSIFIER.
 *
 * v6 · BATCH 6 · Apr 28. Reads a journal entry and tags it with one or
 * more of these categories so /journal can filter + so the brain can
 * surface the right entry at the right moment:
 *
 *   · win        — celebrating a positive outcome
 *   · struggle   — fighting through resistance, frustration, doubt
 *   · insight    — a realization, principle, learning
 *   · plan       — committing to do something
 *   · feedback   — input from another person
 *   · gratitude  — appreciation
 *   · reflection — looking back
 *   · question   — open question, unresolved
 *
 * Each category has a confidence score 0-1. An entry can have multiple
 * categories — "won the deal but it wore me out" → win + struggle.
 *
 * Lightweight regex-based + keyword density. Fast (<1ms), zero AI cost.
 * The brain's auto-linker can use these tags to find related memory:
 * recent struggles + recent insights = "what did you learn from the
 * struggle last week?" prompts.
 */

const PATTERNS = {
  win: [
    /\b(closed|landed|got it|won|nailed|crushed|signed|booked)\b/i,
    /\b(milestone|achievement|breakthrough|first\s+\w+\s+(sale|customer|invoice))\b/i,
    /[🎉🚀💪🔥]/,
  ],
  struggle: [
    /\b(struggling|fighting|exhausted|drained|frustrated|stuck|blocked|lost)\b/i,
    /\b(can'?t|couldn'?t|don'?t want to|tired of|sick of|hate)\b/i,
    /[😩😤😞]/,
  ],
  insight: [
    /\b(realized|noticed|figured out|aha|clicked|now i (see|get)|insight|learning|epiphany)\b/i,
    /\b(turns out|principle|lesson|takeaway|the trick is|what i missed)\b/i,
  ],
  plan: [
    /\b(going to|will|i'?m gonna|plan to|tomorrow|next week|by friday|by monday)\b/i,
    /\b(commit(ment)?|decided|resolution|i'?ll)\b/i,
  ],
  feedback: [
    /\b(told me|said|mentioned|advice|suggested|recommend|critique|critic)\b/i,
    /\b(nour|moe|anthony|customer|client)\s+(said|told|asked)\b/i,
  ],
  gratitude: [
    /\b(grateful|thankful|appreciate|blessed|lucky|love that|amazing of)\b/i,
    /[❤️🙏💝]/,
  ],
  reflection: [
    /\b(looking back|in retrospect|reflecting|been thinking|a year ago|months ago|used to)\b/i,
  ],
  question: [
    /\?\s*$/,
    /\b(why|how come|what if|should i|wondering|not sure|don'?t know if)\b/i,
  ],
} as const;

export type JournalCategory = keyof typeof PATTERNS;

export interface JournalClassification {
  primary: JournalCategory;
  categories: Array<{ category: JournalCategory; confidence: number }>;
  /** Sentiment heuristic — sum of positive vs negative signals */
  sentiment: number;       // -1 to 1
  wordCount: number;
  energyLevel: "low" | "medium" | "high";
}

const SENTIMENT_POSITIVE = [
  /\b(great|good|amazing|excellent|love|happy|excited|proud|grateful|thankful|win|wins|won|closed|landed)\b/i,
  /[🎉🚀💪🔥❤️🙏]/,
];
const SENTIMENT_NEGATIVE = [
  /\b(bad|terrible|frustrated|exhausted|drained|tired|hate|sick of|done|over it|broken|failed|lost)\b/i,
  /[😩😤😞💀]/,
];

const HIGH_ENERGY = /\b(rocket|crushed|smashed|pumped|fire|lock\s?in|grind)\b/i;
const LOW_ENERGY = /\b(tired|exhausted|drained|burned\s?out|done|low\s+energy)\b/i;

export function classifyJournalEntry(text: string): JournalClassification {
  const trimmed = text.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const categories: Array<{ category: JournalCategory; confidence: number }> = [];

  for (const [cat, patterns] of Object.entries(PATTERNS) as Array<[JournalCategory, readonly RegExp[]]>) {
    let hits = 0;
    for (const p of patterns) {
      if (p.test(trimmed)) hits++;
    }
    if (hits > 0) {
      const confidence = Math.min(1, hits / patterns.length + 0.2);
      categories.push({ category: cat, confidence });
    }
  }
  categories.sort((a, b) => b.confidence - a.confidence);

  // Sentiment
  let posHits = 0;
  let negHits = 0;
  for (const p of SENTIMENT_POSITIVE) if (p.test(trimmed)) posHits++;
  for (const p of SENTIMENT_NEGATIVE) if (p.test(trimmed)) negHits++;
  const totalSent = posHits + negHits;
  const sentiment = totalSent === 0 ? 0 : (posHits - negHits) / Math.max(totalSent, 1);

  // Energy heuristic
  let energyLevel: "low" | "medium" | "high" = "medium";
  if (HIGH_ENERGY.test(trimmed)) energyLevel = "high";
  if (LOW_ENERGY.test(trimmed)) energyLevel = "low";

  return {
    primary: categories[0]?.category ?? "reflection",
    categories,
    sentiment,
    wordCount,
    energyLevel,
  };
}

/**
 * Format a one-line summary of the classification — useful for log
 * lines + UI badges.
 */
export function formatClassification(c: JournalClassification): string {
  const cats = c.categories.slice(0, 3).map((x) => x.category).join("/");
  const sent = c.sentiment > 0.3 ? "positive" : c.sentiment < -0.3 ? "negative" : "neutral";
  return `${cats} · ${sent} · ${c.energyLevel} energy · ${c.wordCount}w`;
}
