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
  /** Does this tool MUTATE state (write to DB, send SMS, etc.) */
  mutates: boolean;
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
  getMasteryScores: { family: "personal-read", description: "Current mastery domain scores over last 12 rows", mutates: false, cost: "cheap" },
  getDriftAlerts: { family: "personal-read", description: "Unresolved drift alerts across domains", mutates: false, cost: "cheap" },
  getCommitments: { family: "personal-read", description: "Active commitments (active/in_progress)", mutates: false, cost: "cheap" },
  getTasks: { family: "personal-read", description: "INBOX/READY/DOING tasks with mission context", mutates: false, cost: "cheap" },
  getMissions: { family: "personal-read", description: "ACTIVE missions sorted by priority", mutates: false, cost: "cheap" },
  getHabitStreaks: { family: "personal-read", description: "Habit completion summary (last 7 days)", mutates: false, cost: "cheap" },
  getBodyData: { family: "personal-read", description: "Weight and body tracking history", mutates: false, cost: "cheap" },
  getFinancialSnapshot: { family: "personal-read", description: "Latest financial snapshot", mutates: false, cost: "cheap" },
  getProjections: { family: "personal-read", description: "AI-generated forward projections", mutates: false, cost: "medium" },
  getCameraIntelligence: { family: "personal-read", description: "Live camera/traffic data for the shop", mutates: false, cost: "medium", tags: ["shop", "camera"] },
  getDecisionReplays: { family: "personal-read", description: "Decisions due for review", mutates: false, cost: "cheap" },
  // v10.0.528 · Arc B F3 · today's queued 30d-replay prompts (already
  // composed by the cron · this is a pure-read).
  getDecisionsDueForReplay: { family: "personal-read", description: "Today's queued 30-day decision-replay prompts with wisdom citations", mutates: false, cost: "cheap" },
  getAttentionAlerts: { family: "personal-read", description: "Domain attention-starvation signals", mutates: false, cost: "cheap" },
  getBlindSpots: { family: "personal-read", description: "Critical blind spots from the detector", mutates: false, cost: "medium" },
  getEmotionalState: { family: "personal-read", description: "Rolling emotional arc snapshot", mutates: false, cost: "cheap" },
  getHabitRevenueCorrelation: { family: "personal-read", description: "Correlation: habit adherence vs revenue", mutates: false, cost: "medium" },
  getBrainHealth: { family: "personal-read", description: "Brain maturity + memory stats", mutates: false, cost: "cheap" },
  getEstimateLeaks: { family: "personal-read", description: "Customers who got estimates but didn't book", mutates: false, cost: "cheap", tags: ["revenue"] },
  getRecentReflections: { family: "personal-read", description: "Last N journal reflections", mutates: false, cost: "cheap" },
  searchReflections: { family: "personal-read", description: "FTS over journal reflections", mutates: false, cost: "cheap" },
  dailyPulse: { family: "personal-read", description: "Full today snapshot (scores + tasks + alerts)", mutates: false, cost: "cheap" },
  getWeeklyTargets: { family: "personal-read", description: "Current week's 3 targets", mutates: false, cost: "cheap" },
  checkCommitments: { family: "personal-read", description: "Commitment compliance check", mutates: false, cost: "cheap" },

  // ── Personal · write ──
  addTasksToProject: { family: "personal-write", description: "Create multiple tasks in bulk", mutates: true, cost: "cheap" },
  createTask: { family: "personal-write", description: "Create a new task", mutates: true, cost: "cheap" },
  completeTask: { family: "personal-write", description: "Mark a task done", mutates: true, cost: "cheap" },
  setTaskPriority: { family: "personal-write", description: "Re-rank a task's autoPriority", mutates: true, cost: "cheap" },
  resolveAlert: { family: "personal-write", description: "Resolve a drift alert", mutates: true, cost: "cheap" },
  // v10.0.75 · closeLoop / createLoop legacy aliases retired (canonical:
  // completeTask + createTask).
  createCommitment: { family: "personal-write", description: "Create a new commitment", mutates: true, cost: "cheap" },
  updateCommitment: { family: "personal-write", description: "Update commitment status", mutates: true, cost: "cheap" },
  updateMasteryScore: { family: "personal-write", description: "Update a mastery domain score", mutates: true, cost: "cheap" },
  setLifeGoal: { family: "personal-write", description: "Set a life-level goal", mutates: true, cost: "cheap" },
  markCommitmentBroken: { family: "personal-write", description: "Mark commitment broken (with reason)", mutates: true, cost: "cheap" },
  completeCommitment: { family: "personal-write", description: "Mark a commitment satisfied", mutates: true, cost: "cheap" },
  reviewDecisionReplay: { family: "personal-write", description: "Grade a past decision + log outcome", mutates: true, cost: "cheap" },
  setWeeklyTargets: { family: "personal-write", description: "Set this week's 3 targets", mutates: true, cost: "cheap" },
  setOKRs: { family: "personal-write", description: "Set objectives/key-results", mutates: true, cost: "cheap" },
  setMit: { family: "personal-write", description: "Set MIT (most important task)", mutates: true, cost: "cheap" },
  clearMit: { family: "personal-write", description: "Clear MIT slot", mutates: true, cost: "cheap" },
  createMissionPlan: { family: "personal-write", description: "Create a full mission plan with tasks", mutates: true, cost: "medium" },
  scheduleFollowUp: { family: "personal-write", description: "Schedule a follow-up reminder", mutates: true, cost: "cheap" },
  endOfDay: { family: "personal-write", description: "Run EOD debrief + log score", mutates: true, cost: "cheap" },
  weeklyReview: { family: "personal-write", description: "Generate weekly review summary", mutates: true, cost: "medium" },
  journalDecision: { family: "personal-write", description: "Log a decision to journal", mutates: true, cost: "cheap" },
  logSituation: { family: "personal-write", description: "Log a strategic situation", mutates: true, cost: "cheap" },

  // ── Business · read ──
  getShopSnapshot: { family: "business-read", description: "Current shop state (nickstire)", mutates: false, cost: "cheap", tags: ["nickstire"] },
  // v10.0.79 · getShopBriefing retired — dailyPulse covers same surface plus personal layer.
  getReviewStats: { family: "business-read", description: "Review statistics for the shop", mutates: false, cost: "cheap", tags: ["nickstire"] },
  getRevenueStats: { family: "business-read", description: "Revenue breakdown", mutates: false, cost: "cheap", tags: ["nickstire"] },
  getTopServices: { family: "business-read", description: "Top services by revenue", mutates: false, cost: "cheap", tags: ["nickstire"] },
  getDashboardSummary: { family: "business-read", description: "Admin dashboard rollup", mutates: false, cost: "cheap", tags: ["nickstire"] },
  // v10.0.79 · getLiveRevenue retired — subset of getRevenueStats({period:"day"})
  compareLiveRevenue: { family: "business-read", description: "Compare current vs prior period", mutates: false, cost: "cheap", tags: ["nickstire"] },
  compareCompetitors: { family: "business-read", description: "Benchmark vs competitor reviews", mutates: false, cost: "medium" },
  findCustomer: { family: "business-read", description: "Find customer by phone/email/name", mutates: false, cost: "cheap", tags: ["nickstire"] },
  queryNickstire: { family: "business-read", description: "Free-form nickstire query (escape hatch)", mutates: false, cost: "medium", tags: ["nickstire"] },
  // v10.0.526 · Arc C · F3 — weekly advisory read; analyzer runs in cron.
  pricingAdvisorySummary: { family: "business-read", description: "Read latest weekly pricing-strategy advisory (win rate, outliers, drafted experiments)", mutates: false, cost: "cheap", tags: ["nickstire", "advisory"] },

  // ── Business · write ──
  sendSMS: { family: "business-write", description: "Send SMS to one customer", mutates: true, cost: "cheap" },
  sendBulkSMS: { family: "business-write", description: "Send SMS to a segment", mutates: true, cost: "medium" },
  createQuickQuote: { family: "business-write", description: "Create a quote for a lead", mutates: true, cost: "cheap" },
  createPaymentLink: { family: "business-write", description: "Generate Stripe payment link", mutates: true, cost: "cheap" },
  triggerFollowUp: { family: "business-write", description: "Fire a follow-up sequence", mutates: true, cost: "cheap" },
  triageStaleLead: { family: "business-write", description: "Move stale lead → next action", mutates: true, cost: "cheap" },

  // ── Brain · search ──
  // v10.0.74 · searchBrainDumps retired (canonical: searchReflections,
  // which covers both Reflection rows + BrainDump entries with date range).
  searchMemories: { family: "brain-search", description: "Semantic search over BrainMemory", mutates: false, cost: "medium" },
  searchColdMemory: { family: "brain-search", description: "Search cold (archived) memory", mutates: false, cost: "medium" },
  searchSkills: { family: "brain-search", description: "Semantic search over 1,423 Claude skills installed locally", mutates: false, cost: "medium" },
  searchConversations: { family: "brain-search", description: "Search past Nick conversations", mutates: false, cost: "cheap" },
  searchGreeneLaws: { family: "brain-search", description: "Search Robert Greene's strategic laws", mutates: false, cost: "cheap" },
  checkAntiPattern: { family: "brain-search", description: "Check intent against anti-pattern library", mutates: false, cost: "cheap" },

  // ── Brain · write ──
  syncDriveMemory: { family: "brain-write", description: "Ingest Drive docs into BrainMemory", mutates: true, cost: "expensive" },
  syncCalendar: { family: "brain-write", description: "Ingest Google Calendar events into BrainMemory", mutates: true, cost: "expensive" },
  syncGmail: { family: "brain-write", description: "Ingest recent Gmail messages into statenour-os", mutates: true, cost: "expensive" },
  buildArchitectureMemory: { family: "brain-write", description: "Refresh architecture-of-self memory", mutates: true, cost: "medium" },
  learnCodingPreference: { family: "brain-write", description: "Save a coding preference rule", mutates: true, cost: "cheap" },
  syncKnowledge: { family: "brain-write", description: "Run knowledge-sync engine", mutates: true, cost: "expensive" },
  classifyThought: { family: "brain-write", description: "Classify a thought → BrainDump category", mutates: true, cost: "cheap" },

  // ── Content generation ──
  generateImage: { family: "content-generation", description: "Image generation (Venice/etc)", mutates: false, cost: "expensive" },
  generateSQL: { family: "content-generation", description: "Generate SQL from natural language", mutates: false, cost: "medium" },
  generateCode: { family: "content-generation", description: "Generate code snippet", mutates: false, cost: "medium" },
  summarize: { family: "content-generation", description: "Summarize arbitrary text", mutates: false, cost: "medium" },
  analyzeSentiment: { family: "content-generation", description: "Sentiment analysis", mutates: false, cost: "cheap" },
  extractData: { family: "content-generation", description: "Extract structured data from text", mutates: false, cost: "medium" },
  solveMath: { family: "content-generation", description: "Math / calc / reasoning", mutates: false, cost: "medium" },
  writeCreative: { family: "content-generation", description: "Creative writing / copy", mutates: false, cost: "medium" },
  analyzeImage: { family: "content-generation", description: "Vision analysis of an image", mutates: false, cost: "expensive" },

  // ── Integration · GitHub ──
  githubReadFile: { family: "integration-github", description: "Read a file from a GitHub repo", mutates: false, cost: "cheap" },
  githubReadMultiple: { family: "integration-github", description: "Read multiple files in one call", mutates: false, cost: "medium" },
  githubListFiles: { family: "integration-github", description: "List files in a repo path", mutates: false, cost: "cheap" },
  githubSearchCode: { family: "integration-github", description: "Search code across a repo", mutates: false, cost: "medium" },
  githubRecentCommits: { family: "integration-github", description: "Recent commits", mutates: false, cost: "cheap" },
  githubListRepos: { family: "integration-github", description: "List repos owned by user", mutates: false, cost: "cheap" },
  githubCreatePR: { family: "integration-github", description: "Open a pull request", mutates: true, cost: "medium" },
  githubCreateIssue: { family: "integration-github", description: "Open an issue", mutates: true, cost: "cheap" },
  getRepoMap: { family: "integration-github", description: "Map a repo's top-level structure", mutates: false, cost: "medium" },

  // ── Integration · Drive ──
  searchDriveFiles: { family: "integration-drive", description: "Search Drive files by name/content", mutates: false, cost: "medium" },
  readDriveFile: { family: "integration-drive", description: "Read a Drive doc's content", mutates: false, cost: "medium" },
  listRecentDriveFiles: { family: "integration-drive", description: "Recent Drive changes", mutates: false, cost: "cheap" },

  // ── Integration · Telegram ──
  // v10.0.75 · sendToTelegram legacy alias retired (canonical: sendTelegram).
  sendTelegram: { family: "integration-telegram", description: "Send a Telegram message", mutates: true, cost: "cheap" },

  // ── Integration · Arsenal (research) ──
  arsenalResearch: { family: "integration-arsenal", description: "Arsenal research agent (deep)", mutates: false, cost: "expensive" },
  arsenalWebSearch: { family: "integration-arsenal", description: "Arsenal web search", mutates: false, cost: "medium" },
  arsenalFindLeads: { family: "integration-arsenal", description: "Arsenal lead-finding agent", mutates: false, cost: "expensive" },
  arsenalPreTaskFanout: { family: "integration-arsenal", description: "Pre-task multi-lens fan-out for hard questions", mutates: false, cost: "expensive" },
  arsenalDeepResearch: { family: "integration-arsenal", description: "Multi-round autonomous research with citations", mutates: false, cost: "expensive" },
  arsenalMultiAgent: { family: "integration-arsenal", description: "Spawn N sub-agents in parallel + synthesize", mutates: false, cost: "expensive" },
  arsenalBoardConsult: { family: "integration-arsenal", description: "Convene an advisor board (multi-lens council) on a major decision", mutates: false, cost: "expensive" },
  arsenalGmailInbox: { family: "integration-arsenal", description: "List recent inbox threads", mutates: false, cost: "cheap" },
  arsenalGmailReadThread: { family: "integration-arsenal", description: "Read a specific thread", mutates: false, cost: "cheap" },

  // ── Cognition ──
  analyzeWeek: { family: "cognition", description: "Week-over-week pattern analysis", mutates: false, cost: "medium" },
  runSimulation: { family: "cognition", description: "Run a what-if simulation", mutates: false, cost: "expensive" },
  decisionPreFlight: { family: "cognition", description: "Pre-decision checklist", mutates: false, cost: "medium" },
  rankNextActions: { family: "cognition", description: "Rank candidate next actions", mutates: false, cost: "medium" },

  // ── Planning ──
  suggestMIT: { family: "planning", description: "Suggest MIT for today", mutates: false, cost: "medium" },

  // ── Device ──
  runDeviceCommand: { family: "device", description: "Dispatch a device command (Ring/Eufy/Tuya)", mutates: true, cost: "cheap" },

  // ── Meta (system introspection) ──
  listTools: { family: "meta", description: "List available tools (self-reflection)", mutates: false, cost: "cheap" },
  toolHealth: { family: "meta", description: "Check tool health / recent failures", mutates: false, cost: "cheap" },
  getCronStatus: { family: "meta", description: "Query cron fire/fail status", mutates: false, cost: "cheap" },
  runCode: { family: "meta", description: "Execute a script (sandboxed)", mutates: true, cost: "medium" },
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
