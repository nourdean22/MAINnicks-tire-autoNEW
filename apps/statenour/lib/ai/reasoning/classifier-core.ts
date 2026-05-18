/**
 * lib/ai/reasoning/classifier-core.ts · Phase H.4 (2026-05-18 PM)
 *
 * Isomorphic classifier · runs in both the Node API path and the
 * browser client (DeepModeNudge). Pre-H.4 we maintained parallel
 * regex arrays in two files that drifted at every change. Now both
 * import from here.
 *
 * Has no Node-only imports (no fs, no prisma, no logger) so it's
 * safe to ship in the client bundle. The server-side classifier
 * (lib/ai/reasoning/classifier.ts) wraps this with logger + a
 * richer verdict shape; the client uses it directly.
 */

import type { ReasoningTier } from "./types";

export const STANDARD_MARKERS = [
  /\bshould i\b/i,
  /\bwhat'?s the best\b/i,
  /\bhow do i\b/i,
  /\bhelp me decide\b/i,
  /\btrade.?off/i,
  /\bcompare\b/i,
  /\banalyze\b/i,
  /\bevaluate\b/i,
];

// P.1 · regex fix · `\b\/X\b` and `\b@X\b` patterns DIDN'T match at
// start-of-string because `\b` requires a word char on one side and
// `/` / `@` are non-word chars. The bug was silent · markers worked
// in the middle of a message ("hey /mega run this") but NOT at the
// start ("/mega run this"). Discovered by P.1 unit tests.
// Fix: drop the leading `\b` before `/` and `@` · the prefix itself
// IS a non-word char so it self-anchors. The trailing `\b` still
// requires a word boundary after the keyword.
export const DEEP_MARKERS = [
  /\bstrategy\b/i,
  /\bstrategic\b/i,
  /\bbusiness plan\b/i,
  /\binvestment\b/i,
  /\barchitect/i,
  /\bdeep think\b/i,
  /\bthink deeply\b/i,
  /\/deep\b/i,
  /@deep\b/i,
];

export const THOROUGH_MARKERS = [
  /\bdue diligence\b/i,
  /\bcomprehensive\b/i,
  /\bresearch (the|this|that|all|every)\b/i,
  /\bdeep dive\b/i,
  /\bthorough/i,
  /\/thorough\b/i,
  /@thorough\b/i,
  /\/research\b/i,
];

export const MEGA_MARKERS = [
  /\/mega\b/i,
  /@mega\b/i,
  /\bbiggest hammer\b/i,
  /\bevery angle\b/i,
  /\bspare no\b/i,
  /\bcharizard\b/i,
];

/** Phase M.1 · smart-tier markers · operator opts into the hierarchical
 *  router · cheap classifier picks sub-pipelines vs mega's fire-all. */
export const SMART_MARKERS = [
  /\/smart\b/i,
  /@smart\b/i,
  /\bpick the right\b/i,
  /\brouter\b/i,
];

export const QUICK_OVERRIDES = [
  /\/quick\b/i,
  /@quick\b/i,
];

export interface CoreVerdict {
  tier: ReasoningTier;
  reason: string;
}

export function countSubQuestions(text: string): number {
  const qMarks = (text.match(/\?/g) ?? []).length;
  const conjunctions = (text.match(/\band (also|what about|how about)\b/gi) ?? []).length;
  return Math.max(qMarks, conjunctions + (text.endsWith("?") ? 1 : 0));
}

/** Pure classifier · no IO · safe in browser and Node. */
export function classifyCore(question: string): CoreVerdict {
  const trimmed = question.trim();
  const length = trimmed.length;

  if (QUICK_OVERRIDES.some((re) => re.test(trimmed))) {
    return { tier: "quick", reason: "operator-explicit /quick override" };
  }
  if (length < 20) {
    return { tier: "quick", reason: `short question (${length} chars)` };
  }
  for (const re of MEGA_MARKERS) {
    if (re.test(trimmed)) {
      return { tier: "mega", reason: `mega marker matched (${re.source})` };
    }
  }
  // M.1 · smart tier · operator-explicit · hierarchical router
  for (const re of SMART_MARKERS) {
    if (re.test(trimmed)) {
      return { tier: "smart", reason: `smart marker matched (${re.source})` };
    }
  }
  for (const re of THOROUGH_MARKERS) {
    if (re.test(trimmed)) {
      return { tier: "thorough", reason: `thorough marker matched (${re.source})` };
    }
  }
  for (const re of DEEP_MARKERS) {
    if (re.test(trimmed)) {
      return { tier: "deep", reason: `deep marker matched (${re.source})` };
    }
  }
  for (const re of STANDARD_MARKERS) {
    if (re.test(trimmed)) {
      return { tier: "standard", reason: `standard marker matched (${re.source})` };
    }
  }
  const subCount = countSubQuestions(trimmed);
  if (length >= 600 || subCount >= 3) {
    return { tier: "deep", reason: `complex (${length} chars · ${subCount} sub-qs)` };
  }
  if (length >= 200 || subCount >= 2) {
    return { tier: "standard", reason: `multi-faceted (${length} chars · ${subCount} sub-qs)` };
  }
  return { tier: "quick", reason: "no deep signal · standard chat handles it" };
}
