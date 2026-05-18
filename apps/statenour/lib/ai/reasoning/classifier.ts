/**
 * lib/ai/reasoning/classifier.ts · Phase H (2026-05-18 PM)
 *
 * Decides how hard Nick should think about a given question.
 *
 * Deep mode is EXPENSIVE (~$0.02-0.10 + 8-60s) so the default for
 * lightweight queries is quick mode (passthrough to standard chat).
 * This classifier picks the cheapest tier that still serves the
 * question well.
 *
 * Heuristic-only by design · no LLM call in the classifier itself
 * (we'd add classifier-latency to every chat turn). Signal sources:
 *   · question length (long → likely deeper)
 *   · keyword markers ("strategy", "should I", "what's the best",
 *     "trade-off", "compare", "analyze", "deep", "think")
 *   · explicit operator tier hints (/deep /thorough prefixes)
 *   · presence of multiple sub-questions in one message
 *
 * Returns one of:
 *   · quick    · skip the engine, let standard chat handle it
 *   · standard · pretask fanout + critique
 *   · deep     · multi-agent + fanout + critique
 *   · thorough · deep-research + multi-agent + critique
 */

import type { ReasoningTier } from "./types";

export interface ClassifierVerdict {
  tier: ReasoningTier;
  reason: string;
}

const STANDARD_MARKERS = [
  /\bshould i\b/i,
  /\bwhat'?s the best\b/i,
  /\bhow do i\b/i,
  /\bhelp me decide\b/i,
  /\btrade.?off/i,
  /\bcompare\b/i,
  /\banalyze\b/i,
  /\bevaluate\b/i,
];

const DEEP_MARKERS = [
  /\bstrategy\b/i,
  /\bstrategic\b/i,
  /\bbusiness plan\b/i,
  /\binvestment\b/i,
  /\barchitect/i,
  /\bdeep think\b/i,
  /\bthink deeply\b/i,
  /\b\/deep\b/i,
  /\b@deep\b/i,
];

const THOROUGH_MARKERS = [
  /\bdue diligence\b/i,
  /\bcomprehensive\b/i,
  /\bresearch (the|this|that|all|every)\b/i,
  /\bdeep dive\b/i,
  /\bthorough/i,
  /\b\/thorough\b/i,
  /\b@thorough\b/i,
  /\b\/research\b/i,
];

const MEGA_MARKERS = [
  /\b\/mega\b/i,
  /\b@mega\b/i,
  /\bbiggest hammer\b/i,
  /\bevery angle\b/i,
  /\bspare no\b/i,
  /\bcharizard\b/i,
];

const QUICK_OVERRIDES = [
  /\b\/quick\b/i,
  /\b@quick\b/i,
];

function countSubQuestions(text: string): number {
  // Naive but effective · count question marks + multiple "and what about"
  const qMarks = (text.match(/\?/g) ?? []).length;
  const conjunctions = (text.match(/\band (also|what about|how about)\b/gi) ?? []).length;
  return Math.max(qMarks, conjunctions + (text.endsWith("?") ? 1 : 0));
}

export function classifyReasoning(question: string): ClassifierVerdict {
  const trimmed = question.trim();
  const length = trimmed.length;

  // Operator-explicit quick wins over everything
  if (QUICK_OVERRIDES.some((re) => re.test(trimmed))) {
    return { tier: "quick", reason: "operator-explicit /quick override" };
  }

  // Trivial questions (under 20 chars) are quick
  if (length < 20) {
    return { tier: "quick", reason: `short question (${length} chars)` };
  }

  // Mega tier · operator-explicit only · never auto-promoted (expensive)
  for (const re of MEGA_MARKERS) {
    if (re.test(trimmed)) {
      return { tier: "mega", reason: `mega marker matched (${re.source})` };
    }
  }

  // Explicit thorough markers
  for (const re of THOROUGH_MARKERS) {
    if (re.test(trimmed)) {
      return {
        tier: "thorough",
        reason: `thorough marker matched (${re.source})`,
      };
    }
  }

  // Explicit deep markers
  for (const re of DEEP_MARKERS) {
    if (re.test(trimmed)) {
      return {
        tier: "deep",
        reason: `deep marker matched (${re.source})`,
      };
    }
  }

  // Standard markers
  for (const re of STANDARD_MARKERS) {
    if (re.test(trimmed)) {
      return {
        tier: "standard",
        reason: `standard marker matched (${re.source})`,
      };
    }
  }

  // Length-based escalation when no markers
  const subCount = countSubQuestions(trimmed);
  if (length >= 600 || subCount >= 3) {
    return {
      tier: "deep",
      reason: `complex (${length} chars · ${subCount} sub-qs)`,
    };
  }
  if (length >= 200 || subCount >= 2) {
    return {
      tier: "standard",
      reason: `multi-faceted (${length} chars · ${subCount} sub-qs)`,
    };
  }

  return { tier: "quick", reason: "no deep signal · standard chat handles it" };
}

/** For tests / dev introspection · returns the marker sets so a UI can
 *  hint to the operator what triggers each tier. */
export const __markers = {
  STANDARD_MARKERS,
  DEEP_MARKERS,
  THOROUGH_MARKERS,
  MEGA_MARKERS,
  QUICK_OVERRIDES,
};
