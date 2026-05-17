/**
 * OUTPUT CRITIC — Apr 19. Scores a Nick reply across four quality
 * axes and decides whether it's strong enough to ship.
 *
 * Runs post-stream in onFinish, so it doesn't add latency to the
 * user's perceived response time. Low scores:
 *   • Get logged to brain_insight as a "low-quality reply" signal
 *     so the learning loop can study pattern (which personas / turn
 *     intents produce weak output).
 *   • Raise a flag in tokenUsage for the UI to show a subtle "regen
 *     recommended" hint (Nour can tap to regenerate at higher temp
 *     or with a different provider).
 *
 * Four axes:
 *   1. SPECIFICITY — numbers / names / dates / system names per 100w.
 *      Target: ≥2.0. Below 0.5 = generic.
 *   2. CLICHE DENSITY — stock phrases per 100w. Target: ≤0.5.
 *      Above 2.0 = regen candidate.
 *   3. ANTI-NOUR — count of corporate-speak slips ("utilize",
 *      "stakeholders"). Target: 0. Above 2 = regen candidate.
 *   4. LENGTH MATCH — actual vs. expected length for the output shape.
 *      Within ±40% = pass. ±80% = warn. Beyond = fail.
 *
 * Each axis returns 0-100. Overall = weighted average:
 *   specificity 35 · cliche 25 · antiNour 20 · length 20
 *
 * Overall below 55 → shouldRegen = true.
 *
 * v10.0.490 · ALSO fire shouldRegen on any single critical-axis miss,
 * regardless of overall. Diagnosis: the live 30-day mean specificity
 * was 50/100 but overall was 80 because clichéscore (99) +
 * antiNour (97) + length (90) masked it. Only 1% of replies hit the
 * overall<55 gate · ~76% of turns are intent=factual where specifics
 * matter most. Adding an axis-specific gate ensures generic-but-clean
 * replies (the actual failure mode the operator was seeing) get
 * flagged for regen instead of shipping silently.
 *
 *   axis-specific gate · ANY of these alone fires regen:
 *     specScore <= 30    (spec_density < 0.5/100w · "generic")
 *     clicheScore <= 20  (cliche_density >= 2.0/100w)
 *     antiScore <= 20    (3+ anti-Nour hits)
 *     lengthScore <= 30  (way off shape range)
 */

import { clicheDensity, detectCliches } from "./cliche-detector";
import {
  specificityDensity,
  detectAntiNour,
  ANTI_NOUR,
} from "./nour-voice-profile";
import type { OutputShape } from "./turn-intelligence";

export interface CriticScore {
  overall: number;              // 0-100
  specificity: number;          // 0-100
  cliche: number;               // 0-100
  antiNour: number;             // 0-100
  length: number;               // 0-100
  wordCount: number;
  reasons: string[];            // human-readable flags
  shouldRegen: boolean;         // true if overall < 55
  offenders: {                  // specific phrases caught for UI display
    cliches: string[];
    antiNour: string[];
  };
}

// Expected length ranges per output shape (words). Based on the prompt
// templates in turn-intelligence.ts buildOutputShapePrompt().
const SHAPE_LENGTH: Record<OutputShape, { min: number; max: number }> = {
  prose: { min: 15, max: 300 },
  email: { min: 40, max: 200 },
  sms: { min: 5, max: 40 },
  proposal: { min: 80, max: 300 },
  list: { min: 15, max: 150 },
  code: { min: 20, max: 400 },
  json: { min: 5, max: 300 },
  table: { min: 15, max: 150 },
  summary: { min: 30, max: 120 },
  none: { min: 2, max: 30 },
};

/**
 * Score a reply and return the scorecard. Pure function — same input
 * always gives same output, safe to call post-stream without locks.
 */
export function critiqueOutput(
  text: string,
  shape: OutputShape = "prose",
): CriticScore {
  const reasons: string[] = [];
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean).length;

  // ── Specificity (target ≥2.0/100w) ──
  const specDensity = specificityDensity(trimmed);
  let specScore = 100;
  if (specDensity < 0.5) {
    specScore = 30;
    reasons.push(`spec-density low (${specDensity.toFixed(2)}/100w)`);
  } else if (specDensity < 1.0) {
    specScore = 60;
  } else if (specDensity < 2.0) {
    specScore = 80;
  }

  // ── Cliche density (target ≤0.5/100w) ──
  const clicheD = clicheDensity(trimmed);
  let clicheScore = 100;
  if (clicheD >= 2.0) {
    clicheScore = 20;
    reasons.push(`cliche density high (${clicheD.toFixed(2)}/100w)`);
  } else if (clicheD >= 1.0) {
    clicheScore = 55;
    reasons.push(`cliche density warn (${clicheD.toFixed(2)}/100w)`);
  } else if (clicheD >= 0.5) {
    clicheScore = 80;
  }
  const { matches: clicheMatches } = detectCliches(trimmed);

  // ── Anti-Nour phrasing (target 0) ──
  const anti = detectAntiNour(trimmed);
  let antiScore = 100;
  if (anti.count >= 3) {
    antiScore = 20;
    reasons.push(`anti-voice hits ${anti.count} (${anti.matches.slice(0, 2).join(", ")})`);
  } else if (anti.count === 2) {
    antiScore = 55;
    reasons.push(`anti-voice hits 2 (${anti.matches.join(", ")})`);
  } else if (anti.count === 1) {
    antiScore = 80;
  }

  // ── Length match per shape ──
  const range = SHAPE_LENGTH[shape] ?? SHAPE_LENGTH.prose;
  let lengthScore = 100;
  if (words < range.min * 0.5 || words > range.max * 1.8) {
    lengthScore = 30;
    reasons.push(`length off · shape=${shape} words=${words} want=${range.min}-${range.max}`);
  } else if (words < range.min * 0.7 || words > range.max * 1.4) {
    lengthScore = 60;
    reasons.push(`length warn · words=${words} want=${range.min}-${range.max}`);
  } else if (words < range.min || words > range.max) {
    lengthScore = 80;
  }

  // Weighted overall
  const overall = Math.round(
    specScore * 0.35 + clicheScore * 0.25 + antiScore * 0.20 + lengthScore * 0.20,
  );

  // v10.0.490 · axis-specific regen gate · fire regen on any single
  // critical-axis miss, not just on overall < 55. See docstring for
  // diagnosis (spec axis was averaging 50/100 in production while
  // overall sat at 80 because other axes masked it · 99% of vague
  // replies shipped). Surfacing the offending axis in reasons[]
  // gives the operator (and the post-stream log) immediate context
  // for why regen fired.
  const criticalAxisOffenders: string[] = [];
  if (specScore <= 30) criticalAxisOffenders.push("spec");
  if (clicheScore <= 20) criticalAxisOffenders.push("cliche");
  if (antiScore <= 20) criticalAxisOffenders.push("antiNour");
  if (lengthScore <= 30) criticalAxisOffenders.push("length");

  // v10.0.512 · ANTI-HEDGE DETECTOR · the 2026-05-12 smoke tests
  // showed venice-uncensored saying "Sorry, I cannot provide
  // information" EVEN WHEN GSC data was directly injected into the
  // system prompt. Hedging is now a critical-axis miss in its own
  // right · any reply that opens with "I cannot", "Unfortunately",
  // "I'm unable", "I don't have access" automatically fires regen.
  // The regen loop then sees the hedge in reasons[] and the regen-
  // prompt (REGEN_SYSTEM_PREFIX) explicitly forbids hedging.
  const hedgePatterns: Array<{ name: string; pat: RegExp }> = [
    { name: "cannot-provide", pat: /^(sorry,?\s+)?i\s+cannot\s+(provide|give|offer|access|retrieve|share)/i },
    { name: "unable-to", pat: /^(sorry,?\s+)?(i'?m\s+|i\s+am\s+)?unable\s+to/i },
    { name: "unfortunately", pat: /^unfortunately[,.]?\s+/i },
    { name: "no-real-time", pat: /\bi\s+(do\s+)?n[o']?t?\s+have\s+(access\s+to|the\s+ability\s+to|real[- ]time)\b/i },
    { name: "as-an-ai", pat: /\bas\s+an?\s+ai\s+(assistant|language\s+model|model)\b/i },
    { name: "cannot-perform-directly", pat: /\bcannot\s+perform\s+directly\b/i },
  ];
  const hedgeHits: string[] = [];
  const replyOpen = trimmed.slice(0, 200);
  for (const { name, pat } of hedgePatterns) {
    if (pat.test(replyOpen) || pat.test(trimmed.slice(0, 600))) {
      hedgeHits.push(name);
    }
  }
  if (hedgeHits.length > 0) {
    criticalAxisOffenders.push("hedge");
    reasons.push(`hedge-detected · ${hedgeHits.join(",")} · model refused / hedged instead of citing data`);
  }

  const overallFailed = overall < 55;
  if (criticalAxisOffenders.length > 0 && !overallFailed) {
    reasons.push(`axis-gate · ${criticalAxisOffenders.join(",")} alone fires regen`);
  }
  const shouldRegen = overallFailed || criticalAxisOffenders.length > 0;

  return {
    overall,
    specificity: specScore,
    cliche: clicheScore,
    antiNour: antiScore,
    length: lengthScore,
    wordCount: words,
    reasons,
    shouldRegen,
    offenders: {
      cliches: clicheMatches.slice(0, 3),
      antiNour: anti.matches.slice(0, 3),
    },
  };
}

/**
 * Helper — log a summary of the scorecard to the console in the same
 * style as the turn-signal log line. Caller can choose to include it
 * or skip.
 */
export function formatCriticSummary(score: CriticScore): string {
  const bits = [
    `overall=${score.overall}`,
    `spec=${score.specificity}`,
    `cliche=${score.cliche}`,
    `antiNour=${score.antiNour}`,
    `len=${score.length}`,
    `words=${score.wordCount}`,
  ];
  if (score.reasons.length > 0) {
    bits.push(`reasons=[${score.reasons.join(" · ")}]`);
  }
  if (score.shouldRegen) bits.push("REGEN_CANDIDATE");
  return bits.join(" ");
}

// Re-export Anti-Nour patterns count helper for callers that want to
// check without instantiating the full voice profile.
export { ANTI_NOUR };

// ──────────────────────────────────────────────────────────────────
// v6 · BATCH 2 · Apr 28 — 7-DIMENSION CONTENT SCORECARD
// ──────────────────────────────────────────────────────────────────
// The 4-axis CriticScore above is the universal scorecard. For
// MARKETING CONTENT specifically (Instagram caption, Facebook post,
// Google Business Profile update) we add 3 brand-specific axes the
// universal critic can't measure:
//
//   5. BRAND-ELEMENT — does it name "Nick's Tire" / "Cleveland"?
//      Target: yes for at least one explicit mention. Without these,
//      the post is a generic auto-shop ad attached to nothing.
//
//   6. CTA — clear call to action present?
//      Target: at least one imperative verb in the last 25% of the
//      post. "Call (216) 631-5870 today" / "Book online" / "Stop in
//      after work". A post without a CTA leaks attention.
//
//   7. HASHTAG-QUALITY — for posts with hashtags, are they real
//      Cleveland or service hashtags (≥3) vs. generic spam?
//      Target: ≥3 real hashtags. "#tires #cars" alone doesn't count.
//
// Returns ContentCriticScore which extends CriticScore with the new
// fields. Callers that just need 4-axis can keep using critiqueOutput.
// Marketing content callers should switch to critiqueContent.

const CTA_KEYWORDS = [
  "call ", "book", "stop in", "tap ", "schedule",
  "dm us", "message", "swing by", "drop by", "today",
  "this week", "right now", "before sunday", "before friday",
  "limited spots", "first come first served", "fcfs", "first-come",
];

const CLEVELAND_HASHTAGS = new Set([
  "#cleveland", "#cle", "#clevelandohio", "#thelandcle",
  "#216", "#cleproud", "#downtowncle", "#westside", "#eastside",
]);

const SERVICE_HASHTAGS = new Set([
  "#tires", "#tireshop", "#mechanic", "#autorepair", "#brakes",
  "#oilchange", "#alignment", "#diagnostics", "#carcare", "#fleet",
  "#truckrepair", "#carmaintenance", "#nickstire", "#nickstireandauto",
]);

export interface ContentCriticScore extends CriticScore {
  brandElement: number;       // 0-100 · Nick's Tire / Cleveland mention
  cta: number;                // 0-100 · CTA present in last 25%
  hashtagQuality: number;     // 0-100 · ≥3 real hashtags
  /** Final 7-axis weighted average — replaces .overall when content scoring */
  contentOverall: number;
}

export function critiqueContent(
  text: string,
  shape: OutputShape = "prose",
): ContentCriticScore {
  const base = critiqueOutput(text, shape);
  const t = text.toLowerCase();
  const reasons = [...base.reasons];

  // ── BRAND-ELEMENT (target: at least one mention) ──
  const hasNickName = /\bnick'?s\s+tire/i.test(text);
  const hasCleveland = /\bcleveland\b|\bcle\b|\b216\b/i.test(text);
  let brandScore = 100;
  if (!hasNickName && !hasCleveland) {
    brandScore = 25;
    reasons.push("brand-element missing — no Nick's Tire / Cleveland mention");
  } else if (!hasNickName) {
    brandScore = 65;
    reasons.push("brand-element partial — Cleveland but no Nick's Tire");
  } else if (!hasCleveland) {
    brandScore = 80;
  }

  // ── CTA (target: at least one in last 25%) ──
  const lastQuarterStart = Math.floor(text.length * 0.75);
  const lastQuarter = text.slice(lastQuarterStart).toLowerCase();
  const hasCTA = CTA_KEYWORDS.some((kw) => lastQuarter.includes(kw));
  const ctaAnywhere = CTA_KEYWORDS.some((kw) => t.includes(kw));
  let ctaScore = 100;
  if (!ctaAnywhere) {
    ctaScore = 20;
    reasons.push("CTA missing — no call-to-action verb anywhere");
  } else if (!hasCTA) {
    ctaScore = 60;
    reasons.push("CTA buried — call-to-action exists but not in last 25%");
  }

  // ── HASHTAG-QUALITY (≥3 real Cleveland or service tags) ──
  const hashtags = text.match(/#[A-Za-z][\w]+/g) ?? [];
  const realTags = hashtags.filter(
    (h) => CLEVELAND_HASHTAGS.has(h.toLowerCase()) || SERVICE_HASHTAGS.has(h.toLowerCase()),
  );
  let hashtagScore = 100;
  if (hashtags.length === 0) {
    // Only penalize when shape is content/social — prose can be hashtag-free
    if (shape === "prose" && hasNickName) {
      hashtagScore = 70; // soft warn — most marketing prose includes 3-5 tags
    }
  } else if (realTags.length === 0) {
    hashtagScore = 30;
    reasons.push(`hashtag-quality low — ${hashtags.length} tags, none Cleveland/service`);
  } else if (realTags.length < 3) {
    hashtagScore = 60;
    reasons.push(`hashtag-quality warn — only ${realTags.length} of ${hashtags.length} are real`);
  }

  // 7-axis weighted overall:
  //   spec 25 · cliche 15 · antiNour 12 · length 10 · brand 15 · CTA 13 · hashtag 10
  const contentOverall = Math.round(
    base.specificity * 0.25 +
    base.cliche * 0.15 +
    base.antiNour * 0.12 +
    base.length * 0.10 +
    brandScore * 0.15 +
    ctaScore * 0.13 +
    hashtagScore * 0.10,
  );

  return {
    ...base,
    reasons,
    contentOverall,
    brandElement: brandScore,
    cta: ctaScore,
    hashtagQuality: hashtagScore,
    shouldRegen: contentOverall < 60,
  };
}
