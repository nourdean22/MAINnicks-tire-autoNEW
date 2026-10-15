/**
 * The tools reviewed as READ-ONLY. A catalog tool is a read only if it is on
 * this list; everything else, including a tool added tomorrow that nobody has
 * reviewed, counts as a write (lib/ai/capability-registry.ts classifyTool).
 *
 * Reviewed 2026-10-15 by reading every executor and the helper functions it
 * calls. None of these creates, changes or sends anything a replay would
 * duplicate. Bookkeeping that is idempotent or only measures the call does not
 * count: tool_telemetry rows, systemMetric rows, a per-person cache row
 * (getContextualGreeneLaws), POST used as the transport of a read query.
 *
 * Not verified here: queryNickstire forwards a free-text query name to
 * nickstire.org, which owns the read-only guarantee on its side.
 *
 * Adding a tool: read its executor, then add it here. The canary in
 * tests/ai/read-only-tools.test.ts fails for a catalog tool that is neither
 * listed nor caught by a write tripwire.
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  // personal_read
  "getBodyData", "getHealthToday", "getSleepTrend", "getCameraIntelligence", "getCommitments",
  "getAgendaItems", "getDecisionReplays", "getDecisionsDueForReplay", "getDriftAlerts",
  "getFinancialSnapshot", "getHabitStreaks", "getMasteryScores", "getMissions",
  "getExternalWorkerJob", "getExternalWorkerLanes", "getMissionDetail", "getMissionRetros",
  "getProjections", "getTasks", "getTodaySchedule",
  // ai_analysis (invokeTool and queryData only dispatch tools this list already vouches for)
  "analyzeImage", "analyzeSentiment", "extractData", "solveMath", "summarize", "getFleetTruth",
  "searchTools", "invokeTool", "queryData",
  // research
  "searchDocuments", "searchWebVerified", "last30days", "arsenalFindLeads", "arsenalResearch",
  "arsenalWebSearch", "arsenalPreTaskFanout", "arsenalDeepResearch", "arsenalMultiAgent",
  "arsenalNotebookLM", "arsenalGmailInbox", "arsenalGmailReadThread", "getCronStatus",
  "searchBuildYourOwnX", "scrapeWebPage", "fetchVideoTranscript",
  // brain
  "findRelatedConversations", "suggestSkills", "getSkillProtocol", "surfaceAntiPatterns",
  "analyzeFitness", "analyzeGoals", "analyzeMentalHealth", "analyzeSleep", "analyzeTrends",
  "analyzeWeightTrend", "analyzeWorkHealth", "classifyThought", "getBlindSpots", "getBrainHealth",
  "getEmotionalState", "getHabitRevenueCorrelation", "getRecentReflections", "listTools",
  "searchColdMemory", "searchSkills", "searchConversations", "searchGreeneLaws", "searchMemories",
  "searchReflections", "toolHealth", "checkAntiPattern", "getPendingRevenueMoves",
  "analyzeCompetitiveIntel", "analyzeComposure", "analyzePowerDynamics", "getContextualGreeneLaws",
  "getDarkPsychologyTactics", "getPowerBalanceSummary", "recommendNextMove",
  // planning
  "checkCommitments", "decisionPreFlight", "getWeeklyTargets", "rankNextActions", "suggestMIT",
  // business_read
  "compareCompetitors", "getDashboardSummary", "getEstimateLeaks", "getReviewStats",
  "getRevenueStats", "pricingAdvisorySummary", "scoreLocation", "getTopDecisions",
  // live_shop
  "compareLiveRevenue", "findCustomer", "getAttentionAlerts", "getGscSummary", "getGscTopQueries",
  "getInstagramAutopostStatus", "getMarketingAttribution", "getShopSnapshot", "queryNickstire",
  // content
  "renderInlineChart",
  // files
  "getRepoMap", "githubListFiles", "githubListRepos", "githubReadFile", "githubReadMultiple",
  "githubRecentCommits", "githubSearchCode", "listRecentDriveFiles", "readDriveFile",
  "searchDriveFiles",
  // routines (endOfDay and weeklyReview were once listed as mutating and write nothing)
  "analyzeWeek", "dailyPulse", "endOfDay", "weeklyReview",
  // browser
  "browser_observe",
]);
