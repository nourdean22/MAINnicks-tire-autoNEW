/**
 * Blog seeder eval criteria — predicate functions that check if a
 * generated article meets brand-voice + structural requirements.
 *
 * Each function returns { pass: boolean, reason?: string } so the
 * runner can report exactly what failed.
 *
 * Wave-60 (2026-05-07).
 */
import type { GeneratedArticle } from "../../../../content-generator";

export interface CriterionResult {
  pass: boolean;
  reason?: string;
}

const BANNED_PHRASES = [
  "top-rated",
  "trusted",
  "premier",
  "world-class",
  "passionate",
  "best-in-class",
  "your one-stop shop",
  "we strive",
  "we pride ourselves",
];

const INSIDER_VOCAB_BRAKE = [
  "pad slap",
  "caliper drag",
  "rotor pitting",
  "shim",
  "glaze",
  "scoring",
];

const CLEVELAND_ANCHORS = [
  "cleveland",
  "cuyahoga",
  "euclid",
  "lake erie",
  "lake-effect",
  "browns",
  "salt",
  "pothole",
  "edgewater",
  "slavic village",
  "tower city",
];

const NUMBER_RX = /\b\d+(\.\d+)?\s*(\$|%|ft|miles|min|hr|hours|seconds|°F|degrees)\b/i;
const EMOJI_RX = /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u;

function articleText(article: GeneratedArticle): string {
  return [
    article.title,
    article.metaTitle,
    article.metaDescription,
    article.excerpt,
    ...article.sections.map((s) => `${s.heading}\n${s.content}`),
  ].join("\n").toLowerCase();
}

// ─── Hard rules ─────────────────────────────────────────────

export function metaTitleLengthOK(article: GeneratedArticle): CriterionResult {
  const len = article.metaTitle?.length ?? 0;
  return {
    pass: len > 0 && len <= 60,
    reason: len > 60 ? `metaTitle ${len} chars (max 60)` : undefined,
  };
}

export function metaDescriptionLengthOK(article: GeneratedArticle): CriterionResult {
  const len = article.metaDescription?.length ?? 0;
  return {
    pass: len > 0 && len <= 160,
    reason: len > 160 ? `metaDescription ${len} chars (max 160)` : undefined,
  };
}

export function noBannedPhrases(article: GeneratedArticle): CriterionResult {
  const text = articleText(article);
  for (const phrase of BANNED_PHRASES) {
    if (text.includes(phrase)) {
      return { pass: false, reason: `contains banned phrase: "${phrase}"` };
    }
  }
  return { pass: true };
}

export function noEmojis(article: GeneratedArticle): CriterionResult {
  const text = articleText(article);
  return {
    pass: !EMOJI_RX.test(text),
    reason: EMOJI_RX.test(text) ? "contains emoji (banned)" : undefined,
  };
}

export function sectionsCountOK(article: GeneratedArticle): CriterionResult {
  const n = article.sections?.length ?? 0;
  return {
    pass: n >= 4 && n <= 8,
    reason: n < 4 || n > 8 ? `sections.length=${n} (expected 4-8)` : undefined,
  };
}

export function sectionsContentLengthOK(article: GeneratedArticle): CriterionResult {
  for (const [i, s] of (article.sections ?? []).entries()) {
    const words = s.content?.split(/\s+/).length ?? 0;
    if (words < 80) {
      return { pass: false, reason: `section ${i} (${s.heading}) ${words} words (min 80)` };
    }
    if (words > 300) {
      return { pass: false, reason: `section ${i} (${s.heading}) ${words} words (max 300)` };
    }
  }
  return { pass: true };
}

export function relatedServicesCountOK(article: GeneratedArticle): CriterionResult {
  const n = article.relatedServices?.length ?? 0;
  return {
    pass: n >= 2 && n <= 4,
    reason: n < 2 || n > 4 ? `relatedServices.length=${n} (expected 2-4)` : undefined,
  };
}

export function tagsCountOK(article: GeneratedArticle): CriterionResult {
  const n = article.tags?.length ?? 0;
  return {
    pass: n >= 4 && n <= 8,
    reason: n < 4 || n > 8 ? `tags.length=${n} (expected 4-8)` : undefined,
  };
}

// ─── Brand-voice operators ──────────────────────────────────

export function clevelandAnchorPresent(article: GeneratedArticle): CriterionResult {
  const text = articleText(article);
  for (const a of CLEVELAND_ANCHORS) {
    if (text.includes(a)) return { pass: true };
  }
  return { pass: false, reason: "no Cleveland-specific anchor found" };
}

export function specificNumberAnchorPresent(article: GeneratedArticle): CriterionResult {
  const text = articleText(article);
  return {
    pass: NUMBER_RX.test(text),
    reason: NUMBER_RX.test(text) ? undefined : "no specific number anchor (cost / miles / time / etc.)",
  };
}

export function brakeInsiderVocabPresent(article: GeneratedArticle): CriterionResult {
  // Only applies to brake-category articles
  const text = articleText(article);
  for (const v of INSIDER_VOCAB_BRAKE) {
    if (text.includes(v)) return { pass: true };
  }
  return { pass: false, reason: "no brake insider vocab (pad slap, caliper drag, rotor pitting, etc.)" };
}

// ─── Concession-first detection ─────────────────────────────

const CONCESSION_PATTERNS = [
  /not the cheapest/i,
  /more expensive/i,
  /takes longer/i,
  /no/i, // weak; matched by '...not the X' patterns above
  /\bbut\b/i,
  /though/i,
  /that said/i,
  /even though/i,
];

export function concessionFirstPresent(article: GeneratedArticle): CriterionResult {
  // Check if the article uses concession-first persuasion (acknowledges
  // a downside before claiming a strength). Heuristic: scan for
  // common concession constructions.
  const text = articleText(article);
  const hits = CONCESSION_PATTERNS.filter((p) => p.test(text)).length;
  return {
    pass: hits >= 2,
    reason: hits < 2 ? `only ${hits} concession-pattern hits (expected ≥2)` : undefined,
  };
}

// ─── Aggregator ─────────────────────────────────────────────

export const ALL_CRITERIA: Array<{
  name: string;
  fn: (a: GeneratedArticle) => CriterionResult;
  appliesTo?: (a: GeneratedArticle) => boolean;
}> = [
  { name: "metaTitle length OK", fn: metaTitleLengthOK },
  { name: "metaDescription length OK", fn: metaDescriptionLengthOK },
  { name: "no banned phrases", fn: noBannedPhrases },
  { name: "no emojis", fn: noEmojis },
  { name: "sections count 4-8", fn: sectionsCountOK },
  { name: "sections content 80-300 words", fn: sectionsContentLengthOK },
  { name: "relatedServices count 2-4", fn: relatedServicesCountOK },
  { name: "tags count 4-8", fn: tagsCountOK },
  { name: "Cleveland anchor present", fn: clevelandAnchorPresent },
  { name: "specific number anchor present", fn: specificNumberAnchorPresent },
  {
    name: "brake insider vocab",
    fn: brakeInsiderVocabPresent,
    appliesTo: (a) => a.category === "Brake Repair",
  },
  // concessionFirstPresent is heuristic; mark as soft (warn-only) for now
];

export function runAllCriteria(article: GeneratedArticle): {
  total: number;
  passed: number;
  failed: Array<{ name: string; reason?: string }>;
} {
  const failed: Array<{ name: string; reason?: string }> = [];
  let total = 0;
  let passed = 0;

  for (const c of ALL_CRITERIA) {
    if (c.appliesTo && !c.appliesTo(article)) continue;
    total += 1;
    const r = c.fn(article);
    if (r.pass) {
      passed += 1;
    } else {
      failed.push({ name: c.name, reason: r.reason });
    }
  }

  return { total, passed, failed };
}
