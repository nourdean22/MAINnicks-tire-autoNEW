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
  // `cost` was REMOVED 2026-10-11 (audit 10-X10): the catalog's tier is the one source (ToolMeta.cost).
  /** Tags for deeper filtering in the /system/tools UI. */
  tags?: string[];
}

/**
 * Authoritative family map. Keys MUST match the key in `nourTools`.
 */
export const TOOL_FAMILIES: Readonly<Record<string, ToolMetadata>> = {
  // ── Personal · read ──
  getMasteryScores: { family: "personal-read", description: "Current mastery domain scores over last 12 rows" },
  getDriftAlerts: { family: "personal-read", description: "Unresolved drift alerts across domains" },
  getCommitments: { family: "personal-read", description: "Active commitments (active/in_progress)" },
  getRelationshipPicks: { family: "personal-read", description: "Today's relationship picks (same as /people): why, days quiet, open promises, calendar" },
  getAgendaItems: { family: "personal-read", description: "Active agenda items - witnessed commitments, intentions, contradictions, neglect alerts (JIT complement to the gated inline agenda section)" },
  getTasks: { family: "personal-read", description: "INBOX/READY/DOING tasks with mission context" },
  getTaskDetails: { family: "personal-read", description: "One task in full: notes, photo captions, parent, subtasks" },
  getMissions: { family: "personal-read", description: "ACTIVE missions sorted by priority" },
  getMissionDetail: { family: "personal-read", description: "One mission with task progress, next actions, deadline health" },
  getHabitStreaks: { family: "personal-read", description: "Habit completion summary (last 7 days)" },
  getBodyData: { family: "personal-read", description: "Weight and body tracking history" },
  getHealthToday: { family: "personal-read", description: "Today's health snapshot (sleep, weight, steps, resting HR, HRV) with sync freshness" },
  getSleepTrend: { family: "personal-read", description: "Sleep-hours series with coverage over the last N days" },
  getFinancialSnapshot: { family: "personal-read", description: "Latest financial snapshot" },
  getCameraIntelligence: { family: "personal-read", description: "Live camera/traffic data for the shop", tags: ["shop", "camera"] },
  // v10.0.528 · Arc B F3 · today's queued 30d-replay prompts (already
  // composed by the cron · this is a pure-read).
  getAttentionAlerts: { family: "personal-read", description: "Domain attention-starvation signals" },
  getBlindSpots: { family: "personal-read", description: "Critical blind spots from the detector" },
  getEmotionalState: { family: "personal-read", description: "Rolling emotional arc snapshot" },
  getHabitRevenueCorrelation: { family: "personal-read", description: "Correlation: habit adherence vs revenue" },
  getBrainHealth: { family: "personal-read", description: "Brain maturity + memory stats" },
  getEstimateLeaks: { family: "personal-read", description: "Customers who got estimates but didn't book", tags: ["revenue"] },
  getRecentReflections: { family: "personal-read", description: "Last N journal reflections" },
  searchReflections: { family: "personal-read", description: "FTS over journal reflections" },
  dailyPulse: { family: "personal-read", description: "Full today snapshot (scores + tasks + alerts)" },
  getWeeklyTargets: { family: "personal-read", description: "Current week's 3 targets" },
  checkCommitments: { family: "personal-read", description: "Commitment compliance check" },

  // ── Personal · write ──
  addTasksToProject: { family: "personal-write", description: "Create multiple tasks in bulk" },
  createTask: { family: "personal-write", description: "Create a new task" },
  completeTask: { family: "personal-write", description: "Mark a task done" },
  triggerBrief: { family: "personal-write", description: "Generate the daily executive brief on demand from current intelligence" },
  setTaskPriority: { family: "personal-write", description: "Re-rank a task's autoPriority" },
  resolveAlert: { family: "personal-write", description: "Resolve a drift alert" },
  // v10.0.75 · closeLoop / createLoop legacy aliases retired (canonical:
  // completeTask + createTask).
  createCommitment: { family: "personal-write", description: "Create a new commitment" },
  completeCommitment: { family: "personal-write", description: "Mark a commitment satisfied" },
  reviewDecisionReplay: { family: "personal-write", description: "Grade a past decision + log outcome" },
  setWeeklyTargets: { family: "personal-write", description: "Set this week's 3 targets" },
  setOKRs: { family: "personal-write", description: "Set objectives/key-results" },
  setMit: { family: "personal-write", description: "Set MIT (most important task)" },
  clearMit: { family: "personal-write", description: "Clear MIT slot" },
  createMissionPlan: { family: "personal-write", description: "Create a full mission plan with tasks" },
  queueMissionExecution: { family: "personal-write", description: "Queue bounded durable background execution for an active mission" },
  scheduleFollowUp: { family: "personal-write", description: "Schedule a follow-up reminder" },
  endOfDay: { family: "personal-write", description: "Run EOD debrief + log score" },
  weeklyReview: { family: "personal-write", description: "Generate weekly review summary" },
  journalDecision: { family: "personal-write", description: "Log a decision to journal" },
  logSituation: { family: "personal-write", description: "Log a strategic situation" },

  // ── Business · read ──
  getShopSnapshot: { family: "business-read", description: "Current shop state (nickstire)", tags: ["nickstire"] },
  // v10.0.79 · getShopBriefing retired — dailyPulse covers same surface plus personal layer.
  getReviewStats: { family: "business-read", description: "Review statistics for the shop", tags: ["nickstire"] },
  getRevenueStats: { family: "business-read", description: "Revenue breakdown", tags: ["nickstire"] },
  getDashboardSummary: { family: "business-read", description: "Admin dashboard rollup", tags: ["nickstire"] },
  // v10.0.79 · getLiveRevenue retired — subset of getRevenueStats({period:"day"})
  compareLiveRevenue: { family: "business-read", description: "Compare current vs prior period", tags: ["nickstire"] },
  findCustomer: { family: "business-read", description: "Find customer by phone/email/name", tags: ["nickstire"] },
  queryNickstire: { family: "business-read", description: "Free-form nickstire query (escape hatch)", tags: ["nickstire"] },
  // v10.0.526 · Arc C · F3 — weekly advisory read; analyzer runs in cron.

  // ── Business · write ──
  // 2026-07-11 review · sendSMS / sendBulkSMS / createPaymentLink /
  // triggerFollowUp removed — those tools were deleted in the v7 cleanup
  // (Apr 28, documented in catalog.ts) and their registry entries made
  // /system/tools list 4 tools that no longer exist. Phantom entries are
  // now a FAILING test (tests/ai/tool-families-drift.test.ts), not a warn.

  // ── Brain · search ──
  // v10.0.74 · searchBrainDumps retired (canonical: searchReflections,
  // which covers both Reflection rows + BrainDump entries with date range).
  searchMemories: { family: "brain-search", description: "Semantic search over BrainMemory" },
  searchColdMemory: { family: "brain-search", description: "Search cold (archived) memory" },
  searchGreeneLaws: { family: "brain-search", description: "Search Robert Greene's strategic laws" },
  checkAntiPattern: { family: "brain-search", description: "Check intent against anti-pattern library" },

  // ── Brain · write ──
  syncDriveMemory: { family: "brain-write", description: "Ingest Drive docs into BrainMemory" },
  syncCalendar: { family: "brain-write", description: "Ingest Google Calendar events into BrainMemory" },
  syncGmail: { family: "brain-write", description: "Ingest recent Gmail messages into statenour-os" },
  syncKnowledge: { family: "brain-write", description: "Run knowledge-sync engine" },
  classifyThought: { family: "brain-write", description: "Classify a thought -> BrainDump category" },

  // ── Content generation ──
  generateImage: { family: "content-generation", description: "Image generation (Venice/etc)" },
  summarize: { family: "content-generation", description: "Summarize arbitrary text" },
  writeCreative: { family: "content-generation", description: "Creative writing / copy" },

  // ── Integration · GitHub ──
  githubReadFile: { family: "integration-github", description: "Read a file from a GitHub repo" },
  githubListFiles: { family: "integration-github", description: "List files in a repo path" },
  githubSearchCode: { family: "integration-github", description: "Search code across a repo" },
  githubRecentCommits: { family: "integration-github", description: "Recent commits" },
  githubListRepos: { family: "integration-github", description: "List repos owned by user" },
  getRepoMap: { family: "integration-github", description: "Map a repo's top-level structure" },

  // ── Integration · Drive ──

  // ── Integration · Telegram ──
  // v10.0.75 · sendToTelegram legacy alias retired (canonical: sendTelegram).
  sendTelegram: { family: "integration-telegram", description: "Send a Telegram message" },

  // ── Integration · Arsenal (research) ──
  arsenalResearch: { family: "integration-arsenal", description: "Arsenal research agent (deep)" },
  arsenalWebSearch: { family: "integration-arsenal", description: "Arsenal web search" },
  arsenalPreTaskFanout: { family: "integration-arsenal", description: "Pre-task multi-lens fan-out for hard questions" },
  arsenalDeepResearch: { family: "integration-arsenal", description: "Multi-round autonomous research with citations" },
  arsenalMultiAgent: { family: "integration-arsenal", description: "Spawn N sub-agents in parallel + synthesize" },

  // ── Cognition ──
  runSimulation: { family: "cognition", description: "Run a what-if simulation" },
  rankNextActions: { family: "cognition", description: "Rank candidate next actions" },

  // ── Planning ──

  // ── Device ──
  runDeviceCommand: { family: "device", description: "Dispatch a device command (Ring/Eufy/Tuya)" },

  // ── Meta (system introspection) ──
  getExternalWorkerLanes: { family: "meta", description: "Read live NOUR external-worker lanes with auth, health, quota, capabilities, and cost class", tags: ["worker", "routing"] },
  getExternalWorkerJob: { family: "meta", description: "Read durable status, result/error state, and Reality Ledger receipts for one external-worker job", tags: ["worker", "receipts"] },
  toolHealth: { family: "meta", description: "Check tool health / recent failures" },
  getCronStatus: { family: "meta", description: "Query cron fire/fail status" },
  runCode: { family: "meta", description: "Execute a script (sandboxed)" },
  searchTools: { family: "meta", description: "Find tools the pruner didn't load this turn (mid-turn recovery)", tags: ["recovery"] },
  invokeTool: { family: "meta", description: "Run a read-safe tool by name through the recovery lane (refuses mutations)", tags: ["recovery"] },

  // ════════════════════════════════════════════════════════════════
  // 2026-07-11 review backfill · 54 previously-undocumented tools.
  // Descriptions extracted from the live tool({ description }) defs;
  // family inferred from lib/ai/tools/catalog.ts categories.
  // Generated by scratch/gen-tool-families-backfill.ts — regenerate
  // rather than hand-editing when adding batches.
  // ════════════════════════════════════════════════════════════════

  // ── backfill 2026-07-11 · business-read ──
  getGscSummary: { family: "business-read", description: "Real Google Search Console totals for nickstire.org over a date range - clicks, impressions, CTR, average p..." },
  getGscTopQueries: { family: "business-read", description: "Top search queries driving organic traffic to nickstire.org from Google Search. Returns each query's clicks..." },
  getMarketingAttribution: { family: "business-read", description: "Source-by-source attribution for Nick's Tire & Auto leads. Returns lead count + conversion count + conversi..." },
  scoreLocation: { family: "business-read", description: "Evaluate a candidate address for a second shop. Returns a 0-100 score, tier (A=ship - F=don't), strongest +..." },

  // ── backfill 2026-07-11 · cognition ──
  analyzeCompetitiveIntel: { family: "cognition", description: "Analyze competitive landscape for Nick's Tire. Identifies competitor vulnerabilities (Chanakya-style), GSC..." },
  analyzeComposure: { family: "cognition", description: "Analyze the operator's emotional regulation and composure. Scores mood stability, drift control, decision q..." },
  analyzeFitness: { family: "cognition", description: "Analyze Nour's workout CONSISTENCY from his OWN logged daily workout flags (daily check-in + /body, merged)..." },
  analyzeGoals: { family: "cognition", description: "Analyze Nour's active LifeGoals with the SMART framework (Specific/Measurable/Achievable/Relevant/Time-boun..." },
  analyzeMentalHealth: { family: "cognition", description: "Analyze Nour's mental/emotional wellbeing from his OWN logged data (mood, energy, sleep, stress, workouts,..." },
  analyzePowerDynamics: { family: "cognition", description: "Analyze Nour's power position across all relationships. Returns leverage scores (avg power balance, stronge..." },
  analyzeSleep: { family: "cognition", description: "Analyze Nour's sleep from his OWN logged nightly hours (daily check-in, with /body tracking as fallback) ov..." },
  analyzeTrends: { family: "cognition", description: "Detect what's changing across ALL of Nour's tracked daily metrics (mood, energy, sleep, dailyScore, deep-wo..." },
  analyzeWeightTrend: { family: "cognition", description: "Analyze Nour's weight + body-composition TREND from his OWN BodyTracking logs over a window. Returns weight..." },
  analyzeWorkHealth: { family: "cognition", description: "Analyze Nour's work-pattern health from his OWN logs (deep-work blocks + drift incidents from the daily che..." },
  findRelatedConversations: { family: "cognition", description: "Find past chat conversations semantically similar to a topic. Returns conversationId + summary + similarity..." },
  getContextualGreeneLaws: { family: "cognition", description: "Get the top 3 Robert Greene laws applicable to a specific person right now, with rationale and concrete act..." },
  getDarkPsychologyTactics: { family: "cognition", description: "Look up dark psychology tactics (cognitive biases, manipulation techniques, social engineering patterns) re..." },
  getPowerBalanceSummary: { family: "cognition", description: "Get power-balance scores for the top 5 people by interaction count. Returns each person's name, power balan..." },
  getSkillProtocol: { family: "cognition", description: "Load the full step-by-step protocol for a bundled skill by exact name (e.g. 'maxforge-alpha'). suggestSkill..." },
  resolveContradiction: { family: "cognition", description: "Close an open claim-vs-record contradiction after Nour answers a CLAIM VS RECORD, ONE OPEN CONTRADICTION o..." },
  suggestSkills: { family: "cognition", description: "Find the best Claude skills (from the indexed skill registry) for the operator's current task or question...." },

  // ── backfill 2026-07-11 · content-generation ──

  // ── backfill 2026-07-11 · integration-arsenal ──
  arsenalNotebookLM: { family: "integration-arsenal", description: "Use Google NotebookLM via the connected MCP server. Allows deep grounding against custom uploaded source do..." },
  browseAndDo: { family: "integration-arsenal", description: "Run a COMPLETE browser task autonomously: opens a cloud browser, plans + executes the steps, returns a rec..." },
  browser_do: { family: "integration-arsenal", description: "Start a live cloud browser session (headless Chrome) Nick can use to navigate sites, fill forms, extract da..." },
  browser_navigate: { family: "integration-arsenal", description: "Navigate the active cloud browser session to a URL. Requires a sessionId from a prior browser_do call. Retu..." },
  ingestDocumentFromUrl: { family: "integration-arsenal", description: "Fetch a public document from a URL and ingest it into the operator's document index. Returns the documentId..." },
  last30days: { family: "integration-arsenal", description: "Search and research a topic across live social platforms (Reddit, Hacker News, Polymarket, GitHub, YouTube)..." },
  moneyprinter: { family: "integration-arsenal", description: "Generate high-definition short videos automatically from a subject topic or a custom script. Uses MoneyPrin..." },
  queueDeepResearch: { family: "integration-arsenal", description: "Queue deep research to run in the background - returns immediately; the cited report arrives as a push noti..." },
  scrapeWebPage: { family: "integration-arsenal", description: "Scrape a web page and convert it to clean markdown. Use when the operator shares a URL and says 'read this'..." },
  getTopDecisions: { family: "integration-arsenal", description: "Top revenue decisions from the nickstire opportunity queue (due-aware, consent-filtered, same read as the admin Decision Inbox). Read-only." },
  draftOpportunitySms: { family: "integration-arsenal", description: "Deterministic evidence-only SMS draft for a Decision-Inbox opportunity (masked identity, risk label; call-first types refuse). Read-only." },
  sendOpportunitySms: { family: "integration-arsenal", description: "STAGE an opportunity SMS for Nour's Telegram Approve tap - never sends directly; the tap calls nickstire's bounded gated send." },
  getFleetTruth: { family: "integration-arsenal", description: "Cross-app operational fleet truth: statenour capability artifacts + nickstire health/schema-guard/self-healing. Read-only." },
  fetchVideoTranscript: { family: "integration-arsenal", description: "English transcript + metadata of an allowlisted YouTube video via the policy-guarded yt-dlp lane. Fenced untrusted content." },
  searchDocuments: { family: "integration-arsenal", description: "Search across documents the operator has uploaded (PDFs, Word docs, spreadsheets, text files). Returns the..." },
  searchWebVerified: { family: "integration-arsenal", description: "Cross-verified web search across multiple sources (Perplexity + Tavily + Exa + Google Grounding + Perplexic..." },

  // ── backfill 2026-07-11 · integration-telegram ──
  composeEmail: { family: "integration-telegram", description: "Draft an email for Nour to review and explicitly send. NEVER auto-sends - returns a draft card the user cli..." },
  stageCustomerAlert: { family: "integration-telegram", description: "Stage an SMS outreach to a customer for approval. Writes a PENDING ActionReceipt and sends a Telegram appro..." },

  // ── backfill 2026-07-11 · personal-read ──
  getTodaySchedule: { family: "personal-read", description: "Get the operator's Google Calendar events for today and the next few days. Returns event titles, times, loc..." },
  // 2026-09-02 self-audit · was `family: "personal-read", mutates: false` on a
  // tool whose description in this very line says it "writes the event
  // direc[tly]". The same-day C-5 fix corrected the CATALOG and missed this
  // second registry, so /system/tools kept under-reporting the family's
  // mutating count to the operator. tests/ai/tool-mutation-single-source.test.ts
  // pins the deletion of that second source, so the halves cannot drift again.
  proposeCalendarEvent: { family: "personal-write", description: "Create an event on Nour's own Google Calendar, read back before it is claimed; when his calendar is not connected, returns a prefilled compose URL instead." },
  moveCalendarEvent: { family: "personal-write", description: "Move an event on Nour's own Google Calendar to a new time, read back before it is claimed." },
  deleteCalendarEvent: { family: "personal-write", description: "Delete an event from Nour's own Google Calendar, proven gone by a read-back." },

  // ── backfill 2026-07-11 · personal-write ──
  archiveGoal: { family: "personal-write", description: "Archive a LifeGoal (soft-delete - preserves CoachLog + GoalEvent history - recoverable). Use when Nour says..." },
  pinMemory: { family: "personal-write", description: "Pin a fact to long-term memory - creates a BrainMemory(category=pinned_user) row - surfaces in the brain's..." },
  snoozeTask: { family: "personal-write", description: "Snooze a task until a future date. Status flips to WAITING + snoozedUntil set - the task-resurface cron fli..." },
  updateTask: { family: "personal-write", description: "Update task fields - partial mutate (only provided fields change). Covers reframe (title / finishCondition)..." },
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
