/**
 * lib/ai/reasoning/reasoning-tools.ts
 *
 * Read-only tool subset for the reasoning engine.
 *
 * The reasoning engine (engine.ts) runs a multi-step classify → plan →
 * gather → draft → critique → refine pipeline. Historically the engine
 * was "tool-blind" — it couldn't call any tools, so the chat route pre-
 * fetched a getDashboardSummary snapshot as a workaround.
 *
 * This module exposes a curated subset of nourTools that the engine's
 * new `runToolGather` step can pass to `generateText`. The whitelist
 * is STRICTLY read-only:
 *   · YES: getRevenueStats, getDashboardSummary, getReviewStats, etc.
 *   · NO:  createTask, sendSMS, triageStaleLead, etc.
 *
 * The engine should OBSERVE current state, never ACT. Write-capable
 * tools stay in the chat-route-only path where the operator can see
 * and approve side effects in real time.
 *
 * Gated by the NICK_DEEP_REASONING feature flag — when off, the
 * engine never reaches this module.
 */
import "server-only";

import { businessTools } from "@/lib/ai/tools/business";
import { systemTools } from "@/lib/ai/tools/system";
import { brainTools } from "@/lib/ai/tools/brain";

/**
 * Whitelist of tool keys that are safe for the reasoning engine.
 * All must be data-reading tools with no side effects.
 *
 * Criteria for inclusion:
 *   1. Pure read — no DB writes, no external API mutations
 *   2. Fast — should resolve in < 5s to not stall the engine
 *   3. Useful for grounding — provides real numbers the engine
 *      would otherwise fabricate
 */
const REASONING_TOOL_WHITELIST = new Set([
  // Business reads
  "getDashboardSummary",
  "getRevenueStats",
  "getReviewStats",
  "getTopServices",
  "getShopSnapshot",
  "queryNickstire",
  "compareLiveRevenue",
  "getEstimateLeaks",
  "getGscSummary",
  "getGscTopQueries",
  "getMarketingAttribution",
  "getAttentionAlerts",
  "getPendingRevenueMoves",
  "pricingAdvisorySummary",
  "getCameraIntelligence",
  "findCustomer",
  // System reads (if any read-safe ones exist)
  "last30days",
  // Brain reads — analyzers + Greene + power dynamics + dark psychology
  "analyzeMentalHealth",
  "analyzeGoals",
  "analyzeTrends",
  "analyzeSleep",
  "analyzeWeightTrend",
  "analyzeFitness",
  "analyzeWorkHealth",
  "getEmotionalState",
  "getBrainHealth",
  "searchGreeneLaws",
  "analyzePowerDynamics",
  "getDarkPsychologyTactics",
  "getPowerBalanceSummary",
  "getContextualGreeneLaws",
  "analyzeComposure",
  "analyzeCompetitiveIntel",
] as const);

/**
 * Returns the curated read-only tool subset for the reasoning engine.
 *
 * Only tools in the whitelist are included. Unknown keys are silently
 * skipped (defensive: if a tool is removed from businessTools but
 * still in the whitelist, nothing breaks).
 */
export function getReasoningTools(): Record<string, unknown> {
  const allSources: Record<string, unknown> = {
    ...businessTools,
    ...systemTools,
    ...brainTools,
  };

  const result: Record<string, unknown> = {};
  for (const key of REASONING_TOOL_WHITELIST) {
    if (key in allSources) {
      result[key] = allSources[key];
    }
  }
  return result;
}

/** Exported for testing — the whitelist keys. */
export const WHITELIST_KEYS = [...REASONING_TOOL_WHITELIST];

/** Count of tools in the reasoning subset. */
export const REASONING_TOOL_COUNT = REASONING_TOOL_WHITELIST.size;
