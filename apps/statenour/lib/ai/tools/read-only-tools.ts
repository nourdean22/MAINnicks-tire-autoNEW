/**
 * The tools reviewed as READ-ONLY. A catalog tool is a read only if it is on
 * this list; everything else, including a tool added tomorrow that nobody has
 * reviewed, counts as a write (lib/ai/capability-registry.ts classifyTool).
 *
 * Reviewed 2026-10-15 by reading every executor and the helper functions it
 * calls. No listed tool creates a record a replay would duplicate. Idempotent
 * bookkeeping and measuring the call do not count: tool_telemetry rows,
 * systemMetric rows, a per-person cache row (getContextualGreeneLaws), POST used
 * as the transport of a read query. Five listed tools do a little more, and are
 * accepted by name in ACCEPTED_EXCEPTIONS below; the list is not widened past
 * them. arsenalDeepResearch is NOT listed: every fresh run inserts a BrainMemory
 * row (research_<timestamp>) plus an embedding and persona-usage rows, and its
 * only dedupe is a best-effort semantic lookup.
 *
 * Three tools whose NAME trips the registry's mutating-verb wire (writeCreative,
 * runCode, draftOpportunitySms) only compute,
 * generate or draft. They are replay-safe (REPLAY_SAFE_COMPUTE_TOOLS, for the
 * Retry gate) but deliberately not read-only here, because this list also
 * decides what may run in a read-only or locked turn.
 *   - writeCreative: one LLM call, text back.
 *   - runCode: JavaScript in a sandbox with no network and no filesystem.
 *   - draftOpportunitySms: nickstire's draft_opportunity_sms is labelled READ in
 *     its contract and only lists the queue and drafts; the send is a separate
 *     action (send_opportunity_sms).
 * Kept as a write after reading it: runSimulation (a new BrainMemory row per run).
 *
 * Not verified here: queryNickstire forwards a free-text query name to
 * nickstire.org, which owns the read-only guarantee on its side.
 *
 * Adding a tool: read its executor, then add it here. The canary in
 * tests/ai/read-only-tools.test.ts fails for a catalog tool that is neither
 * listed nor caught by a write tripwire.
 */

/**
 * Tools whose executors only compute, generate or draft. Replaying a turn that
 * used them repeats nothing, so the Retry gate trusts them (isReplaySafeTool).
 * They stay OFF READ_ONLY_TOOLS on purpose: their names trip the registry's
 * mutating-verb wire, and the authority gates (read mode, the mutation lock,
 * invokeTool) keep refusing them. Exempting runCode from the lock is the
 * operator's decision (tests/redteam/chat-tool-gate.redteam.test.ts), not a
 * side effect of this list.
 */
export const REPLAY_SAFE_COMPUTE_TOOLS: ReadonlySet<string> = new Set([
  "writeCreative",
  "runCode",
  "draftOpportunitySms",
]);

/**
 * Writes that slip every tripwire (no flag, no write category, no mutating
 * name), named so the canary can tell them from an unreviewed tool.
 */
export const REVIEWED_UNFLAGGED_WRITES: ReadonlySet<string> = new Set(["arsenalDeepResearch"]);

/** Listed tools that do something small a replay may repeat, accepted by name and reason. */
export const ACCEPTED_EXCEPTIONS: Readonly<Record<string, string>> = {
  getEmotionalState: "Upserts a brain_memories row (idempotent: the same key is rewritten, not added).",
  getTodaySchedule: "Refreshes the Google token cache and the Integration health counters as it reads the calendar.",
  last30days: "With the topic 'setup' it installs software on the server and writes its config file there, once (idempotent, server-local, no outside effect).",
  scrapeWebPage: "A replay can issue the same GET to the page a second time.",
  getShopSnapshot: "Reaches nickstire's /api/bridge/shop-snapshot, which can send a Telegram state-transition alert.",
};

export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  // personal_read
  "getBodyData", "getHealthToday", "getSleepTrend", "getCameraIntelligence", "getCommitments",
  "getAgendaItems", "getDriftAlerts",
  "getFinancialSnapshot", "getHabitStreaks", "getMasteryScores", "getMissions",
  "getExternalWorkerJob", "getExternalWorkerLanes", "getMissionDetail",
  "getTasks", "getTaskDetails", "getTodaySchedule",
  // ai_analysis (invokeTool only dispatches tools this list already vouches for)
  "summarize", "getFleetTruth",
  "searchTools", "invokeTool",
  // research
  "searchDocuments", "searchWebVerified", "last30days", "arsenalResearch",
  "arsenalWebSearch", "arsenalPreTaskFanout", "arsenalMultiAgent",
  "arsenalNotebookLM", "getCronStatus",
  "scrapeWebPage", "fetchVideoTranscript",
  // brain
  "findRelatedConversations", "suggestSkills", "getSkillProtocol",
  "analyzeFitness", "analyzeGoals", "analyzeMentalHealth", "analyzeSleep", "analyzeTrends",
  "analyzeWeightTrend", "analyzeWorkHealth", "classifyThought", "getBlindSpots", "getBrainHealth",
  "getEmotionalState", "getHabitRevenueCorrelation", "getRecentReflections",
  "searchColdMemory", "searchGreeneLaws", "searchMemories",
  "searchReflections", "toolHealth", "checkAntiPattern",
  "analyzeCompetitiveIntel", "analyzeComposure", "analyzePowerDynamics", "getContextualGreeneLaws",
  "getDarkPsychologyTactics", "getPowerBalanceSummary",
  // planning
  "checkCommitments", "getWeeklyTargets", "rankNextActions",
  // business_read
  "getDashboardSummary", "getEstimateLeaks", "getReviewStats",
  "getRevenueStats", "scoreLocation", "getTopDecisions",
  // live_shop
  "compareLiveRevenue", "findCustomer", "getAttentionAlerts", "getGscSummary", "getGscTopQueries",
  "getMarketingAttribution", "getShopSnapshot", "queryNickstire",
  // content
  // files
  "getRepoMap", "githubListFiles", "githubListRepos", "githubReadFile",
  "githubRecentCommits", "githubSearchCode",
  // routines (endOfDay and weeklyReview were once listed as mutating and write nothing)
  "dailyPulse", "endOfDay", "weeklyReview",
]);
