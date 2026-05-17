/**
 * Shared similarity primitives — keyword tokenization + Jaccard index.
 *
 * v11.0 cleanup: previously duplicated in 3 places
 *   · app/api/system/ghost-nour/route.ts
 *   · lib/ai/tools.ts (checkAntiPattern handler)
 *   · (future) /api/system/anti-patterns matching logic
 *
 * Kept small on purpose. Upgrade path is embedding-based semantic
 * search (lib/brain/embedding-utils.ts) when cross-paraphrase matching
 * becomes worth the cost. Until then, Jaccard is fast, free, and good
 * enough for rhyming-intent detection.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were",
  "i", "me", "my", "we", "our", "you", "your", "they", "them",
  "to", "of", "in", "on", "for", "at", "from", "with", "by",
  "about", "as", "this", "that", "these", "those", "it", "its",
  "should", "would", "could", "will", "do", "does", "did", "have",
  "has", "had", "be", "been", "being", "not", "no", "if", "when",
  "what", "which", "who", "how", "why", "so", "than", "then",
]);

/**
 * Tokenize text into a Set of meaningful lowercase words.
 * - Lowercases.
 * - Strips punctuation.
 * - Drops tokens < 3 chars.
 * - Drops stopwords.
 */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  );
}

/**
 * Jaccard similarity between two token sets · |A ∩ B| / |A ∪ B|.
 * Returns 0 for either set empty (no false positives on trivial text).
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Convenience: tokenize two strings + return their Jaccard score. */
export function similarity(a: string, b: string): number {
  return jaccard(tokenize(a), tokenize(b));
}
