/** Shared query normalization for the direct brain-search tools. */

const SEARCH_STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "all", "any", "can",
  "had", "has", "have", "was", "were", "will", "with", "that", "this", "these",
  "those", "there", "their", "then", "than", "them", "they", "what", "whats",
  "when", "where", "which", "who", "why", "how", "did", "does", "doing", "don",
  "dont", "cant", "wont", "just", "like", "about", "into", "over", "some", "still",
  "been", "being", "would", "could", "should", "very", "also", "out", "get", "got",
  "going", "gonna", "know", "need", "want", "make", "made", "much", "many", "more",
  "most", "even", "ever", "never", "now", "one", "two", "say", "said", "see", "tell",
  "told", "think", "thing", "things", "really", "right", "yeah", "okay", "well", "way",
  "back", "off", "too", "let", "lets",
]);

/** Maps a natural-language memory query to the key convention used by pins. */
export function normalizeMemoryKeyQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Broadens multi-word FTS queries without sending conversational filler to
 * Postgres. A single meaningful term is unchanged; multiple terms use OR so
 * one missing word cannot erase a real memory hit.
 */
export function buildBroadSearchFtsQuery(query: string): string {
  const terms = (query.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) ?? [])
    .map((term) => term.replace(/^'+|'+$/g, ""))
    .filter((term, index, all) => term.length >= 3 && !SEARCH_STOPWORDS.has(term) && all.indexOf(term) === index);
  return terms.length > 0 ? terms.join(" or ") : query.trim();
}
