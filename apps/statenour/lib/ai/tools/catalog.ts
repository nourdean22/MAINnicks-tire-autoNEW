/**
 * Tool catalog — metadata layer over `lib/ai/tools.ts` (W6).
 *
 * The tools themselves still live in the monolithic `tools.ts` file for
 * now — physically splitting 3,446 lines of hot-path code is risky
 * without first locking schemas via snapshot tests. This catalog is
 * the FIRST step: every tool is named, categorized, and tagged here.
 *
 * What this enables today:
 *   · /system/ai-cost can group tool cost by category
 *   · Chat pipeline can prune tools by category per MODE (BATTLE,
 *     SURGICAL, etc.) using only the catalog, without scanning tools.ts
 *   · tests/ai/tool-schemas.snapshot.test.ts asserts every exported
 *     tool has a catalog entry (drift detection for new/removed tools)
 *   · /system/tools surface (future) can list every tool with its
 *     invocation count, failure rate, cost
 *
 * What comes next (W6 physical split):
 *   · Each category becomes its own file: lib/ai/tools/personal.ts,
 *     business.ts, etc. Each file exports a partial `Record<string, Tool>`
 *   · lib/ai/tools/index.ts becomes the barrel (currently just re-
 *     exports `nourTools` from the monolithic file)
 *   · tests/ai/tool-schemas.snapshot.test.ts stays exactly the same —
 *     protects against regressions during the move
 *
 * To add a new tool:
 *   1. Add the tool to nourTools in lib/ai/tools.ts
 *   2. Add its name + category entry to TOOL_CATALOG below
 *   3. pnpm test — snapshot test fails on unexpected schema change
 *      until snapshot is regenerated
 */

export type ToolCategory =
  | "personal_read"      // daily/mastery/commitments read
  | "personal_write"     // task + commitment + goal mutations
  | "planning"           // weekly targets, OKRs, MIT
  | "business_read"      // shop + customer + revenue
  | "business_write"     // quote, SMS, follow-up, payment
  | "live_shop"          // nickstire-bridge live queries
  | "content"            // image/post/campaign generation
  | "comms"              // SMS + Telegram
  | "ai_analysis"        // SQL, code, summarize, sentiment, math
  | "brain"              // brain intelligence + memory ops
  | "files"              // Drive + GitHub
  | "routines"           // daily/weekly/eod routines
  | "research"           // knowledge, arsenal, web search
  | "browser";           // Browserbase / Stagehand headless browser

export interface ToolMeta {
  name: string;
  category: ToolCategory;
  /** Tools safe to run in BATTLE mode (fast, read-only). */
  battle?: boolean;
  /** Tools that mutate external state (business writes, SMS, payment). Require approval in strict mode. */
  sideEffecting?: boolean;
  /** Tools that require the nickstire bridge (cross-ring). */
  needsBridge?: boolean;
  /** Rough cost tier per invocation — used for /system/ai-cost aggregation. */
  cost?: "free" | "cheap" | "medium" | "spendy";
  /** Risk classification of the tool. If not provided, dynamically calculated. */
  riskClass?: "low" | "medium" | "high" | "critical";
  /** Required environment keys for this tool to run. */
  requiredEnv?: string[];
}

/**
 * The tool catalog — never state a count in prose: the old "114-tool"
 * header sat here while the real number kept growing (stale external
 * audits then cited a spread of conflicting counts from copies of
 * different ages, and even this comment once carried a number that
 * drifted). The
 * count is TOOL_CATALOG.length; tests/ai/catalog-integrity.test.ts pins
 * catalog ↔ nourTools equality both directions. Keep entries
 * alphabetized within each category for easy diff review.
 */
export const TOOL_CATALOG: ToolMeta[] = [
  // ── personal_read ────────────────────────────────────────────────
  { name: "getBodyData",                  category: "personal_read",  battle: true,  cost: "free" },
  { name: "getHealthToday",               category: "personal_read",  battle: true,  cost: "free" },
  { name: "getSleepTrend",                category: "personal_read",  battle: true,  cost: "free" },
  { name: "getCameraIntelligence",        category: "personal_read",  battle: true,  cost: "free" },
  { name: "getCommitments",               category: "personal_read",  battle: true,  cost: "free" },
  { name: "getDecisionReplays",           category: "personal_read",  battle: true,  cost: "free" },
  // v10.0.528 · Arc B F3 · Decision-Replay Coach reader. Battle-safe ·
  // pure BrainMemory query · no AI call (the cron pre-composed the
  // prompt + wisdom citation).
  { name: "getDecisionsDueForReplay",     category: "personal_read",  battle: true,  cost: "free" },
  { name: "getDriftAlerts",               category: "personal_read",  battle: true,  cost: "free" },
  { name: "getFinancialSnapshot",         category: "personal_read",  battle: true,  cost: "free" },
  { name: "getHabitStreaks",              category: "personal_read",  battle: true,  cost: "free" },
  { name: "getMasteryScores",             category: "personal_read",  battle: true,  cost: "free" },
  { name: "getMissions",                  category: "personal_read",  battle: true,  cost: "free" },
  { name: "getProjections",               category: "personal_read",  battle: true,  cost: "free" },
  { name: "getTasks",                     category: "personal_read",  battle: true,  cost: "free" },
  // v10.0.515 · #12 Calendar bidirectional
  { name: "getTodaySchedule",             category: "personal_read",  battle: true,  cost: "free" },
  { name: "proposeCalendarEvent",         category: "personal_read",  battle: true,  cost: "free" },
  // v10.0.515 · #3 E2B code sandbox · cost is bounded by E2B free tier (100 runs/day)
  { name: "runPython",                    category: "ai_analysis",                   cost: "cheap", riskClass: "critical", requiredEnv: ["E2B_API_KEY"] },
  // v10.0.515 · #10 Document Q&A · cheap (one embedding call + DB knn)
  { name: "searchDocuments",              category: "research",       battle: true,  cost: "cheap", riskClass: "low", requiredEnv: ["AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET"] },
  { name: "ingestDocumentFromUrl",        category: "research",                      cost: "cheap", riskClass: "low" },
  // v10.0.524 · #1 Cross-conversation recall + #4 multi-source search
  { name: "findRelatedConversations",     category: "brain",          battle: true,  cost: "cheap", riskClass: "low" },
  { name: "searchWebVerified",            category: "research",                      cost: "medium", riskClass: "low" },
  { name: "last30days",                   category: "research",                      cost: "cheap",  riskClass: "medium" },
  { name: "moneyprinter",                 category: "research",                      cost: "medium", riskClass: "medium", sideEffecting: true },
  // v10.0.524 · #6 skill suggestion + #10 anti-pattern surface
  { name: "suggestSkills",                category: "brain",          battle: true,  cost: "cheap", riskClass: "low" },
  { name: "getSkillProtocol",             category: "brain",          battle: true,  cost: "free", riskClass: "low" },
  { name: "surfaceAntiPatterns",          category: "brain",          battle: true,  cost: "free", riskClass: "low" },
  // v10.0.525 · Session-recording recall (VideoDB · operator captures
  // own sessions externally, submits to /api/system/videodb-sessions)
  { name: "searchSessionRecordings",      category: "research",       battle: true,  cost: "cheap", riskClass: "low", requiredEnv: ["VIDEO_DB_API_KEY"] },
  { name: "recallFromSession",            category: "research",       battle: true,  cost: "cheap", riskClass: "low", requiredEnv: ["VIDEO_DB_API_KEY"] },

  // ── personal_write ───────────────────────────────────────────────
  // v10.0.75 · closeLoop + createLoop legacy aliases retired
  // (canonical: completeTask + createTask)
  { name: "addTasksToProject",            category: "personal_write", cost: "free" },
  { name: "archiveGoal",                  category: "personal_write", cost: "free" },
  { name: "completeCommitment",           category: "personal_write", cost: "free" },
  { name: "completeTask",                 category: "personal_write", cost: "free" },
  { name: "createCommitment",             category: "personal_write", cost: "free" },
  { name: "createMissionPlan",            category: "personal_write", cost: "free" },
  { name: "createTask",                   category: "personal_write", cost: "free" },
  { name: "journalDecision",              category: "personal_write", cost: "free" },
  { name: "logGoalProgress",              category: "personal_write", cost: "free" },
  { name: "logSituation",                 category: "personal_write", cost: "free" },
  { name: "markCommitmentBroken",         category: "personal_write", cost: "free" },
  { name: "pinMemory",                    category: "personal_write", cost: "free" },
  { name: "resolveAlert",                 category: "personal_write", cost: "free" },
  { name: "reviewDecisionReplay",         category: "personal_write", cost: "free" },
  { name: "runDeviceCommand",             category: "personal_write", sideEffecting: true, cost: "free" },
  { name: "setLifeGoal",                  category: "personal_write", cost: "free" },
  { name: "setTaskPriority",              category: "personal_write", cost: "free" },
  { name: "snoozeTask",                   category: "personal_write", cost: "free" },
  { name: "triageStaleLead",              category: "personal_write", cost: "free" },
  { name: "updateCommitment",             category: "personal_write", cost: "free" },
  { name: "updateMasteryScore",           category: "personal_write", cost: "free" },
  { name: "updateTask",                   category: "personal_write", cost: "free" },

  // ── planning ─────────────────────────────────────────────────────
  { name: "checkCommitments",             category: "planning", battle: true, cost: "free" },
  { name: "clearMit",                     category: "planning", cost: "free" },
  { name: "decisionPreFlight",            category: "planning", cost: "cheap" },
  { name: "getWeeklyTargets",             category: "planning", battle: true, cost: "free" },
  { name: "rankNextActions",              category: "planning", cost: "cheap" },
  { name: "scheduleFollowUp",             category: "planning", cost: "free" },
  { name: "setMit",                       category: "planning", cost: "free" },
  { name: "setOKRs",                      category: "planning", cost: "free" },
  { name: "setWeeklyTargets",             category: "planning", cost: "free" },
  { name: "suggestMIT",                   category: "planning", cost: "cheap" },

  // ── business_read ────────────────────────────────────────────────
  { name: "compareCompetitors",           category: "business_read",  battle: true, cost: "free" },
  { name: "getDashboardSummary",          category: "business_read",  battle: true, cost: "free" },
  { name: "getEstimateLeaks",             category: "business_read",  battle: true, cost: "free" },
  { name: "getReviewStats",               category: "business_read",  battle: true, cost: "free" },
  { name: "getRevenueStats",              category: "business_read",  battle: true, cost: "free" },
  { name: "getTopServices",               category: "business_read",  battle: true, cost: "free" },

  // ── business_write ───────────────────────────────────────────────
  // v7 cleanup · Apr 28 · createPaymentLink + triggerFollowUp removed
  // (mutating Stripe / Twilio actions belong on nickstire.org/admin).
  { name: "createQuickQuote",             category: "business_write", sideEffecting: true, cost: "cheap" },

  // ── live_shop (nickstire bridge) ─────────────────────────────────
  { name: "compareLiveRevenue",           category: "live_shop",      battle: true, needsBridge: true, cost: "free" },
  { name: "findCustomer",                 category: "live_shop",      battle: true, needsBridge: true, cost: "free" },
  { name: "getAttentionAlerts",           category: "live_shop",      battle: true, needsBridge: true, cost: "free" },
  // wave-110 · GSC bridge — battle:false (strategic, not BATTLE-mode urgent)
  { name: "getGscSummary",                category: "live_shop",      battle: false, needsBridge: true, cost: "free" },
  { name: "getGscTopQueries",             category: "live_shop",      battle: false, needsBridge: true, cost: "free" },
  { name: "getInstagramAutopostStatus",   category: "live_shop",      battle: true,  needsBridge: true, cost: "free" },
  // v10.0.500 · ADR-0011 Tier 3 · marketing attribution per source
  // (popup / chat / booking / callback / sms / etc.) with leads,
  // conversions, revenue. Closes the "what's working" category.
  { name: "getMarketingAttribution",      category: "live_shop",      battle: true,  needsBridge: true, cost: "free" },
  // v10.0.79 · getLiveRevenue retired — subset of getRevenueStats({period:"day"})
  // v10.0.79 · getShopBriefing retired — dailyPulse covers same surface plus personal layer.
  { name: "getShopSnapshot",              category: "live_shop",      battle: true, needsBridge: true, cost: "free" },
  { name: "queryNickstire",               category: "live_shop",      battle: true, needsBridge: true, cost: "free" },
  { name: "setInstagramAutopostConfig",   category: "live_shop",      sideEffecting: true, needsBridge: true, cost: "free" },
  { name: "triggerInstagramAutopost",     category: "live_shop",      sideEffecting: true, needsBridge: true, cost: "medium" },

  // ── content ──────────────────────────────────────────────────────
  { name: "generateImage",                category: "content",        sideEffecting: true, cost: "spendy" },

  // ── comms ────────────────────────────────────────────────────────
  // v7 cleanup · Apr 28 · sendSMS / sendBulkSMS removed (Twilio →
  // customer SMS belongs on nickstire.org/admin). Telegram retained
  // (Nour's personal push channel).
  // v10.0.75 · sendToTelegram legacy alias retired (canonical: sendTelegram)
  { name: "sendTelegram",                 category: "comms",          sideEffecting: true, cost: "free" },
  { name: "stageCustomerAlert",           category: "comms",          sideEffecting: true, cost: "free" },

  // ── ai_analysis ──────────────────────────────────────────────────
  { name: "analyzeImage",                 category: "ai_analysis",    cost: "spendy" },
  { name: "analyzeSentiment",             category: "ai_analysis",    cost: "cheap" },
  { name: "extractData",                  category: "ai_analysis",    cost: "cheap" },
  { name: "generateCode",                 category: "ai_analysis",    cost: "medium" },
  { name: "generateSQL",                  category: "ai_analysis",    cost: "cheap" },
  { name: "runCode",                      category: "ai_analysis",    cost: "free" },
  { name: "solveMath",                    category: "ai_analysis",    cost: "cheap" },
  { name: "summarize",                    category: "ai_analysis",    cost: "cheap" },
  { name: "writeCreative",                category: "ai_analysis",    cost: "medium" },

  // ── brain ────────────────────────────────────────────────────────
  { name: "analyzeFitness",               category: "brain",          cost: "free" },
  { name: "analyzeGoals",                 category: "brain",          cost: "free" },
  { name: "analyzeMentalHealth",          category: "brain",          cost: "free" },
  { name: "analyzeSleep",                 category: "brain",          cost: "free" },
  { name: "analyzeTrends",                category: "brain",          cost: "free" },
  { name: "analyzeWeightTrend",           category: "brain",          cost: "free" },
  { name: "analyzeWorkHealth",            category: "brain",          cost: "free" },
  { name: "classifyThought",              category: "brain",          cost: "cheap" },
  { name: "getBlindSpots",                category: "brain",          battle: true, cost: "free" },
  { name: "getBrainHealth",               category: "brain",          battle: true, cost: "free" },
  { name: "getEmotionalState",            category: "brain",          battle: true, cost: "free" },
  { name: "getHabitRevenueCorrelation",   category: "brain",          cost: "cheap" },
  { name: "getRecentReflections",         category: "brain",          battle: true, cost: "free" },
  { name: "listTools",                    category: "brain",          battle: true, cost: "free" },
  { name: "runSimulation",                category: "brain",          cost: "medium" },
  // v10.0.74 · searchBrainDumps retired — searchReflections is the
  // canonical superset (Reflection rows + BrainDump entries + date range).
  { name: "searchColdMemory",             category: "brain",          cost: "cheap" },
  { name: "searchSkills",                  category: "brain",          cost: "cheap" },
  { name: "searchConversations",          category: "brain",          battle: true, cost: "free" },
  { name: "searchGreeneLaws",             category: "brain",          battle: true, cost: "free" },
  { name: "searchMemories",               category: "brain",          battle: true, cost: "free" },
  { name: "searchReflections",            category: "brain",          battle: true, cost: "free" },
  { name: "syncDriveMemory",              category: "brain",          sideEffecting: true, cost: "spendy" },
  { name: "syncCalendar",                 category: "brain",          sideEffecting: true, cost: "spendy" },
  { name: "syncGmail",                    category: "brain",          sideEffecting: true, cost: "spendy" },
  { name: "syncKnowledge",                category: "brain",          sideEffecting: true, cost: "spendy" },
  { name: "toolHealth",                   category: "brain",          battle: true, cost: "free" },
  { name: "checkAntiPattern",             category: "brain",          battle: true, cost: "free" },
  // v10.0.526 · Arc C · F1 · Revenue-Decision Channel chat surface ·
  // read-only over BrainMemory(category="revenue_move")
  { name: "getPendingRevenueMoves",       category: "brain",          battle: true, cost: "free" },
  // v10.0.526 · Arc B Feature 5 · Proactive Contradiction Surfacing.
  // Side-effecting because it mutates the canonical-belief surface
  // (updates Contradiction status, deprecates losing memory, writes
  // resolved_contradiction belief). Free per-call · pure DB.
  { name: "resolveContradiction",          category: "brain",          sideEffecting: true, cost: "free" },
  // Machiavellian Power Dynamics integration · read-only analyzers + tactical lookups
  { name: "analyzeCompetitiveIntel",       category: "brain",          battle: false, cost: "free" },
  { name: "analyzeComposure",              category: "brain",          battle: false, cost: "free" },
  { name: "analyzePowerDynamics",          category: "brain",          battle: false, cost: "free" },
  { name: "getContextualGreeneLaws",       category: "brain",          battle: true,  cost: "free" },
  { name: "getDarkPsychologyTactics",      category: "brain",          battle: true,  cost: "free" },
  { name: "getPowerBalanceSummary",        category: "brain",          battle: true,  cost: "free" },
  { name: "recommendNextMove",             category: "brain",          battle: true,  cost: "free" }, // AG-31 · tactician composer

  // ── files (Drive + GitHub) ───────────────────────────────────────
  { name: "buildArchitectureMemory",      category: "files",          cost: "spendy", riskClass: "low" },
  { name: "getRepoMap",                   category: "files",          cost: "cheap", riskClass: "low", requiredEnv: ["GITHUB_TOKEN"] },
  { name: "githubCreateIssue",            category: "files",          sideEffecting: true, cost: "free", riskClass: "high", requiredEnv: ["GITHUB_TOKEN"] },
  { name: "githubCreatePR",               category: "files",          sideEffecting: true, cost: "free", riskClass: "high", requiredEnv: ["GITHUB_TOKEN"] },
  { name: "githubListFiles",              category: "files",          battle: true, cost: "free", riskClass: "low", requiredEnv: ["GITHUB_TOKEN"] },
  { name: "githubListRepos",              category: "files",          battle: true, cost: "free", riskClass: "low", requiredEnv: ["GITHUB_TOKEN"] },
  { name: "githubReadFile",               category: "files",          battle: true, cost: "free", riskClass: "low", requiredEnv: ["GITHUB_TOKEN"] },
  { name: "githubReadMultiple",           category: "files",          cost: "free", riskClass: "low", requiredEnv: ["GITHUB_TOKEN"] },
  { name: "githubRecentCommits",          category: "files",          battle: true, cost: "free", riskClass: "low", requiredEnv: ["GITHUB_TOKEN"] },
  { name: "githubSearchCode",             category: "files",          cost: "free", riskClass: "low", requiredEnv: ["GITHUB_TOKEN"] },
  { name: "learnCodingPreference",        category: "files",          cost: "free", riskClass: "low" },
  { name: "listRecentDriveFiles",         category: "files",          battle: true, cost: "free", riskClass: "low", requiredEnv: ["AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET"] },
  { name: "readDriveFile",                category: "files",          cost: "free", riskClass: "low", requiredEnv: ["AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET"] },
  { name: "searchDriveFiles",             category: "files",          cost: "free", riskClass: "low", requiredEnv: ["AUTH_GOOGLE_CLIENT_ID", "AUTH_GOOGLE_CLIENT_SECRET"] },

  // ── routines ─────────────────────────────────────────────────────
  { name: "analyzeWeek",                  category: "routines",       cost: "medium" },
  { name: "dailyPulse",                   category: "routines",       cost: "cheap" },
  { name: "endOfDay",                     category: "routines",       cost: "cheap" },
  { name: "weeklyReview",                 category: "routines",       cost: "medium" },

  // ── research ─────────────────────────────────────────────────────
  { name: "arsenalFindLeads",             category: "research",       cost: "spendy" },
  { name: "arsenalResearch",              category: "research",       cost: "spendy" },
  { name: "arsenalWebSearch",             category: "research",       cost: "spendy" },
  { name: "arsenalPreTaskFanout",         category: "research",       cost: "spendy" }, // v10.0.372 · multi-lens fan-out
  { name: "arsenalDeepResearch",          category: "research",       cost: "spendy" }, // v10.0.373 · multi-round autonomous research
  { name: "arsenalMultiAgent",            category: "research",       cost: "spendy" }, // v10.0.374 · parallel sub-agents
  { name: "arsenalBoardConsult",          category: "research",       cost: "spendy" }, // AG-13 · advisor-board council
  { name: "queueDeepResearch",            category: "research",       cost: "free" },   // AG-34 · fire-and-forget queue (the research itself bills the inngest run)
  { name: "arsenalNotebookLM",            category: "research",       battle: true, cost: "free" },
  { name: "arsenalGmailInbox",            category: "comms",          cost: "free" }, // v10.0.379 · gmail inbox list
  { name: "arsenalGmailReadThread",       category: "comms",          cost: "free" }, // v10.0.379 · gmail thread fetch
  { name: "getCronStatus",                category: "research",       battle: true, cost: "free" },

  // ── browser (Browserbase / Stagehand) ────────────────────────────
  // Side-effecting because it drives a real headless browser — clicks,
  // extracts, posts. Spendy because Browserbase bills per session-minute
  // and Stagehand acts wrap LLM calls per step.
  { name: "browseAndDo",                  category: "browser",        sideEffecting: true, cost: "spendy", riskClass: "high", requiredEnv: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"] },
  { name: "browser_do",                   category: "browser",        sideEffecting: true, cost: "spendy", riskClass: "high", requiredEnv: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"] },
  { name: "browser_navigate",             category: "browser",        sideEffecting: true, cost: "cheap",  riskClass: "high", requiredEnv: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"] },
  { name: "browser_act",                  category: "browser",        sideEffecting: true, cost: "medium", riskClass: "high", requiredEnv: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"] },
  { name: "browser_observe",              category: "browser",        sideEffecting: false, cost: "medium", riskClass: "high", requiredEnv: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"] },
  { name: "browser_extract",              category: "browser",        sideEffecting: true, cost: "medium", riskClass: "high", requiredEnv: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"] },

  // ── inline rich renderers (v10.0.49) ─────────────────────────────
  // Ports of open-webui-plugins Inline Visualizer + Email Composer.
  // Tool itself is pure (composeEmail does NOT send — explicit user
  // click on the card POSTs to /api/email/send which is auth-gated).
  { name: "renderInlineChart",            category: "content",        battle: true, cost: "free"   },
  { name: "composeEmail",                 category: "comms",          battle: true, cost: "free"   },

  // ── learning resources (v10.0.52) ────────────────────────────────
  // Bundled curated tutorial catalog (codecrafters-io/build-your-own-x).
  // Pure local search — no network call. Browse UI at /learn.
  { name: "searchBuildYourOwnX",          category: "research",       battle: true, cost: "free"   },

  // v10.0.526 · Arc C · F3 · pricing-strategy advisor read.
  // Cheap BrainMemory lookup; the analyzer runs once weekly in the
  // pricing-advisor cron, not on tool call.
  { name: "pricingAdvisorySummary",       category: "business_read",  battle: true, cost: "free"   },

  // v10.0.526 · Arc C · F7 · second-location feasibility scorer.
  // Pure-compute on operator-provided params · no DB, no fetch, no
  // external dependencies. Cheap to call but classed as battle:false
  // because expansion planning isn't a hot-path read; it's strategic.
  { name: "scoreLocation",                category: "business_read",  battle: false, cost: "free"   },

  // v10.0.530 · Firecrawl web scraper · converts any URL into
  // clean LLM-ready markdown. Cheap (one API call), read-only.
  { name: "scrapeWebPage",                category: "research",       battle: true,  cost: "cheap",  riskClass: "low", requiredEnv: ["FIRECRAWL_API_KEY"] },
  { name: "getTopDecisions",              category: "business_read",  battle: true,  cost: "cheap",  riskClass: "low" },
  { name: "getFleetTruth",                category: "ai_analysis",         battle: true,  cost: "cheap",   riskClass: "low" },
  { name: "fetchVideoTranscript",         category: "research",       battle: true,  cost: "cheap",  riskClass: "low" },
];

/** Fast lookup: name → meta. Built once. */
const BY_NAME: Map<string, ToolMeta> = new Map(TOOL_CATALOG.map((t) => [t.name, t]));

export function getToolMeta(name: string): ToolMeta | null {
  return BY_NAME.get(name) ?? null;
}

export function toolNamesByCategory(category: ToolCategory): string[] {
  return TOOL_CATALOG.filter((t) => t.category === category).map((t) => t.name);
}

export function categoryOf(name: string): ToolCategory | null {
  return BY_NAME.get(name)?.category ?? null;
}

/** Which categories + tool counts. For /system/ai-cost groupings. */
export function catalogSummary(): { category: ToolCategory; count: number }[] {
  const c = new Map<ToolCategory, number>();
  for (const t of TOOL_CATALOG) c.set(t.category, (c.get(t.category) ?? 0) + 1);
  return [...c.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/** Tools safe to keep in BATTLE mode (read-only + fast). Used by chat pipeline pruning. */
export function battleSafeTools(): string[] {
  return TOOL_CATALOG.filter((t) => t.battle).map((t) => t.name);
}

/** Tools that mutate external state. Strict mode refuses these unless explicitly approved. */
export function sideEffectingTools(): string[] {
  return TOOL_CATALOG.filter((t) => t.sideEffecting).map((t) => t.name);
}

/** Count in the catalog — should always match the number of tool entries in nourTools. */
export const TOOL_COUNT = TOOL_CATALOG.length;

export function getToolRiskClass(name: string, meta?: ToolMeta | null): "low" | "medium" | "high" | "critical" {
  const actualMeta = meta ?? getToolMeta(name);
  if (actualMeta?.riskClass) return actualMeta.riskClass;
  if (name === "runCode" || name === "runPython" || name === "runDeviceCommand") {
    return "critical";
  }
  if (actualMeta?.sideEffecting) {
    return "high";
  }
  const category = actualMeta?.category;
  if (category === "personal_write" || category === "business_write" || category === "comms") {
    return "high";
  }
  return "low";
}

