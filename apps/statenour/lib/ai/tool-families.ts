/**
 * Tool family registry — metadata for every tool in `nourTools`.
 *
 * Why metadata-layer, not file-split: `lib/ai/tools.ts` is 3621 LOC
 * with 114 tools. Physically splitting risks breaking Nick's tool
 * resolution in chat + command paths. Instead we keep tools.ts as the
 * single source of executable definitions AND we surface observability
 * via this parallel registry.
 *
 * This registry powers:
 *   · /system/tools  — live inventory with call counts, success rates,
 *                      last-used timestamps, family filtering
 *   · /api/system/tools/stats — joins registry with AIGeneration logs
 *                               to compute per-tool telemetry
 *   · Future: per-family kill switches (e.g., "disable github tools
 *              during maintenance window")
 *
 * Adding a new tool:
 *   1. Define the tool in lib/ai/tools.ts inside nourTools.
 *   2. Add an entry here with its family + description.
 *   3. Runtime guard (see assertRegistered()) will `console.warn` if
 *      the registry drifts from the live tools export.
 */

import { nourTools } from "@/lib/ai/tools";

export type ToolFamily =
  | "personal-read"
  | "personal-write"
  | "business-read"
  | "business-write"
  | "brain-search"
  | "brain-write"
  | "content-generation"
  | "integration-github"
  | "integration-drive"
  | "integration-telegram"
  | "integration-nickstire"
  | "integration-arsenal"
  | "cognition"
  | "planning"
  | "device"
  | "meta";

export interface ToolMetadata {
  family: ToolFamily;
  description: string;
  // `mutates` was REMOVED here on 2026-09-02 (self-audit). It was a second,
  // hand-maintained answer to a question lib/ai/tools/catalog.ts already
  // answers — and the one that governs SAFETY, since read-mode stripping
  // consults the catalog through classifyTool(). The two had drifted on 22 of
  // ~181 tools, in both directions: `proposeCalendarEvent` sat here as
  // `mutates: false` on a line whose own description said it "writes the
  // event direc[tly]", so /system/tools under-reported the mutating count to
  // the operator, while `endOfDay` and `weeklyReview` were listed as mutating
  // and write nothing. Neither registry was reliably right, which is what a
  // duplicated fact always converges to.
  //
  // /system/tools now derives it from the classifier (lib/services/
  // system-pages-b.ts), so "mutating" there means exactly "read mode strips
  // this" — one definition, one source, drift structurally impossible.
  /** Cost tier — lets us cap expensive calls (image gen, external AI). */
  cost: "cheap" | "medium" | "expensive";
  /** Tags for deeper filtering in the /system/tools UI. */
  tags?: string[];
}

/**
 * Authoritative family map. Keys MUST match the key in `nourTools`.
 */
export const TOOL_FAMILIES: Readonly<Record<string, ToolMetadata>> = {
  // ── Personal · read ──
  getMasteryScores: { family: "personal-read", description: "Current mastery domain scores over last 12 rows", cost: "cheap" },
  getDriftAlerts: { family: "personal-read", description: "Unresolved drift alerts across domains", cost: "cheap" },
  getCommitments: { family: "personal-read", description: "Active commitments (active/in_progress)", cost: "cheap" },
  getAgendaItems: { family: "personal-read", description: "Active agenda items — witnessed commitments, intentions, contradictions, neglect alerts (JIT complement to the gated inline agenda section)", cost: "cheap" },
  getTasks: { family: "personal-read", description: "INBOX/READY/DOING tasks with mission context", cost: "cheap" },
  getMissions: { family: "personal-read", description: "ACTIVE missions sorted by priority", cost: "cheap" },
  getMissionDetail: { family: "personal-read", description: "One mission with task progress, next actions, deadline health", cost: "cheap" },
  getMissionRetros: { family: "personal-read", description: "Recent mission retrospectives (lessons at close-out)", cost: "cheap" },
  getHabitStreaks: { family: "personal-read", description: "Habit completion summary (last 7 days)", cost: "cheap" },
  getBodyData: { family: "personal-read", description: "Weight and body tracking history", cost: "cheap" },
  getHealthToday: { family: "personal-read", description: "Today's health snapshot (sleep, weight, steps, resting HR, HRV) with sync freshness", cost: "cheap" },
  getSleepTrend: { family: "personal-read", description: "Sleep-hours series with coverage over the last N days", cost: "cheap" },
  getFinancialSnapshot: { family: "personal-read", description: "Latest financial snapshot", cost: "cheap" },
  getProjections: { family: "personal-read", description: "AI-generated forward projections", cost: "medium" },
  getCameraIntelligence: { family: "personal-read", description: "Live camera/traffic data for the shop", cost: "medium", tags: ["shop", "camera"] },
  getDecisionReplays: { family: "personal-read", description: "Decisions due for review", cost: "cheap" },
  // v10.0.528 · Arc B F3 · today's queued 30d-replay prompts (already
  // composed by the cron · this is a pure-read).
  getDecisionsDueForReplay: { family: "personal-read", description: "Today's queued 30-day decision-replay prompts with wisdom citations", cost: "cheap" },
  getAttentionAlerts: { family: "personal-read", description: "Domain attention-starvation signals", cost: "cheap" },
  getBlindSpots: { family: "personal-read", description: "Critical blind spots from the detector", cost: "medium" },
  getEmotionalState: { family: "personal-read", description: "Rolling emotional arc snapshot", cost: "cheap" },
  getHabitRevenueCorrelation: { family: "personal-read", description: "Correlation: habit adherence vs revenue", cost: "medium" },
  getBrainHealth: { family: "personal-read", description: "Brain maturity + memory stats", cost: "cheap" },
  getEstimateLeaks: { family: "personal-read", description: "Customers who got estimates but didn't book", cost: "cheap", tags: ["revenue"] },
  getRecentReflections: { family: "personal-read", description: "Last N journal reflections", cost: "cheap" },
  searchReflections: { family: "personal-read", description: "FTS over journal reflections", cost: "cheap" },
  dailyPulse: { family: "personal-read", description: "Full today snapshot (scores + tasks + alerts)", cost: "cheap" },
  getWeeklyTargets: { family: "personal-read", description: "Current week's 3 targets", cost: "cheap" },
  checkCommitments: { family: "personal-read", description: "Commitment compliance check", cost: "cheap" },

  // ── Personal · write ──
  addTasksToProject: { family: "personal-write", description: "Create multiple tasks in bulk", cost: "cheap" },
  createTask: { family: "personal-write", description: "Create a new task", cost: "cheap" },
  completeTask: { family: "personal-write", description: "Mark a task done", cost: "cheap" },
  triggerBrief: { family: "personal-write", description: "Generate the daily executive brief on demand from current intelligence", cost: "cheap" },
  setTaskPriority: { family: "personal-write", description: "Re-rank a task's autoPriority", cost: "cheap" },
  resolveAlert: { family: "personal-write", description: "Resolve a drift alert", cost: "cheap" },
  // v10.0.75 · closeLoop / createLoop legacy aliases retired (canonical:
  // completeTask + createTask).
  createCommitment: { family: "personal-write", description: "Create a new commitment", cost: "cheap" },
  updateCommitment: { family: "personal-write", description: "Update commitment status", cost: "cheap" },
  updateMasteryScore: { family: "personal-write", description: "Update a mastery domain score", cost: "cheap" },
  setLifeGoal: { family: "personal-write", description: "Set a life-level goal", cost: "cheap" },
  markCommitmentBroken: { family: "personal-write", description: "Mark commitment broken (with reason)", cost: "cheap" },
  completeCommitment: { family: "personal-write", description: "Mark a commitment satisfied", cost: "cheap" },
  reviewDecisionReplay: { family: "personal-write", description: "Grade a past decision + log outcome", cost: "cheap" },
  setWeeklyTargets: { family: "personal-write", description: "Set this week's 3 targets", cost: "cheap" },
  setOKRs: { family: "personal-write", description: "Set objectives/key-results", cost: "cheap" },
  setMit: { family: "personal-write", description: "Set MIT (most important task)", cost: "cheap" },
  clearMit: { family: "personal-write", description: "Clear MIT slot", cost: "cheap" },
  createMissionPlan: { family: "personal-write", description: "Create a full mission plan with tasks", cost: "medium" },
  queueMissionExecution: { family: "personal-write", description: "Queue bounded durable background execution for an active mission", cost: "medium" },
  captureSkillFromSource: { family: "personal-write", description: "Capture a protocol from a book/article/photo as a pending candidate skill", cost: "cheap" },
  updateMissionStatus: { family: "personal-write", description: "Change a mission's lifecycle status (pause/complete/kill/reactivate)", cost: "cheap" },
  scheduleFollowUp: { family: "personal-write", description: "Schedule a follow-up reminder", cost: "cheap" },
  // 2026-08-28 · WP3 · distinct from scheduleFollowUp above, which creates
  // a CUSTOMER follow-up task. This one schedules NICK to speak again in
  // this thread unprompted; the lane is OFF by default and triple-gated.
  scheduleSelfFollowUp: { family: "personal-write", description: "Schedule yourself to follow up in this conversation later", cost: "cheap" },
  endOfDay: { family: "personal-write", description: "Run EOD debrief + log score", cost: "cheap" },
  weeklyReview: { family: "personal-write", description: "Generate weekly review summary", cost: "medium" },
  journalDecision: { family: "personal-write", description: "Log a decision to journal", cost: "cheap" },
  logSituation: { family: "personal-write", description: "Log a strategic situation", cost: "cheap" },

  // ── Business · read ──
  getShopSnapshot: { family: "business-read", description: "Current shop state (nickstire)", cost: "cheap", tags: ["nickstire"] },
  // v10.0.79 · getShopBriefing retired — dailyPulse covers same surface plus personal layer.
  getReviewStats: { family: "business-read", description: "Review statistics for the shop", cost: "cheap", tags: ["nickstire"] },
  getRevenueStats: { family: "business-read", description: "Revenue breakdown", cost: "cheap", tags: ["nickstire"] },
  getDashboardSummary: { family: "business-read", description: "Admin dashboard rollup", cost: "cheap", tags: ["nickstire"] },
  // v10.0.79 · getLiveRevenue retired — subset of getRevenueStats({period:"day"})
  compareLiveRevenue: { family: "business-read", description: "Compare current vs prior period", cost: "cheap", tags: ["nickstire"] },
  compareCompetitors: { family: "business-read", description: "Benchmark vs competitor reviews", cost: "medium" },
  findCustomer: { family: "business-read", description: "Find customer by phone/email/name", cost: "cheap", tags: ["nickstire"] },
  queryNickstire: { family: "business-read", description: "Free-form nickstire query (escape hatch)", cost: "medium", tags: ["nickstire"] },
  // v10.0.526 · Arc C · F3 — weekly advisory read; analyzer runs in cron.
  pricingAdvisorySummary: { family: "business-read", description: "Read latest weekly pricing-strategy advisory (win rate, outliers, drafted experiments)", cost: "cheap", tags: ["nickstire", "advisory"] },

  // ── Business · write ──
  // 2026-07-11 review · sendSMS / sendBulkSMS / createPaymentLink /
  // triggerFollowUp removed — those tools were deleted in the v7 cleanup
  // (Apr 28, documented in catalog.ts) and their registry entries made
  // /system/tools list 4 tools that no longer exist. Phantom entries are
  // now a FAILING test (tests/ai/tool-families-drift.test.ts), not a warn.
  createQuickQuote: { family: "business-write", description: "Create a quote for a lead", cost: "cheap" },
  triageStaleLead: { family: "business-write", description: "Move stale lead → next action", cost: "cheap" },

  // ── Brain · search ──
  // v10.0.74 · searchBrainDumps retired (canonical: searchReflections,
  // which covers both Reflection rows + BrainDump entries with date range).
  searchMemories: { family: "brain-search", description: "Semantic search over BrainMemory", cost: "medium" },
  searchColdMemory: { family: "brain-search", description: "Search cold (archived) memory", cost: "medium" },
  searchSkills: { family: "brain-search", description: "Semantic search over the indexed Claude skill registry", cost: "medium" },
  searchConversations: { family: "brain-search", description: "Search past Nick conversations", cost: "cheap" },
  searchGreeneLaws: { family: "brain-search", description: "Search Robert Greene's strategic laws", cost: "cheap" },
  checkAntiPattern: { family: "brain-search", description: "Check intent against anti-pattern library", cost: "cheap" },

  // ── Brain · write ──
  syncDriveMemory: { family: "brain-write", description: "Ingest Drive docs into BrainMemory", cost: "expensive" },
  syncCalendar: { family: "brain-write", description: "Ingest Google Calendar events into BrainMemory", cost: "expensive" },
  syncGmail: { family: "brain-write", description: "Ingest recent Gmail messages into statenour-os", cost: "expensive" },
  buildArchitectureMemory: { family: "brain-write", description: "Refresh architecture-of-self memory", cost: "medium" },
  learnCodingPreference: { family: "brain-write", description: "Save a coding preference rule", cost: "cheap" },
  syncKnowledge: { family: "brain-write", description: "Run knowledge-sync engine", cost: "expensive" },
  classifyThought: { family: "brain-write", description: "Classify a thought → BrainDump category", cost: "cheap" },

  // ── Content generation ──
  generateImage: { family: "content-generation", description: "Image generation (Venice/etc)", cost: "expensive" },
  generateSQL: { family: "content-generation", description: "Generate SQL from natural language", cost: "medium" },
  generateCode: { family: "content-generation", description: "Generate code snippet", cost: "medium" },
  summarize: { family: "content-generation", description: "Summarize arbitrary text", cost: "medium" },
  analyzeSentiment: { family: "content-generation", description: "Sentiment analysis", cost: "cheap" },
  extractData: { family: "content-generation", description: "Extract structured data from text", cost: "medium" },
  solveMath: { family: "content-generation", description: "Math / calc / reasoning", cost: "medium" },
  writeCreative: { family: "content-generation", description: "Creative writing / copy", cost: "medium" },
  analyzeImage: { family: "content-generation", description: "Vision analysis of an image", cost: "expensive" },

  // ── Integration · GitHub ──
  githubReadFile: { family: "integration-github", description: "Read a file from a GitHub repo", cost: "cheap" },
  githubReadMultiple: { family: "integration-github", description: "Read multiple files in one call", cost: "medium" },
  githubListFiles: { family: "integration-github", description: "List files in a repo path", cost: "cheap" },
  githubSearchCode: { family: "integration-github", description: "Search code across a repo", cost: "medium" },
  githubRecentCommits: { family: "integration-github", description: "Recent commits", cost: "cheap" },
  githubListRepos: { family: "integration-github", description: "List repos owned by user", cost: "cheap" },
  githubCreatePR: { family: "integration-github", description: "Open a pull request", cost: "medium" },
  githubCreateIssue: { family: "integration-github", description: "Open an issue", cost: "cheap" },
  getRepoMap: { family: "integration-github", description: "Map a repo's top-level structure", cost: "medium" },

  // ── Integration · Drive ──
  searchDriveFiles: { family: "integration-drive", description: "Search Drive files by name/content", cost: "medium" },
  readDriveFile: { family: "integration-drive", description: "Read a Drive doc's content", cost: "medium" },
  listRecentDriveFiles: { family: "integration-drive", description: "Recent Drive changes", cost: "cheap" },

  // ── Integration · Telegram ──
  // v10.0.75 · sendToTelegram legacy alias retired (canonical: sendTelegram).
  sendTelegram: { family: "integration-telegram", description: "Send a Telegram message", cost: "cheap" },

  // ── Integration · Arsenal (research) ──
  arsenalResearch: { family: "integration-arsenal", description: "Arsenal research agent (deep)", cost: "expensive" },
  arsenalWebSearch: { family: "integration-arsenal", description: "Arsenal web search", cost: "medium" },
  arsenalFindLeads: { family: "integration-arsenal", description: "Arsenal lead-finding agent", cost: "expensive" },
  arsenalPreTaskFanout: { family: "integration-arsenal", description: "Pre-task multi-lens fan-out for hard questions", cost: "expensive" },
  arsenalDeepResearch: { family: "integration-arsenal", description: "Multi-round autonomous research with citations", cost: "expensive" },
  arsenalMultiAgent: { family: "integration-arsenal", description: "Spawn N sub-agents in parallel + synthesize", cost: "expensive" },
  arsenalBoardConsult: { family: "integration-arsenal", description: "Convene an advisor board (multi-lens council) on a major decision", cost: "expensive" },
  arsenalGmailInbox: { family: "integration-arsenal", description: "List recent inbox threads", cost: "cheap" },
  arsenalGmailReadThread: { family: "integration-arsenal", description: "Read a specific thread", cost: "cheap" },

  // ── Cognition ──
  analyzeWeek: { family: "cognition", description: "Week-over-week pattern analysis", cost: "medium" },
  runSimulation: { family: "cognition", description: "Run a what-if simulation", cost: "expensive" },
  decisionPreFlight: { family: "cognition", description: "Pre-decision checklist", cost: "medium" },
  rankNextActions: { family: "cognition", description: "Rank candidate next actions", cost: "medium" },

  // ── Planning ──
  suggestMIT: { family: "planning", description: "Suggest MIT for today", cost: "medium" },

  // ── Device ──
  runDeviceCommand: { family: "device", description: "Dispatch a device command (Ring/Eufy/Tuya)", cost: "cheap" },

  // ── Meta (system introspection) ──
  getExternalWorkerLanes: { family: "meta", description: "Read live NOUR external-worker lanes with auth, health, quota, capabilities, and cost class", cost: "cheap", tags: ["worker", "routing"] },
  getExternalWorkerJob: { family: "meta", description: "Read durable status, result/error state, and Reality Ledger receipts for one external-worker job", cost: "cheap", tags: ["worker", "receipts"] },
  queueExternalWorkerJob: { family: "meta", description: "Queue a bounded external-worker job through NOUR's governed durable worker plane", cost: "medium", tags: ["worker", "routing", "durable"] },
  listTools: { family: "meta", description: "List available tools (self-reflection)", cost: "cheap" },
  toolHealth: { family: "meta", description: "Check tool health / recent failures", cost: "cheap" },
  getCronStatus: { family: "meta", description: "Query cron fire/fail status", cost: "cheap" },
  runCode: { family: "meta", description: "Execute a script (sandboxed)", cost: "medium" },
  searchTools: { family: "meta", description: "Find tools the pruner didn't load this turn (mid-turn recovery)", cost: "cheap", tags: ["recovery"] },
  invokeTool: { family: "meta", description: "Run a read-safe tool by name through the recovery lane (refuses mutations)", cost: "cheap", tags: ["recovery"] },
  queryData: { family: "meta", description: "Sandboxed JS over a read-only data API (join/filter across sources in one call)", cost: "cheap", tags: ["recovery", "sandbox"] },

  // ════════════════════════════════════════════════════════════════
  // 2026-07-11 review backfill · 54 previously-undocumented tools.
  // Descriptions extracted from the live tool({ description }) defs;
  // family/cost inferred from lib/ai/tools/catalog.ts categories.
  // Generated by scratch/gen-tool-families-backfill.ts — regenerate
  // rather than hand-editing when adding batches.
  // ════════════════════════════════════════════════════════════════

  // ── backfill 2026-07-11 · business-read ──
  getGscSummary: { family: "business-read", description: "Real Google Search Console totals for nickstire.org over a date range — clicks, impressions, CTR, average p…", cost: "cheap" },
  getGscTopQueries: { family: "business-read", description: "Top search queries driving organic traffic to nickstire.org from Google Search. Returns each query's clicks…", cost: "cheap" },
  getInstagramAutopostStatus: { family: "business-read", description: "Get the current status of the Instagram/Facebook autopost system, including the active configuration and a…", cost: "cheap" },
  getMarketingAttribution: { family: "business-read", description: "Source-by-source attribution for Nick's Tire & Auto leads. Returns lead count + conversion count + conversi…", cost: "cheap" },
  scoreLocation: { family: "business-read", description: "Evaluate a candidate address for a second shop. Returns a 0-100 score, tier (A=ship · F=don't), strongest +…", cost: "cheap" },
  setInstagramAutopostConfig: { family: "business-read", description: "Enable or disable the global Instagram/Facebook live autoposter configuration.", cost: "cheap" },
  triggerInstagramAutopost: { family: "business-read", description: "Run the Instagram Autopost pipeline immediately. Supports triggering dry-runs (evaluates but doesn't post)…", cost: "medium" },

  // ── backfill 2026-07-11 · cognition ──
  analyzeCompetitiveIntel: { family: "cognition", description: "Analyze competitive landscape for Nick's Tire. Identifies competitor vulnerabilities (Chanakya-style), GSC…", cost: "cheap" },
  analyzeComposure: { family: "cognition", description: "Analyze the operator's emotional regulation and composure. Scores mood stability, drift control, decision q…", cost: "cheap" },
  analyzeFitness: { family: "cognition", description: "Analyze Nour's workout CONSISTENCY from his OWN logged daily workout flags (daily check-in + /body, merged)…", cost: "cheap" },
  analyzeGoals: { family: "cognition", description: "Analyze Nour's active LifeGoals with the SMART framework (Specific/Measurable/Achievable/Relevant/Time-boun…", cost: "cheap" },
  analyzeMentalHealth: { family: "cognition", description: "Analyze Nour's mental/emotional wellbeing from his OWN logged data (mood, energy, sleep, stress, workouts,…", cost: "cheap" },
  analyzePowerDynamics: { family: "cognition", description: "Analyze Nour's power position across all relationships. Returns leverage scores (avg power balance, stronge…", cost: "cheap" },
  analyzeSleep: { family: "cognition", description: "Analyze Nour's sleep from his OWN logged nightly hours (daily check-in, with /body tracking as fallback) ov…", cost: "cheap" },
  analyzeTrends: { family: "cognition", description: "Detect what's changing across ALL of Nour's tracked daily metrics (mood, energy, sleep, dailyScore, deep-wo…", cost: "cheap" },
  analyzeWeightTrend: { family: "cognition", description: "Analyze Nour's weight + body-composition TREND from his OWN BodyTracking logs over a window. Returns weight…", cost: "cheap" },
  analyzeWorkHealth: { family: "cognition", description: "Analyze Nour's work-pattern health from his OWN logs (deep-work blocks + drift incidents from the daily che…", cost: "cheap" },
  findRelatedConversations: { family: "cognition", description: "Find past chat conversations semantically similar to a topic. Returns conversationId + summary + similarity…", cost: "cheap" },
  getContextualGreeneLaws: { family: "cognition", description: "Get the top 3 Robert Greene laws applicable to a specific person right now, with rationale and concrete act…", cost: "cheap" },
  getDarkPsychologyTactics: { family: "cognition", description: "Look up dark psychology tactics (cognitive biases, manipulation techniques, social engineering patterns) re…", cost: "cheap" },
  getPendingRevenueMoves: { family: "cognition", description: "List revenue-moves drafted by the Revenue-Decision Channel that are still pending operator approval. Use wh…", cost: "cheap" },
  getPowerBalanceSummary: { family: "cognition", description: "Get power-balance scores for the top 5 people by interaction count. Returns each person's name, power balan…", cost: "cheap" },
  getSkillProtocol: { family: "cognition", description: "Load the full step-by-step protocol for a bundled skill by exact name (e.g. 'maxforge-alpha'). suggestSkill…", cost: "cheap" },
  recommendNextMove: { family: "cognition", description: "Tactician: compose the single best concrete next move for a power/negotiation/rivalry situation — verbatim…", cost: "cheap" },
  resolveContradiction: { family: "cognition", description: "Persist the operator's chosen side after a CONTRADICTION ALERT. Call this when the operator confirms which…", cost: "cheap" },
  runPython: { family: "cognition", description: "ALWAYS CALL THIS TOOL when the operator asks you to RUN, EXECUTE, COMPUTE, CALCULATE, or PLOT anything in P…", cost: "cheap" },
  suggestSkills: { family: "cognition", description: "Find the best Claude skills (from the indexed skill registry) for the operator's current task or question.…", cost: "cheap" },
  surfaceAntiPatterns: { family: "cognition", description: "Pull the operator's recent anti-patterns (decisions that scored D/F + recurring drift loops + commitments o…", cost: "cheap" },

  // ── backfill 2026-07-11 · content-generation ──
  renderInlineChart: { family: "content-generation", description: "Render an inline chart in the chat reply. Use whenever Nour asks for a trend / distribution / comparison an…", cost: "cheap" },

  // ── backfill 2026-07-11 · integration-arsenal ──
  arsenalNotebookLM: { family: "integration-arsenal", description: "Use Google NotebookLM via the connected MCP server. Allows deep grounding against custom uploaded source do…", cost: "cheap" },
  browseAndDo: { family: "integration-arsenal", description: "Run a COMPLETE browser task autonomously: opens a cloud browser, plans + executes the steps, returns a rec…", cost: "expensive" },
  browser_act: { family: "integration-arsenal", description: "Execute a natural-language action on the open session's current page: click a button, fill a form field, se…", cost: "medium" },
  browser_do: { family: "integration-arsenal", description: "Start a live cloud browser session (headless Chrome) Nick can use to navigate sites, fill forms, extract da…", cost: "medium" },
  browser_extract: { family: "integration-arsenal", description: "Pull structured data from the open session's current page. Provide an instruction (what to look for) plus a…", cost: "medium" },
  browser_navigate: { family: "integration-arsenal", description: "Navigate the active cloud browser session to a URL. Requires a sessionId from a prior browser_do call. Retu…", cost: "cheap" },
  browser_observe: { family: "integration-arsenal", description: "Reconnaissance on the open session's current page. Returns a list of actionable elements (buttons, forms, l…", cost: "medium" },
  ingestDocumentFromUrl: { family: "integration-arsenal", description: "Fetch a public document from a URL and ingest it into the operator's document index. Returns the documentId…", cost: "cheap" },
  last30days: { family: "integration-arsenal", description: "Search and research a topic across live social platforms (Reddit, Hacker News, Polymarket, GitHub, YouTube)…", cost: "cheap" },
  moneyprinter: { family: "integration-arsenal", description: "Generate high-definition short videos automatically from a subject topic or a custom script. Uses MoneyPrin…", cost: "medium" },
  queueDeepResearch: { family: "integration-arsenal", description: "Queue deep research to run in the background — returns immediately; the cited report arrives as a push noti…", cost: "cheap" },
  scrapeWebPage: { family: "integration-arsenal", description: "Scrape a web page and convert it to clean markdown. Use when the operator shares a URL and says 'read this'…", cost: "cheap" },
  getTopDecisions: { family: "integration-arsenal", description: "Top revenue decisions from the nickstire opportunity queue (due-aware, consent-filtered, same read as the admin Decision Inbox). Read-only.", cost: "cheap" },
  draftOpportunitySms: { family: "integration-arsenal", description: "Deterministic evidence-only SMS draft for a Decision-Inbox opportunity (masked identity, risk label; call-first types refuse). Read-only.", cost: "cheap" },
  sendOpportunitySms: { family: "integration-arsenal", description: "STAGE an opportunity SMS for Nour's Telegram Approve tap — never sends directly; the tap calls nickstire's bounded gated send.", cost: "cheap" },
  getFleetTruth: { family: "integration-arsenal", description: "Cross-app operational fleet truth: statenour capability artifacts + nickstire health/schema-guard/self-healing. Read-only.", cost: "cheap" },
  fetchVideoTranscript: { family: "integration-arsenal", description: "English transcript + metadata of an allowlisted YouTube video via the policy-guarded yt-dlp lane. Fenced untrusted content.", cost: "cheap" },
  searchBuildYourOwnX: { family: "integration-arsenal", description: "Search the Build Your Own X tutorial catalog (450+ curated step-by-step guides for re-creating canonical te…", cost: "cheap" },
  searchDocuments: { family: "integration-arsenal", description: "Search across documents the operator has uploaded (PDFs, Word docs, spreadsheets, text files). Returns the…", cost: "cheap" },
  searchWebVerified: { family: "integration-arsenal", description: "Cross-verified web search across multiple sources (Perplexity + Tavily + Exa + Google Grounding + Perplexic…", cost: "medium" },

  // ── backfill 2026-07-11 · integration-telegram ──
  composeEmail: { family: "integration-telegram", description: "Draft an email for Nour to review and explicitly send. NEVER auto-sends — returns a draft card the user cli…", cost: "cheap" },
  stageCustomerAlert: { family: "integration-telegram", description: "Stage an SMS outreach to a customer for approval. Writes a PENDING ActionReceipt and sends a Telegram appro…", cost: "cheap" },

  // ── backfill 2026-07-11 · personal-read ──
  getTodaySchedule: { family: "personal-read", description: "Get the operator's Google Calendar events for today and the next few days. Returns event titles, times, loc…", cost: "cheap" },
  // 2026-09-02 self-audit · was `family: "personal-read", mutates: false` on a
  // tool whose description in this very line says it "writes the event
  // direc[tly]". The same-day C-5 fix corrected the CATALOG and missed this
  // second registry, so /system/tools kept under-reporting the family's
  // mutating count to the operator. tests/ai/tool-mutation-single-source.test.ts
  // pins the deletion of that second source, so the halves cannot drift again.
  proposeCalendarEvent: { family: "personal-write", description: "Create or propose a new Google Calendar event. Writes directly to the calendar when Google OAuth is configured; otherwise returns a prefilled compose URL.", cost: "cheap" },

  // ── backfill 2026-07-11 · personal-write ──
  archiveGoal: { family: "personal-write", description: "Archive a LifeGoal (soft-delete · preserves CoachLog + GoalEvent history · recoverable). Use when Nour says…", cost: "cheap" },
  logGoalProgress: { family: "personal-write", description: "Log progress on a LifeGoal · bumps currentValue + recalculates progress % + appends a GoalEvent(kind=progre…", cost: "cheap" },
  pinMemory: { family: "personal-write", description: "Pin a fact to long-term memory · creates a BrainMemory(category=pinned_user) row · surfaces in the brain's…", cost: "cheap" },
  snoozeTask: { family: "personal-write", description: "Snooze a task until a future date. Status flips to WAITING + snoozedUntil set · the task-resurface cron fli…", cost: "cheap" },
  updateTask: { family: "personal-write", description: "Update task fields · partial mutate (only provided fields change). Covers reframe (title / finishCondition)…", cost: "cheap" },
};

/**
 * Development-time guard — warns if `nourTools` has keys that the
 * registry doesn't know about. Call once from a long-lived module
 * (e.g., the chat route) so drift surfaces as a console.warn.
 */
export function assertToolFamiliesInSync(): {
  ok: boolean;
  missingFromRegistry: string[];
  missingFromTools: string[];
} {
  const toolKeys = new Set(Object.keys(nourTools));
  const regKeys = new Set(Object.keys(TOOL_FAMILIES));
  const missingFromRegistry = [...toolKeys].filter((k) => !regKeys.has(k));
  const missingFromTools = [...regKeys].filter((k) => !toolKeys.has(k));
  if (missingFromRegistry.length > 0 || missingFromTools.length > 0) {
    console.warn(
      `[tool-families] registry drift detected:`,
      { missingFromRegistry, missingFromTools },
    );
  }
  return {
    ok: missingFromRegistry.length === 0 && missingFromTools.length === 0,
    missingFromRegistry,
    missingFromTools,
  };
}

/**
 * Tool family groupings for /system/tools UI + per-family kill switches.
 */
export const FAMILY_DISPLAY: Readonly<
  Record<ToolFamily, { label: string; color: string; priority: number }>
> = {
  "personal-read": { label: "Personal · read", color: "sky", priority: 10 },
  "personal-write": { label: "Personal · write", color: "violet", priority: 20 },
  "business-read": { label: "Business · read", color: "emerald", priority: 30 },
  "business-write": { label: "Business · write", color: "amber", priority: 40 },
  "brain-search": { label: "Brain · search", color: "indigo", priority: 50 },
  "brain-write": { label: "Brain · write", color: "purple", priority: 60 },
  "content-generation": { label: "Content generation", color: "rose", priority: 70 },
  "integration-github": { label: "GitHub", color: "slate", priority: 80 },
  "integration-drive": { label: "Google Drive", color: "blue", priority: 85 },
  "integration-telegram": { label: "Telegram", color: "cyan", priority: 88 },
  "integration-nickstire": { label: "Nickstire (shop)", color: "orange", priority: 90 },
  "integration-arsenal": { label: "Arsenal (research)", color: "fuchsia", priority: 95 },
  cognition: { label: "Cognition", color: "pink", priority: 100 },
  planning: { label: "Planning", color: "yellow", priority: 110 },
  device: { label: "Device", color: "teal", priority: 120 },
  meta: { label: "Meta / self", color: "zinc", priority: 130 },
};
