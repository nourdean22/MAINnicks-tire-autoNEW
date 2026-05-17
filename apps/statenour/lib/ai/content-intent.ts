/**
 * CONTENT INTENT DETECTOR — layered, explainable, defensive.
 *
 * v6 · Apr 28 · Apr 28 router-upgrade pass. Replaces the brittle
 * single-regex `detectContentIntent` in business-knowledge.ts with a
 * 3-layer pipeline:
 *
 *   1. SCORE-BASED KEYWORDS — weighted vocabulary, verb-position aware,
 *      negation aware. Always runs. Cheap (~50µs).
 *
 *   2. MULTI-SIGNAL ADJUSTMENT — imperative verbs near content nouns,
 *      previous-turn context (was the model just generating a post?),
 *      message length, question-vs-imperative shape, slang catch-all
 *      ("for the gram", "IG", "DM blast"). Always runs. ~50µs.
 *
 *   3. EMBEDDING FALLBACK — when score lands in the ambiguous middle
 *      band (0.3-0.7), embed the user message + cosine-similarity vs
 *      ~30 example content queries. Cached by message hash for 5min.
 *      Only runs on ambiguous turns (~10% of traffic). ~80ms cost when
 *      it does fire.
 *
 * Output: { isContent, confidence, reasons[], usedEmbedding }
 *
 * The chat route + system-prompt builder call this; the diagnostics
 * page (/system/prompt) renders `reasons` so Nour can see exactly why
 * a query did or didn't trigger content mode.
 */

// v6 · Apr 28 hotfix — was `import { createHash } from "node:crypto"`
// which broke the client bundle (chat page imports auto-fire-gate ->
// content-intent). Cache keys don't need cryptographic strength —
// switched to inline FNV-1a hash so this file is fully isomorphic.
function fnv1aHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ─────────────────────────────────────────────────────────────────────
// LAYER 1 — Weighted keywords + verb-position
// ─────────────────────────────────────────────────────────────────────
//
// Each keyword has a weight 1-10. "instagram post" both fire = 18 pts.
// Verb-position bonus: "create a POST" (verb) > "the post office" (noun).
// Negation suppression: "I'm not asking for a post" → score = 0.

interface KeywordEntry {
  /** Word or phrase. Tested as a regex with word boundaries. */
  pattern: string;
  /** Base points if the word appears anywhere. */
  weight: number;
  /** Bonus if the word appears as a verb (preceded by imperative or as first word). */
  verbBonus?: number;
  /** Multi-word patterns get higher weight by default (less noise). */
  multiword?: boolean;
}

const KEYWORDS: KeywordEntry[] = [
  // ── Tier A: high-signal multi-word phrases (very specific) ──
  { pattern: "instagram post", weight: 10, multiword: true },
  { pattern: "facebook post", weight: 10, multiword: true },
  { pattern: "ig post", weight: 10, multiword: true },
  { pattern: "social media post", weight: 10, multiword: true },
  { pattern: "social post", weight: 9, multiword: true },
  { pattern: "marketing copy", weight: 10, multiword: true },
  { pattern: "ad copy", weight: 10, multiword: true },
  { pattern: "brand voice", weight: 9, multiword: true },
  { pattern: "content engine", weight: 9, multiword: true },
  { pattern: "content plan", weight: 9, multiword: true },
  { pattern: "content calendar", weight: 9, multiword: true },
  { pattern: "ad campaign", weight: 9, multiword: true },
  { pattern: "marketing campaign", weight: 9, multiword: true },
  { pattern: "google business profile", weight: 9, multiword: true },
  { pattern: "gbp post", weight: 10, multiword: true },
  { pattern: "for the gram", weight: 10, multiword: true }, // slang
  { pattern: "for instagram", weight: 8, multiword: true },
  { pattern: "for facebook", weight: 8, multiword: true },
  { pattern: "for tiktok", weight: 8, multiword: true },
  { pattern: "for ig", weight: 9, multiword: true },
  { pattern: "for the gbp", weight: 9, multiword: true },
  { pattern: "dm blast", weight: 9, multiword: true },
  { pattern: "email blast", weight: 8, multiword: true },
  { pattern: "blog post", weight: 9, multiword: true },
  // Nick's-Tire-specific brand asks (pulled from brand_rules.md)
  { pattern: "seasonal safety", weight: 8, multiword: true },
  { pattern: "winter safety", weight: 8, multiword: true },
  { pattern: "myth busting", weight: 8, multiword: true },
  { pattern: "myth-busting", weight: 8, multiword: true },
  { pattern: "alert post", weight: 9, multiword: true },
  { pattern: "warning post", weight: 9, multiword: true },
  { pattern: "shop floor", weight: 5, multiword: true }, // mild — could be ambient
  { pattern: "before and after", weight: 8, multiword: true },
  { pattern: "before/after", weight: 8, multiword: true },
  { pattern: "customer story", weight: 9, multiword: true },
  { pattern: "customer wins", weight: 9, multiword: true },
  { pattern: "customer testimonial", weight: 9, multiword: true },
  { pattern: "review post", weight: 9, multiword: true },
  // Service-specific content asks (high signal when paired with imperative)
  { pattern: "tire post", weight: 9, multiword: true },
  { pattern: "brake post", weight: 9, multiword: true },
  { pattern: "alignment post", weight: 9, multiword: true },
  { pattern: "oil change post", weight: 9, multiword: true },
  { pattern: "battery post", weight: 9, multiword: true },
  { pattern: "rotation post", weight: 9, multiword: true },
  { pattern: "diagnostic post", weight: 9, multiword: true },
  { pattern: "spring sale", weight: 7, multiword: true },
  { pattern: "spring promo", weight: 8, multiword: true },
  { pattern: "winter promo", weight: 8, multiword: true },
  { pattern: "summer special", weight: 8, multiword: true },
  // Nour's actual phrasing patterns
  { pattern: "hit me with", weight: 6, multiword: true }, // "hit me with a post"
  { pattern: "throw together", weight: 6, multiword: true },
  { pattern: "spit out", weight: 5, multiword: true },
  { pattern: "spin up", weight: 5, multiword: true },
  { pattern: "whip up", weight: 6, multiword: true },
  { pattern: "knock out", weight: 5, multiword: true }, // "knock out a post"
  { pattern: "shoot out", weight: 5, multiword: true },
  { pattern: "drop in the queue", weight: 9, multiword: true },
  { pattern: "for buffer", weight: 9, multiword: true },
  { pattern: "schedule a post", weight: 10, multiword: true },
  { pattern: "tag a friend", weight: 5, multiword: true }, // banned but if asked
  { pattern: "swipe up", weight: 6, multiword: true },
  { pattern: "stop in cta", weight: 9, multiword: true },
  { pattern: "stop by today", weight: 6, multiword: true },
  { pattern: "call to action", weight: 8, multiword: true },

  // ── Tier B: medium-signal single words ──
  { pattern: "caption", weight: 6, verbBonus: 2 },
  { pattern: "captions", weight: 6 },
  { pattern: "hashtag", weight: 7 },
  { pattern: "hashtags", weight: 7 },
  { pattern: "carousel", weight: 7 },
  { pattern: "carousels", weight: 7 },
  { pattern: "reel", weight: 6 },
  { pattern: "reels", weight: 7 },
  { pattern: "tagline", weight: 7 },
  { pattern: "headline", weight: 5, verbBonus: 2 },
  { pattern: "thumbnail", weight: 6 },
  { pattern: "billboard", weight: 7 },
  { pattern: "advertisement", weight: 7 },
  { pattern: "advertising", weight: 7 },
  { pattern: "copywriting", weight: 8 },
  { pattern: "newsletter", weight: 6 },
  { pattern: "promo", weight: 6 },
  { pattern: "promotion", weight: 5 },
  { pattern: "campaign", weight: 5 },
  { pattern: "viral", weight: 6 },
  { pattern: "thread", weight: 4, verbBonus: 2 }, // twitter thread
  { pattern: "tweet", weight: 7, verbBonus: 2 },
  { pattern: "tweets", weight: 7 },
  { pattern: "linkedin", weight: 5 },
  { pattern: "tiktok", weight: 6 },
  { pattern: "youtube", weight: 4 },
  { pattern: "shoutout", weight: 6 }, // "shoutout post for X"
  { pattern: "testimonial", weight: 8 },
  { pattern: "infographic", weight: 8 }, // brand_rules.md: core format
  { pattern: "graphic", weight: 5, verbBonus: 2 },
  { pattern: "flyer", weight: 5 },
  { pattern: "promo", weight: 6 },
  { pattern: "specials", weight: 5 },
  { pattern: "special", weight: 4, verbBonus: 1 },
  { pattern: "pillar", weight: 4 }, // "next pillar in rotation"
  { pattern: "rotation", weight: 3 }, // could be tire rotation OR content rotation
  { pattern: "scheduled", weight: 4, verbBonus: 1 },
  { pattern: "buffer", weight: 5 }, // schedule via buffer
  // Cleveland-specific (low alone but combined with verb = high)
  { pattern: "cleveland", weight: 1 },
  { pattern: "216", weight: 2 }, // area code — "216 post"

  // ── Tier C: low-signal words (need context — verb position matters a lot) ──
  { pattern: "post", weight: 2, verbBonus: 5 }, // "post this" >> "the post office"
  { pattern: "posts", weight: 3 },
  { pattern: "story", weight: 1, verbBonus: 3 }, // huge ambiguity ("story time")
  { pattern: "stories", weight: 2, verbBonus: 3 },
  { pattern: "ig", weight: 5 }, // unusual outside content context
  { pattern: "fb", weight: 5 },
  { pattern: "gram", weight: 4 }, // slang
  { pattern: "gbp", weight: 7 }, // Google Business Profile — high-signal acronym
  { pattern: "content", weight: 2, verbBonus: 3 }, // "create content" >> "i'm content"
  { pattern: "ad", weight: 1, verbBonus: 4 }, // "make an ad" >> "ad-hoc"
  { pattern: "ads", weight: 4 },
  { pattern: "copy", weight: 1, verbBonus: 4 }, // "write copy" >> "make a copy"
  { pattern: "marketing", weight: 4 }, // "marketing department" still trigger but weak
  { pattern: "cta", weight: 5 }, // call-to-action
  { pattern: "ctas", weight: 5 },
  { pattern: "banner", weight: 4 },
  { pattern: "poster", weight: 4 },
  { pattern: "facebook", weight: 3 },
  { pattern: "instagram", weight: 6 },
  { pattern: "publish", weight: 3, verbBonus: 4 }, // "publish a post" >> ambient
  { pattern: "draft", weight: 2, verbBonus: 5 }, // "draft me a post" — common ask
  { pattern: "rewrite", weight: 3, verbBonus: 4 },
  { pattern: "rephrase", weight: 4, verbBonus: 3 },
  { pattern: "punchier", weight: 5 },
  { pattern: "shorter", weight: 1 }, // alone weak, context-aware via prev-turn signal
  { pattern: "longer", weight: 1 },
];

// Imperative verbs that almost always indicate "create me a thing".
// Includes Nour's actual phrasing patterns from observed chat history.
const IMPERATIVE_VERBS = [
  "write",
  "draft",
  "create",
  "generate",
  "make",
  "compose",
  "spin up",
  "whip up",
  "give me",
  "build me",
  "design",
  "craft",
  "post",
  "schedule",
  "plan",
  "rewrite",
  "rework",
  "redo",
  "rephrase",
  "punch up",
  // Nour's casual variants
  "hit me with",
  "throw together",
  "spit out",
  "knock out",
  "shoot out",
  "drop me",
  "drop a",
  "drop in",
  "show me",
  "pull together",
  "cook up",
  "send me",
  "bang out",
  "fire off",
  // Slash-command implied imperatives
  "/all",
  "/ab",
  "/reformat",
  "/twopass",
  "/carousel",
  "/turbo",
  "/quality",
];

// Negation phrases that suppress content intent ("I'm NOT asking for a post")
const NEGATIONS = [
  /\bnot (asking|looking|trying|wanting) (for|to)\b/i,
  /\bi'?m not (asking|looking|going to|gonna|trying)\b/i,
  /\b(don'?t|do not) (write|create|draft|generate|make|post|publish)\b/i,
  /\bnothing to do with (post|content|marketing)\b/i,
  /\bjust (curious|wondering|asking|checking) (about|if|whether)\b/i,
  /\bnot related to (content|posting|marketing|the gram)\b/i,
  /\bthis isn'?t (a|for|about) (post|content|marketing)\b/i,
];

// ─────────────────────────────────────────────────────────────────────
// LAYER 2 — Multi-signal adjustments
// ─────────────────────────────────────────────────────────────────────

interface SignalContext {
  /** Last assistant message text (for previous-turn awareness). */
  previousAssistantText?: string;
  /** Last user message text. */
  previousUserText?: string;
}

function applyMultiSignals(
  text: string,
  baseScore: number,
  context: SignalContext | undefined,
  reasons: string[],
): number {
  let score = baseScore;
  const t = text.toLowerCase();

  // 2a. Imperative verb at the start of the message — strong signal
  const firstWord = t.trim().split(/\s+/)[0] || "";
  if (IMPERATIVE_VERBS.includes(firstWord)) {
    score += 4;
    reasons.push(`imperative-start "${firstWord}" +4`);
  }

  // 2b. Imperative verb anywhere
  for (const verb of IMPERATIVE_VERBS) {
    if (verb.includes(" ")) {
      if (t.includes(verb)) {
        score += 2;
        reasons.push(`imperative-phrase "${verb}" +2`);
        break;
      }
    }
  }

  // 2c. Length signal — VERY short messages with high content score are
  //     more likely false positives. "story" alone could be a question.
  //     Long imperative messages with mild content keywords are more likely real.
  const wordCount = t.trim().split(/\s+/).length;
  if (wordCount <= 3 && baseScore < 8) {
    score -= 2;
    reasons.push(`tiny-message penalty -2 (${wordCount}w)`);
  } else if (wordCount > 25 && baseScore >= 4) {
    score += 1;
    reasons.push(`long-message bonus +1 (${wordCount}w)`);
  }

  // 2d. Previous-turn context — if the LAST assistant message looks like
  //     content (caption-shaped, has hashtags), this turn is probably a
  //     follow-up like "make it shorter" or "more punchy".
  if (context?.previousAssistantText) {
    const prev = context.previousAssistantText;
    const prevHasHashtags = (prev.match(/#\w+/g) || []).length >= 3;
    const prevHasCTA = /\b(call|stop in|book|tap|dm|text|216-631-5870|nick'?s tire)\b/i.test(prev);
    const prevIsLong = prev.length > 400 && prev.length < 2500;
    if (prevHasHashtags && prevIsLong) {
      score += 5;
      reasons.push(`prev-turn was content (hashtags) +5`);
    } else if (prevHasCTA && prevIsLong) {
      score += 3;
      reasons.push(`prev-turn was content (CTA + length) +3`);
    }
    // Common follow-up phrases that ride content context
    if (/^(make it|shorter|punchier|more|less|change|swap|but|tighten|loosen|try again)/i.test(t.trim())) {
      if (prevHasHashtags || prevHasCTA) {
        score += 2;
        reasons.push(`content-followup phrase +2`);
      }
    }
  }

  // 2e. Question shape — "what's on the post" suppresses content
  if (/^(what'?s|what is|what was|why|when|where|who|how)\b/i.test(t.trim()) && baseScore < 8) {
    score -= 1;
    reasons.push(`question-shape penalty -1`);
  }

  return score;
}

// ─────────────────────────────────────────────────────────────────────
// LAYER 1 — Score the message
// ─────────────────────────────────────────────────────────────────────

function scoreKeywords(text: string, reasons: string[]): number {
  // Negation kills content intent before we even score
  for (const neg of NEGATIONS) {
    if (neg.test(text)) {
      reasons.push("NEGATION found → score forced to 0");
      return 0;
    }
  }

  let total = 0;
  const t = text.toLowerCase();
  const words = t.split(/\s+/);

  for (const kw of KEYWORDS) {
    let pattern: RegExp;
    if (kw.multiword) {
      // Multi-word phrase — match as substring with light boundary check
      pattern = new RegExp(`\\b${kw.pattern.replace(/\s+/g, "\\s+")}\\b`, "i");
    } else {
      // Single word — strict word boundary
      pattern = new RegExp(`\\b${kw.pattern}\\b`, "i");
    }
    if (pattern.test(t)) {
      let pts = kw.weight;
      // Verb-position bonus — check if word follows an imperative verb
      // OR is in the first 3 words of the message (likely subject of an imperative).
      //
      // SUPPRESS when the word is preceded by an article/possessive — that means
      // it's used as a NOUN, not a verb. "the post office" / "my post" /
      // "a story" / "your content" → no verb bonus.
      if (kw.verbBonus) {
        const idx = words.findIndex((w) => w.includes(kw.pattern));
        const prevWord = idx > 0 ? words[idx - 1].replace(/[^a-z']/g, "") : "";
        const isNounByArticle = ["the", "a", "an", "this", "that", "my", "your", "our", "his", "her", "their", "every", "some"].includes(prevWord);
        const inFirstThree = idx >= 0 && idx < 3;
        const followsImperative =
          idx > 0 && IMPERATIVE_VERBS.some((v) => words[idx - 1] === v);
        if (!isNounByArticle && (inFirstThree || followsImperative)) {
          pts += kw.verbBonus;
          reasons.push(`"${kw.pattern}" verb-pos +${kw.verbBonus}`);
        } else if (isNounByArticle) {
          reasons.push(`"${kw.pattern}" noun-form (no verb bonus)`);
        }
      }
      total += pts;
      reasons.push(`"${kw.pattern}" +${kw.weight}`);
    }
  }

  return total;
}

// ─────────────────────────────────────────────────────────────────────
// LAYER 4 — Embedding fallback
// ─────────────────────────────────────────────────────────────────────
//
// Only fires for ambiguous middle-band scores. Embeds the message and
// compares to a fixed set of example content queries. Cached by SHA1
// hash for 5 min so repeated identical messages don't re-embed.

// Example queries — anchored in Nick's Tire & Auto's actual content
// pillars (brand_rules.md) and Nour's observed phrasing patterns. The
// embedding fallback compares incoming messages to these via cosine sim.
//
// Coverage:
//   · 8 Cleveland service-specific asks (brake, tire, alignment, oil)
//   · 6 brand-pillar asks (seasonal safety, myth-busting, alert)
//   · 6 platform-specific asks (IG, FB, GBP, TikTok, blog)
//   · 5 Nour casual phrasings ("hit me with", "knock out", etc.)
//   · 5 follow-up asks ("punchier", "shorter", "more specific")
const EXAMPLE_CONTENT_QUERIES = [
  // ── Cleveland service-specific (brand pillars) ──
  "give me an instagram post about brake pads for cleveland drivers",
  "draft a caption for the spring tire rotation special",
  "write me a story arc carousel about winter pothole damage",
  "create a reel script about checking tire pressure in cleveland weather",
  "post about the oil change deal next monday",
  "knock out a brake post — alert format",
  "hit me with an alignment post for after-pothole season",
  "draft a battery post for cleveland winter mornings",
  // ── Brand-pillar archetypes (from brand_rules.md hook families) ──
  "alert post about salt damage on cars",
  "myth busting post — most shops over-tighten lug nuts",
  "warning post for drivers heading into a snowstorm",
  "infographic caption about tire tread depth and stopping distance",
  "before and after post for an alignment customer",
  "customer story for S who brought in a 2014 Camry",
  // ── Platform-specific ──
  "rewrite this for facebook with longer paragraphs",
  "spin up a quick gbp update for the spring tire sale",
  "tiktok hook about why brake noise matters",
  "linkedin post about cleveland indie shop vs corporate chains",
  "blog post on why tire rotation extends lifespan",
  "tweet about the storm coming friday — quick safety tip",
  // ── Nour's casual phrasings ──
  "hit me with a quick post about spring brakes",
  "throw together a reel script — make it short",
  "knock out a 3-version a/b test for the alignment offer",
  "what should i post tomorrow",
  "drop a couple captions for the new tire display",
  "give me 3 hooks i can pick from for an oil change reel",
  // ── Common follow-up asks (rely on previous-turn context too) ──
  "make it punchier and add a CTA",
  "shorter — under 100 chars",
  "more specific to brakes",
  "rephrase for cleveland audience",
  "cut the hashtags down to 5",
  // ── Multi-output / slash-style ──
  "/all post + reel + story for the spring sale",
  "/carousel 5 scenes about cleveland winter prep",
  "/reformat this for facebook and gbp",
  "/twopass content with critique for the brake post",
  // ── Slang / short ──
  "for the gram",
  "for the gbp",
  "make it for ig",
  "DM blast to recent customers about the alignment deal",
];

interface EmbeddingCacheEntry {
  result: number; // 0-1 cosine similarity to nearest example
  expiresAt: number;
}

const embeddingCache = new Map<string, EmbeddingCacheEntry>();
const EMBEDDING_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedExampleEmbeddings: number[][] | null = null;

function hashMessage(s: string): string {
  // FNV-1a — fast, isomorphic, zero deps. 32-bit hash is plenty for
  // a 5-min cache key (collision probability negligible at our volume).
  return fnv1aHash(s);
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

async function maxSimilarityToExamples(message: string): Promise<number> {
  const cacheKey = hashMessage(message);
  const now = Date.now();
  const cached = embeddingCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.result;

  try {
    const { getEmbedding } = await import("@/lib/ai/provider");
    // Embed examples once per lambda lifetime
    if (!cachedExampleEmbeddings) {
      const embeddings = await Promise.all(
        EXAMPLE_CONTENT_QUERIES.map((q) => getEmbedding(q).catch(() => [] as number[])),
      );
      cachedExampleEmbeddings = embeddings.filter((e) => e.length > 0);
    }
    if (cachedExampleEmbeddings.length === 0) return 0;

    const queryVec = await getEmbedding(message);
    if (queryVec.length === 0) return 0;

    let max = 0;
    for (const ex of cachedExampleEmbeddings) {
      const sim = cosine(queryVec, ex);
      if (sim > max) max = sim;
    }

    embeddingCache.set(cacheKey, { result: max, expiresAt: now + EMBEDDING_CACHE_TTL_MS });

    // Opportunistic cleanup
    for (const [k, v] of embeddingCache) {
      if (v.expiresAt < now) embeddingCache.delete(k);
    }

    return max;
  } catch (err) {
    console.warn(
      "[content-intent] embedding fallback failed:",
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────

export interface ContentIntentResult {
  isContent: boolean;
  confidence: number;     // 0-1
  reasons: string[];
  /** Final keyword+signal score (pre-embedding). */
  rawScore: number;
  /** Set when the embedding fallback fired. */
  embedSimilarity?: number;
  /** True if layer 4 was invoked. */
  usedEmbedding: boolean;
}

// Threshold tuning:
//   < 4 raw  → confidence 0.0-0.3  (NOT content)
//   4-7 raw  → confidence 0.3-0.7  (AMBIGUOUS — embedding fallback fires)
//   8+ raw   → confidence 0.7-1.0  (content)
//
// Embedding can lift a 4-7 score over 0.5 (high sim) or pull it down (low sim).
const SCORE_LOW = 4;
const SCORE_HIGH = 8;

function rawScoreToConfidence(score: number): number {
  if (score <= 0) return 0;
  if (score >= 12) return 1.0;
  // Linear ramp: 0→0.0, 4→0.3, 8→0.7, 12→1.0
  if (score < SCORE_LOW) return (score / SCORE_LOW) * 0.3;
  if (score < SCORE_HIGH) return 0.3 + ((score - SCORE_LOW) / (SCORE_HIGH - SCORE_LOW)) * 0.4;
  return 0.7 + ((score - SCORE_HIGH) / 4) * 0.3;
}

/**
 * Layered content-intent detector. Synchronous form for callers that
 * can't await (legacy `detectContentIntent` shape). Skips the embedding
 * fallback — only uses layers 1+2.
 */
export function detectContentIntentSync(
  message: string | null | undefined,
  context?: SignalContext,
): ContentIntentResult {
  if (!message) {
    return { isContent: false, confidence: 0, reasons: ["empty message"], rawScore: 0, usedEmbedding: false };
  }
  const reasons: string[] = [];
  const baseScore = scoreKeywords(message, reasons);
  const adjustedScore = applyMultiSignals(message, baseScore, context, reasons);
  const confidence = rawScoreToConfidence(adjustedScore);
  return {
    isContent: confidence >= 0.5,
    confidence,
    reasons,
    rawScore: adjustedScore,
    usedEmbedding: false,
  };
}

/**
 * Async form with embedding fallback for ambiguous middle-band cases.
 * Use this from the chat route + system-prompt builder where we can
 * await ~80ms on uncertain queries.
 */
export async function detectContentIntentAsync(
  message: string | null | undefined,
  context?: SignalContext,
): Promise<ContentIntentResult> {
  const sync = detectContentIntentSync(message, context);
  if (!message) return sync;

  // Only invoke embedding fallback for ambiguous middle band
  if (sync.confidence < 0.3 || sync.confidence > 0.7) return sync;

  const sim = await maxSimilarityToExamples(message);
  sync.embedSimilarity = sim;
  sync.usedEmbedding = true;
  sync.reasons.push(`embed-sim=${sim.toFixed(3)}`);

  // Tip the balance: high similarity (>0.75) confirms content;
  // low similarity (<0.55) demotes. Middle leaves it.
  if (sim >= 0.75) {
    sync.confidence = Math.max(sync.confidence, 0.75);
    sync.isContent = true;
    sync.reasons.push(`embed → confidence raised to 0.75`);
  } else if (sim < 0.55) {
    sync.confidence = Math.min(sync.confidence, 0.4);
    sync.isContent = false;
    sync.reasons.push(`embed → confidence lowered to 0.4`);
  }

  return sync;
}
