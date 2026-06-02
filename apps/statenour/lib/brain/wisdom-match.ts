/**
 * lib/brain/wisdom-match.ts · 2026-06-02
 *
 * Shared keyword-Jaccard wisdom matcher. Extracted (zero-behavior-change)
 * from the byte-identical matching loops that lived in:
 *   · lib/services/auto-learn.ts        (tryWisdomCitation Jaccard fallback)
 *   · lib/services/decision-replay-coach.ts (matchWisdom)
 *
 * Both callers tokenize a query, scan BrainMemory(category="wisdom"),
 * score each wisdom by `(shared tokens / query tokens) × personaBoost ×
 * max(0.5, confidence)`, and keep the single highest scorer. The ONLY
 * things that differed were tunable constants (scan limit + preferred-
 * persona list, 6 vs 4 names) and the SIMILARITY-FLOOR POLICY — which
 * is deliberately left to the caller: auto-learn floored the raw score,
 * decision-replay floored the 3-decimal-rounded score. This matcher
 * therefore does NO floor filtering · it returns the top match (raw
 * score) and the caller applies its own floor on its own rounding. That
 * keeps BOTH callers' behavior byte-identical to their prior inline loops.
 *
 * The match returns a rich row (id + content + confidence + score +
 * persona); each caller maps it to its own return shape (auto-learn's
 * WisdomCitation vs decision-replay's MatchedWisdom).
 *
 * Skills applied · kaizen (dedup with zero behavior change) · satori
 * (pgvector-free wisdom matching with persona boost).
 */

import { prisma } from "@/lib/prisma";
import { activeOnly } from "@/lib/db/soft-delete";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/** Default stopwords removed before keyword scoring. Both prior callers
 *  used this exact set; callers may override via opts.stopwords. */
export const DEFAULT_WISDOM_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "for", "of",
  "to", "in", "on", "at", "by", "with", "from", "is", "was", "are",
  "were", "be", "been", "being", "have", "has", "had", "do", "does",
  "did", "will", "would", "could", "should", "may", "might", "i",
  "you", "we", "they", "it", "this", "that", "these", "those", "so",
  "as", "than", "too", "very", "more", "less", "my", "your", "our",
]);

export interface MatchWisdomOptions {
  /** Max wisdoms scanned (DB `take`). */
  scanLimit: number;
  /** Wisdom key prefixes that get a 1.25× citation boost. */
  preferredPersonas: readonly string[];
  /** Stopword set; defaults to DEFAULT_WISDOM_STOPWORDS. */
  stopwords?: ReadonlySet<string>;
}

/** A scored wisdom match · richer than either caller's public shape so
 *  each can map it to its own (auto-learn → WisdomCitation,
 *  decision-replay → MatchedWisdom). */
export interface WisdomMatch {
  id: string;
  key: string;
  content: string;
  confidence: number;
  /** baseSim × personaBoost × max(0.5, confidence) · rounded by caller. */
  score: number;
  /** Capitalized persona name parsed from the wisdom key, or null. */
  persona: string | null;
}

/**
 * Tokenize → lowercase → strip non-alphanumerics → drop stopwords +
 * tokens shorter than 4 chars → dedupe (first-seen wins) → cap at 16.
 * Identical to the prior private `extractKeywords` in both callers.
 */
export function extractKeywords(
  text: string,
  stopwords: ReadonlySet<string> = DEFAULT_WISDOM_STOPWORDS,
): string[] {
  if (!text) return [];
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !stopwords.has(t));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 16) break;
  }
  return out;
}

/** True when the wisdom key starts with `wisdom_<persona>` for any
 *  persona in the preferred list. */
export function isPreferredPersonaKey(
  key: string,
  preferredPersonas: readonly string[],
): boolean {
  return preferredPersonas.some((p) => key.startsWith(`wisdom_${p}`));
}

/** Parses the capitalized persona name from a `wisdom_<persona>...` key. */
export function personaFromKey(key: string): string | null {
  const m = key.match(/^wisdom_([a-z]+)/i);
  if (!m?.[1]) return null;
  const name = m[1]!;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Finds the single best-matching wisdom for `text` via keyword Jaccard
 * + persona boost + confidence weighting. Returns null when the query
 * has no usable tokens, no wisdoms exist, or nothing shares a token.
 *
 * No similarity-floor filtering here — the caller applies its own floor
 * (see module header). The returned `score` is raw (unrounded).
 */
export async function matchWisdom(
  text: string,
  opts: MatchWisdomOptions,
): Promise<WisdomMatch | null> {
  const stopwords = opts.stopwords ?? DEFAULT_WISDOM_STOPWORDS;
  const queryTokens = new Set(extractKeywords(text, stopwords));
  if (queryTokens.size === 0) return null;

  const wisdoms = await prisma.brainMemory
    .findMany({
      where: activeOnly({
        category: BRAIN_CATEGORIES.WISDOM,
        confidence: { gte: 0.5 },
      }),
      orderBy: { confidence: "desc" },
      take: opts.scanLimit,
      select: { id: true, key: true, content: true, confidence: true },
    })
    .catch((): never[] => []);

  if (wisdoms.length === 0) return null;

  let best: WisdomMatch | null = null;
  let bestScore = 0;

  for (const w of wisdoms as Array<{
    id: string;
    key: string;
    content: string;
    confidence: number;
  }>) {
    const wTokens = new Set(extractKeywords(w.content, stopwords));
    if (wTokens.size === 0) continue;
    let shared = 0;
    for (const t of queryTokens) {
      if (wTokens.has(t)) shared++;
    }
    if (shared === 0) continue;
    const baseSim = shared / queryTokens.size;
    const personaBoost = isPreferredPersonaKey(w.key, opts.preferredPersonas)
      ? 1.25
      : 1.0;
    const score = baseSim * personaBoost * Math.max(0.5, w.confidence);
    if (score > bestScore) {
      bestScore = score;
      best = {
        id: w.id,
        key: w.key,
        content: w.content,
        confidence: w.confidence,
        score,
        persona: personaFromKey(w.key),
      };
    }
  }

  return best;
}
