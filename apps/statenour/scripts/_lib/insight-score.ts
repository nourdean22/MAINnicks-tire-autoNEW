/**
 * Deterministic insight scoring — ONE implementation, shared.
 *
 * Extracted from vnext-ollama-bakeoff.ts on 2026-08-15 when the persona A/B
 * needed the same scorer. Copying it would have produced two definitions of
 * "insight" that drift apart, which is the exact defect this codebase keeps
 * finding in itself (see shared/reelJobPayload.ts, PHONE_MATCH_KEY_SQL, and
 * splitLocalDiscoveryTopics — all extracted for the same reason).
 */

// ── The insight axis (2026-08-15, operator-requested) ────────────────────
//
// Operator: "it's not opening up new avenues and ideas and horizons... it's
// just telling me what I already know." NOTHING in this bake-off measured that.
// Its axes — tool fidelity, arithmetic, format discipline, JSON validity — all
// measure whether the model keeps the OS's machinery working. A model can score
// 0.9 on all of them and still be a boring thinking partner, which is exactly
// the state the operator is describing.
//
// HONEST LIMIT, read this before trusting the number: insight is not
// deterministically measurable. What follows is a set of PROXIES, and a
// determined model could game every one of them. They are kept deterministic on
// purpose — this file's founding rule is "no LLM judge, so the measurement
// can't flatter itself" — and they are directionally right rather than precise.
// Treat a low insight score as strong evidence and a high one as weak evidence.
//
// The prompt names the obvious answers and forbids them. That converts the
// operator's actual complaint into a measurable event: a model that returns the
// excluded answers is, literally, telling him what he already knows.
export const INSIGHT_PROMPT =
  "77% of my auto shop's customers never come back after the first visit. " +
  "Give me your best thinking on why, and what to actually do about it. " +
  "I already know about loyalty programs, follow-up texts, and reminder emails — " +
  "do not suggest those.";

export const OBVIOUS_EXCLUDED = /\b(loyalty program|rewards program|follow[- ]?up text|reminder email|punch card)\b/gi;
export const TRADEOFF = /\b(but|however|unless|trade[- ]?off|downside|risk|caveat|the catch|fails? when|counter)\b/gi;
export const HEDGE = /\b(it depends|consider|make sure|important to|be sure to|keep in mind|in general|generally speaking)\b/gi;
// Insight usually REFRAMES rather than answers: it attacks the premise, or says
// the number means something other than what was assumed. Slop accepts the
// question as posed and returns tactics.
export const REFRAME = /\b(the real (question|problem|issue)|measuring the wrong|wrong (question|metric|thing)|premise|reframe|actually (a|an|the)|isn'?t (a|an|the) .{0,20}problem|misread)\b/gi;

/**
 * Length-normalised insight proxies.
 *
 * v1 (2026-08-15, same day) counted RAW OCCURRENCES: novel words >= 40,
 * numbers >= 2. Every real model blew through both by 6-10x simply by writing a
 * long answer — first run showed novel=287/249/262 against a threshold of 40 —
 * so the axis saturated at 1.0 and discriminated nothing. Worse, the check I ran
 * before shipping it compared a SHORT slop sample against a LONG good sample, so
 * what it actually validated was that the scorer separates short from long.
 * Real answers are all long. The verification was as length-confounded as the
 * metric.
 *
 * v2 scores DENSITIES (per 100 words) plus lexical variety, both invariant to
 * answer length, and adds a reframing signal. `words` is now reported in the
 * note so thresholds can be calibrated against a real distribution instead of
 * guessed a second time.
 *
 * Still proxies, still gameable, still deterministic on purpose. A low score
 * remains strong evidence; a high score remains weak evidence.
 */
export function scoreInsight(answer: string, prompt: string = INSIGHT_PROMPT): { points: number; note: string } {
  const text = answer.toLowerCase();
  const allWords = text.match(/[a-z][a-z'-]{2,}/g) ?? [];
  const words = allWords.length;
  if (words < 60) {
    return { points: -2, note: `words=${words} (too short to assess)` };
  }
  const per100 = 100 / words;

  const promptTerms = new Set(prompt.toLowerCase().match(/[a-z]{5,}/g) ?? []);
  const content = allWords.filter((w) => w.length >= 5);
  const distinct = new Set(content);
  const novel = new Set([...distinct].filter((w) => !promptTerms.has(w)));

  // Lexical variety: distinct content words / content words. Slop recycles a
  // small vocabulary of advice nouns; dense analysis keeps introducing terms.
  const variety = content.length > 0 ? distinct.size / content.length : 0;
  const novelShare = distinct.size > 0 ? novel.size / distinct.size : 0;

  const tradeoffD = (answer.match(TRADEOFF) ?? []).length * per100;
  const numberD = (answer.match(/\b\d+(\.\d+)?%?\b/g) ?? []).length * per100;
  const hedgeD = (answer.match(HEDGE) ?? []).length * per100;
  const obvious = (answer.match(OBVIOUS_EXCLUDED) ?? []).length;
  const reframes = (answer.match(REFRAME) ?? []).length;

  let points = 0;
  if (variety >= 0.5) points += 1;      // varied vocabulary, not recycled advice nouns
  if (novelShare >= 0.85) points += 1;  // brings its own terms rather than echoing the prompt
  if (tradeoffD >= 0.5) points += 1;    // names a cost at least once per 200 words
  if (numberD >= 0.5) points += 1;      // concrete at least once per 200 words
  if (reframes >= 1) points += 1;       // challenges the premise instead of answering it flat
  if (hedgeD >= 1) points -= 1;         // advice-shaped filler
  if (obvious > 0) points -= 3;         // returned an answer the prompt ruled out

  return {
    points,
    note:
      `words=${words} var=${variety.toFixed(2)} novelShare=${novelShare.toFixed(2)} ` +
      `tradeoff/100=${tradeoffD.toFixed(2)} num/100=${numberD.toFixed(2)} ` +
      `hedge/100=${hedgeD.toFixed(2)} reframe=${reframes} obvious=${obvious}`,
  };
}
