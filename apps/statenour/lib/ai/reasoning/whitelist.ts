/**
 * lib/ai/reasoning/whitelist.ts · GATE #6 refactor (2026-08-18).
 *
 * The reasoning engine's read-only whitelist, extracted from
 * reasoning-tools.ts VERBATIM so it becomes verifiable. It used to
 * live inside a `server-only` module, which meant the one claim the
 * whole file rests on — "STRICTLY read-only, the engine observes,
 * never acts" — could never be tested: no test process can import a
 * server-only module. GATE #6's whole point is that a metadata claim
 * nothing verifies is an untrusted claim.
 *
 * catalog-claims.ts cross-checks this list against TOOL_CATALOG's
 * sideEffecting flags on every `pnpm test`. Add a tool here and the
 * suite will tell you if the catalog says it mutates.
 *
 * Pure: no imports, no I/O. reasoning-tools.ts consumes this — single
 * source, no drift.
 */

export const REASONING_TOOL_WHITELIST_ENTRIES = [
  // Business reads
  "getDashboardSummary",
  "getRevenueStats",
  "getReviewStats",
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
  "getFleetTruth",
  "getTopDecisions",
  // Wave 3 · draft is READ-ONLY (deterministic template + risk label). The
  // send/staging tool stays OUT of this list — the engine observes, never acts.
  "draftOpportunitySms",
  "arsenalNotebookLM",
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
] as const;
