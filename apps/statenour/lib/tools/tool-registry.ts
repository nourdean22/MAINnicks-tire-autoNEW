export type ToolRiskClass = "low" | "medium" | "high" | "critical";

export type ToolStatus =
  | "active"
  | "restricted_active"
  | "scaffolded"
  | "inert"
  | "blocked";

export type ApprovalPolicy =
  | "none"
  | "auto_low_risk"
  | "owner_required"
  | "screenshot_required"
  | "manual_only"
  | "memory_review_required";

export type ToolCategory =
  | "web"
  | "document"
  | "media"
  | "browser"
  | "memory"
  | "development"
  | "communication"
  | "calendar"
  | "local"
  | "code"
  | "system";

export interface ToolCapability {
  id: string;
  label: string;
  description: string;
  category: ToolCategory;

  status: ToolStatus;
  riskClass: ToolRiskClass;

  readAccess: boolean;
  writeAccess: boolean;
  externalMutation: boolean;
  memoryWriteAllowed: boolean;

  approvalPolicy: ApprovalPolicy;

  requiredEnv: string[];
  optionalEnv?: string[];

  allowedDomains?: string[];
  blockedDomains?: string[];

  timeoutMs?: number;
  dailyLimit?: number;
  monthlyLimit?: number;
  costClass?: "free" | "low" | "medium" | "high";

  auditLogRequired: boolean;
  ownerOnly?: boolean;

  currentLimitations: string[];
  notes?: string;
}

export type ToolHealthStatus =
  | "active"
  | "missing_env"
  | "inert"
  | "blocked"
  | "degraded";

export interface ToolHealthInfo {
  id: string;
  status: ToolStatus;
  health: ToolHealthStatus;
  missingEnv: string[];
  riskClass: ToolRiskClass;
}

export const TOOL_REGISTRY: Record<string, ToolCapability> = {
  "web.search.verified": {
    id: "web.search.verified",
    label: "Web Search (Verified)",
    description: "Cross-verified web search across Perplexity, Tavily, Exa, and Google Grounding. Returns consensus when sources agree.",
    category: "web",
    status: "active",
    riskClass: "low",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: [],
    optionalEnv: ["PERPLEXITY_API_KEY", "TAVILY_API_KEY", "EXA_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    auditLogRequired: false,
    currentLimitations: ["Requires active third-party API keys.", "Can be slow due to multi-source consensus checking."],
    costClass: "medium",
    notes: "Primary tool for fact verification in chat."
  },
  "web.search.arsenal": {
    id: "web.search.arsenal",
    label: "Web Search (Arsenal)",
    description: "Single-source Perplexity/Google web search with AI-powered summarization.",
    category: "web",
    status: "active",
    riskClass: "low",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: [],
    optionalEnv: ["PERPLEXITY_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    auditLogRequired: false,
    currentLimitations: ["No cross-source verification."],
    costClass: "low"
  },
  // 2026-07-05 · Per-SOURCE guardian IDs. The aggregate tools above
  // (web.search.verified / web.search.arsenal) fan out to individual
  // providers, and each provider call is wrapped by withGuardian("<source>")
  // (lib/ai/multi-search.ts, lib/integrations/google-search.ts, perplexity.ts,
  // exa). Those source IDs were NOT in this registry, so evaluateToolAction
  // denied every one as "Unknown tool ID" — which is why chat web search
  // returned "All sources failed: … Action denied: Unknown tool ID: …" and
  // never worked. Registered here as low-risk read-only. requiredEnv is []
  // (matching the aggregates) so the guardian allows the call; each source
  // does its own key check and is skipped gracefully when its key is absent.
  "google-search": {
    id: "google-search",
    label: "Web Search — Google Grounding",
    description: "Gemini native Google Search grounding source.",
    category: "web",
    status: "active",
    riskClass: "low",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: [],
    optionalEnv: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    auditLogRequired: false,
    currentLimitations: ["Metered beyond Gemini's free grounding quota."],
    costClass: "low"
  },
  "perplexity-search": {
    id: "perplexity-search",
    label: "Web Search — Perplexity",
    description: "Perplexity web search source.",
    category: "web",
    status: "active",
    riskClass: "low",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: [],
    optionalEnv: ["PERPLEXITY_API_KEY"],
    auditLogRequired: false,
    currentLimitations: ["Requires PERPLEXITY_API_KEY."],
    costClass: "low"
  },
  "tavily-search": {
    id: "tavily-search",
    label: "Web Search — Tavily",
    description: "Tavily web search source.",
    category: "web",
    status: "active",
    riskClass: "low",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: [],
    optionalEnv: ["TAVILY_API_KEY"],
    auditLogRequired: false,
    currentLimitations: ["Requires TAVILY_API_KEY."],
    costClass: "low"
  },
  "exa-search": {
    id: "exa-search",
    label: "Web Search — Exa",
    description: "Exa neural web search source.",
    category: "web",
    status: "active",
    riskClass: "low",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: [],
    optionalEnv: ["EXA_API_KEY"],
    auditLogRequired: false,
    currentLimitations: ["Requires EXA_API_KEY."],
    costClass: "low"
  },
  "judge-eval": {
    id: "judge-eval",
    label: "LLM-as-judge Evaluation",
    description: "Evaluates Nick assistant replies using a fast LLM against a 5-axis rubric.",
    category: "system",
    status: "active",
    riskClass: "low",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: [],
    auditLogRequired: false,
    currentLimitations: [],
    costClass: "low"
  },
  "document.ingest_url": {
    id: "document.ingest_url",
    label: "Ingest Document from URL",
    description: "Fetch a public document from a URL and ingest it into the document vector store.",
    category: "document",
    status: "restricted_active",
    riskClass: "medium",
    readAccess: true,
    writeAccess: true,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "auto_low_risk",
    requiredEnv: [],
    auditLogRequired: true,
    dailyLimit: 50,
    currentLimitations: ["Max size 20MB.", "Supports PDF, DOCX, XLSX, TXT, MD.", "Protected by private IP/DNS blocklist."],
    costClass: "low",
    notes: "Protected against SSRF and prompt injection."
  },
  "document.drive_read": {
    id: "document.drive_read",
    label: "Read Google Drive File",
    description: "Search and read the contents of a Google Drive document by file ID.",
    category: "document",
    status: "restricted_active",
    riskClass: "low",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: ["GOOGLE_SERVICE_ACCOUNT_KEY"],
    auditLogRequired: true,
    currentLimitations: ["Only reads Google Docs, Sheets, and plain text/markdown."],
    costClass: "free"
  },
  "media.session_search": {
    id: "media.session_search",
    label: "Search Session Recordings",
    description: "Search across the operator's captured session recordings using VideoDB.",
    category: "media",
    status: "active",
    riskClass: "low",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: ["VIDEO_DB_API_KEY"],
    auditLogRequired: false,
    currentLimitations: ["Relies on external operator capturing sessions."],
    costClass: "low"
  },
  "media.session_recall": {
    id: "media.session_recall",
    label: "Recall from Session",
    description: "Search session recordings within a specific date range.",
    category: "media",
    status: "active",
    riskClass: "low",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: ["VIDEO_DB_API_KEY"],
    auditLogRequired: false,
    currentLimitations: ["Dates must be ISO YYYY-MM-DD."],
    costClass: "low"
  },
  "browser.navigate": {
    id: "browser.navigate",
    label: "Browser Navigation",
    description: "Navigate a headless browser (via Browserbase/Stagehand) to external pages.",
    category: "browser",
    status: "inert",
    riskClass: "high",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "screenshot_required",
    requiredEnv: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"],
    auditLogRequired: true,
    currentLimitations: ["Intentionally parked - operator uses Claude-in-Chrome + computer-use for browser work; Stagehand SDK not installed."],
    costClass: "medium"
  },
  "browser.observe": {
    id: "browser.observe",
    label: "Browser Observation",
    description: "Observe and screenshot/analyze elements in headless browser.",
    category: "browser",
    status: "inert",
    riskClass: "high",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"],
    auditLogRequired: false,
    currentLimitations: ["Intentionally parked - operator uses Claude-in-Chrome + computer-use for browser work; Stagehand SDK not installed."],
    costClass: "medium"
  },
  "browser.extract": {
    id: "browser.extract",
    label: "Browser Data Extraction",
    description: "Extract structured data from the current browser page.",
    category: "browser",
    status: "inert",
    riskClass: "high",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"],
    auditLogRequired: false,
    currentLimitations: ["Intentionally parked - operator uses Claude-in-Chrome + computer-use for browser work; Stagehand SDK not installed."],
    costClass: "medium"
  },
  "browser.act": {
    id: "browser.act",
    label: "Browser Act",
    description: "Perform clicks, typing, and form submissions in the browser.",
    category: "browser",
    status: "inert",
    riskClass: "critical",
    readAccess: true,
    writeAccess: true,
    externalMutation: true,
    memoryWriteAllowed: false,
    approvalPolicy: "screenshot_required",
    requiredEnv: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"],
    auditLogRequired: true,
    currentLimitations: ["Intentionally parked - operator uses Claude-in-Chrome + computer-use for browser work; Stagehand SDK not installed."],
    costClass: "high"
  },
  "memory.pin": {
    id: "memory.pin",
    label: "Pin Memory",
    description: "Write a facts-based memory permanently to BrainMemory.",
    category: "memory",
    status: "active",
    riskClass: "medium",
    readAccess: false,
    writeAccess: true,
    externalMutation: false,
    memoryWriteAllowed: true,
    approvalPolicy: "owner_required",
    requiredEnv: [],
    auditLogRequired: true,
    currentLimitations: ["Content must be pre-fenced if derived from external sources."],
    costClass: "free"
  },
  "memory.log_situation": {
    id: "memory.log_situation",
    label: "Log Situation",
    description: "Record a situation summary to the brain memory store.",
    category: "memory",
    status: "active",
    riskClass: "medium",
    readAccess: false,
    writeAccess: true,
    externalMutation: false,
    memoryWriteAllowed: true,
    approvalPolicy: "owner_required",
    requiredEnv: [],
    auditLogRequired: true,
    currentLimitations: [],
    costClass: "free"
  },
  "memory.resolve_contradiction": {
    id: "memory.resolve_contradiction",
    label: "Resolve Contradiction",
    description: "Audit and deprecate conflicting memory claims in BrainMemory.",
    category: "memory",
    status: "active",
    riskClass: "high",
    readAccess: true,
    writeAccess: true,
    externalMutation: false,
    memoryWriteAllowed: true,
    approvalPolicy: "memory_review_required",
    requiredEnv: [],
    auditLogRequired: true,
    currentLimitations: ["Slight latency when running semantic reconciliation."],
    costClass: "free"
  },
  "github.read_file": {
    id: "github.read_file",
    label: "GitHub Read File",
    description: "Read the contents of a file in any of Nour's GitHub repositories.",
    category: "development",
    status: "active",
    riskClass: "low",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: ["GITHUB_TOKEN"],
    auditLogRequired: false,
    currentLimitations: ["Limits read to 8000 characters to prevent prompt bloat."],
    costClass: "free"
  },
  "github.search_code": {
    id: "github.search_code",
    label: "GitHub Search Code",
    description: "Search for code snippets and matches across GitHub repositories.",
    category: "development",
    status: "active",
    riskClass: "low",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: ["GITHUB_TOKEN"],
    auditLogRequired: false,
    currentLimitations: [],
    costClass: "free"
  },
  "github.create_pr": {
    id: "github.create_pr",
    label: "GitHub Create PR",
    description: "Create a Pull Request for code changes on a repository.",
    category: "development",
    status: "restricted_active",
    riskClass: "high",
    readAccess: false,
    writeAccess: true,
    externalMutation: true,
    memoryWriteAllowed: false,
    approvalPolicy: "owner_required",
    requiredEnv: ["GITHUB_TOKEN"],
    auditLogRequired: true,
    currentLimitations: ["Cannot commit files directly; must only draft the PR."],
    costClass: "free"
  },
  "github.create_issue": {
    id: "github.create_issue",
    label: "GitHub Create Issue",
    description: "Create a new tracking issue on GitHub.",
    category: "development",
    status: "restricted_active",
    riskClass: "high",
    readAccess: false,
    writeAccess: true,
    externalMutation: true,
    memoryWriteAllowed: false,
    approvalPolicy: "owner_required",
    requiredEnv: ["GITHUB_TOKEN"],
    auditLogRequired: true,
    currentLimitations: [],
    costClass: "free"
  },
  "gmail.read_inbox": {
    id: "gmail.read_inbox",
    label: "Gmail Read Inbox",
    description: "List recent thread subjects, snippets, and unread flags from Gmail inbox.",
    category: "communication",
    status: "restricted_active",
    riskClass: "medium",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: ["GMAIL_REFRESH_TOKEN"],
    auditLogRequired: true,
    currentLimitations: ["Max 30 threads listed."],
    costClass: "free"
  },
  "gmail.read_thread": {
    id: "gmail.read_thread",
    label: "Gmail Read Thread",
    description: "Fetch and decode all messages in a specific Gmail thread.",
    category: "communication",
    status: "restricted_active",
    riskClass: "medium",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: ["GMAIL_REFRESH_TOKEN"],
    auditLogRequired: true,
    currentLimitations: ["Bodies truncated to 4000 characters."],
    costClass: "free"
  },
  "gmail.compose_draft_card": {
    id: "gmail.compose_draft_card",
    label: "Gmail Compose Draft Card",
    description: "Compose a draft email and write a draft card for operator approval/sending.",
    category: "communication",
    status: "restricted_active",
    riskClass: "high",
    readAccess: false,
    writeAccess: true,
    externalMutation: true,
    memoryWriteAllowed: false,
    approvalPolicy: "owner_required",
    requiredEnv: ["GMAIL_REFRESH_TOKEN"],
    auditLogRequired: true,
    currentLimitations: ["Never directly sends the email; requires explicit user click to send."],
    costClass: "free"
  },
  "calendar.read_today": {
    id: "calendar.read_today",
    label: "Calendar Read Today",
    description: "Read operator's calendar schedule for today and next few days.",
    category: "calendar",
    status: "active",
    riskClass: "low",
    readAccess: true,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: ["GOOGLE_SERVICE_ACCOUNT_KEY"],
    auditLogRequired: false,
    currentLimitations: ["Max 14 days ahead."],
    costClass: "free"
  },
  "calendar.propose_event_link": {
    id: "calendar.propose_event_link",
    label: "Calendar Propose Event Link",
    description: "Generate a pre-filled Google Calendar event template URL for operator click confirmation.",
    category: "calendar",
    status: "active",
    riskClass: "medium",
    readAccess: false,
    writeAccess: true,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "none",
    requiredEnv: [],
    auditLogRequired: false,
    currentLimitations: ["Falls back to link if Google Calendar OAuth is unconfigured."],
    costClass: "free",
    notes: "Safe because the event creation is delegated to a manual link click."
  },
  "code.run_js_vm": {
    id: "code.run_js_vm",
    label: "Run JavaScript VM",
    description: "Execute arbitrary JS in a local quick sandboxed VM instance.",
    category: "code",
    status: "active",
    riskClass: "critical",
    readAccess: true,
    writeAccess: true,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "manual_only",
    requiredEnv: [],
    auditLogRequired: true,
    currentLimitations: ["Isolated local VM, no internet access from VM."],
    costClass: "free"
  },
  "code.run_python_e2b": {
    id: "code.run_python_e2b",
    label: "Run Python (E2B)",
    description: "Execute Python code in an E2B secure sandboxed environment.",
    category: "code",
    status: "active",
    riskClass: "critical",
    readAccess: true,
    writeAccess: true,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "manual_only",
    requiredEnv: ["E2B_API_KEY"],
    auditLogRequired: true,
    currentLimitations: ["Sandboxed execution, limited to 100 runs per day."],
    costClass: "low"
  },
  "local.file_access": {
    id: "local.file_access",
    label: "Local File Access",
    description: "Read/write direct local host files.",
    category: "local",
    status: "blocked",
    riskClass: "critical",
    readAccess: false,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "manual_only",
    requiredEnv: [],
    auditLogRequired: true,
    currentLimitations: ["Explicitly blocked for safety."],
    costClass: "free"
  },
  "local.shell": {
    id: "local.shell",
    label: "Local Shell Execution",
    description: "Execute terminal shell commands on host operating system.",
    category: "local",
    status: "blocked",
    riskClass: "critical",
    readAccess: false,
    writeAccess: false,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "manual_only",
    requiredEnv: [],
    auditLogRequired: true,
    currentLimitations: ["Explicitly blocked for safety."],
    costClass: "free"
  },
  "shop.sendSms": {
    id: "shop.sendSms",
    label: "Send SMS to Customer",
    description: "Send outbound SMS communications to customers.",
    category: "communication",
    status: "active",
    riskClass: "high",
    readAccess: false,
    writeAccess: true,
    externalMutation: true,
    memoryWriteAllowed: false,
    approvalPolicy: "owner_required",
    requiredEnv: [],
    auditLogRequired: true,
    currentLimitations: [],
    costClass: "low"
  },
  "system.syncNow": {
    id: "system.syncNow",
    label: "Trigger Brain Sync",
    description: "Force immediate brain sync and cross-referencing.",
    category: "system",
    status: "active",
    riskClass: "high",
    readAccess: true,
    writeAccess: true,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "owner_required",
    requiredEnv: [],
    auditLogRequired: true,
    currentLimitations: [],
    costClass: "free"
  },
  "system.clearAlerts": {
    id: "system.clearAlerts",
    label: "Clear Drift Alerts",
    description: "Acknowledge all pending drift alerts.",
    category: "system",
    status: "active",
    riskClass: "high",
    readAccess: true,
    writeAccess: true,
    externalMutation: false,
    memoryWriteAllowed: false,
    approvalPolicy: "owner_required",
    requiredEnv: [],
    auditLogRequired: true,
    currentLimitations: [],
    costClass: "free"
  },
  "google.proposeEvent": {
    id: "google.proposeEvent",
    label: "Propose Calendar Event",
    description: "Propose or schedule a Google Calendar event.",
    category: "calendar",
    status: "active",
    riskClass: "high",
    readAccess: true,
    writeAccess: true,
    externalMutation: true,
    memoryWriteAllowed: false,
    approvalPolicy: "owner_required",
    requiredEnv: [],
    auditLogRequired: true,
    currentLimitations: [],
    costClass: "free"
  },
  "gmail.sendDraft": {
    id: "gmail.sendDraft",
    label: "Send Gmail Draft",
    description: "Send an existing Gmail draft email.",
    category: "communication",
    status: "active",
    riskClass: "high",
    readAccess: true,
    writeAccess: true,
    externalMutation: true,
    memoryWriteAllowed: false,
    approvalPolicy: "owner_required",
    requiredEnv: [],
    auditLogRequired: true,
    currentLimitations: [],
    costClass: "free"
  }
};

/** Get list of all tool capability definitions from the registry. */
export function getToolCapabilities(): ToolCapability[] {
  return Object.values(TOOL_REGISTRY);
}

function generateDynamicCapability(id: string): ToolCapability | null {
  const parts = id.split('.');
  if (parts.length < 2) return null;
  const prefix = parts[0];
  const suffix = parts.slice(1).join('.');

  const systemPrefixes = ["task", "loop", "commitment", "decision", "score", "alert", "habit", "simulation", "mission"];

  if (systemPrefixes.includes(prefix)) {
    return {
      id,
      label: `Dynamic ${prefix.charAt(0).toUpperCase() + prefix.slice(1)} Action (${suffix})`,
      description: `Dynamically resolved system capability for ${prefix}.${suffix}`,
      category: "system",
      status: "active",
      riskClass: "medium",
      readAccess: true,
      writeAccess: true,
      externalMutation: false,
      memoryWriteAllowed: false,
      approvalPolicy: "none",
      requiredEnv: [],
      auditLogRequired: true,
      currentLimitations: []
    };
  }

  if (prefix === "person") {
    const isWrite = /create|delete|remove/i.test(suffix);
    return {
      id,
      label: `Dynamic Person Action (${suffix})`,
      description: `Dynamically resolved relationship capability for person.${suffix}`,
      category: "system",
      status: "active",
      riskClass: isWrite ? "high" : "medium",
      readAccess: true,
      writeAccess: true,
      externalMutation: false,
      memoryWriteAllowed: false,
      approvalPolicy: isWrite ? "owner_required" : "none",
      requiredEnv: [],
      auditLogRequired: true,
      currentLimitations: []
    };
  }

  if (prefix === "memory") {
    const isWrite = /pin|write|log|resolve|create|update|delete/i.test(suffix);
    const isResolve = /resolve/i.test(suffix);
    return {
      id,
      label: `Dynamic Memory Action (${suffix})`,
      description: `Dynamically resolved memory capability for memory.${suffix}`,
      category: "memory",
      status: "active",
      riskClass: "medium",
      readAccess: true,
      writeAccess: true,
      externalMutation: false,
      memoryWriteAllowed: isWrite,
      approvalPolicy: isWrite ? (isResolve ? "memory_review_required" : "owner_required") : "none",
      requiredEnv: [],
      auditLogRequired: true,
      currentLimitations: []
    };
  }

  if (prefix === "system") {
    return {
      id,
      label: `Dynamic System Action (${suffix})`,
      description: `Dynamically resolved system control capability for system.${suffix}`,
      category: "system",
      status: "active",
      riskClass: "high",
      readAccess: true,
      writeAccess: true,
      externalMutation: false,
      memoryWriteAllowed: false,
      approvalPolicy: "owner_required",
      requiredEnv: [],
      auditLogRequired: true,
      currentLimitations: []
    };
  }

  if (prefix === "shop") {
    const isWrite = /send|update|create|delete|post|mutation|write|sms/i.test(suffix);
    return {
      id,
      label: `Dynamic Shop Action (${suffix})`,
      description: `Dynamically resolved business capability for shop.${suffix}`,
      category: "system",
      status: "active",
      riskClass: "high",
      readAccess: true,
      writeAccess: true,
      externalMutation: isWrite,
      memoryWriteAllowed: false,
      approvalPolicy: isWrite ? "owner_required" : "none",
      requiredEnv: [],
      auditLogRequired: true,
      currentLimitations: []
    };
  }

  if (prefix === "google" || prefix === "gmail") {
    const isWrite = /send|update|create|delete|post|mutation|write|draft|propose|schedule/i.test(suffix);
    return {
      id,
      label: `Dynamic ${prefix.charAt(0).toUpperCase() + prefix.slice(1)} Action (${suffix})`,
      description: `Dynamically resolved Google API capability for ${prefix}.${suffix}`,
      category: prefix === "google" ? "calendar" : "communication",
      status: "active",
      riskClass: "high",
      readAccess: true,
      writeAccess: true,
      externalMutation: isWrite,
      memoryWriteAllowed: false,
      approvalPolicy: isWrite ? "owner_required" : "none",
      requiredEnv: [],
      auditLogRequired: true,
      currentLimitations: []
    };
  }

  if (prefix === "telegram") {
    return {
      id,
      label: `Dynamic Telegram Action (${suffix})`,
      description: `Dynamically resolved Telegram communication capability for telegram.${suffix}`,
      category: "communication",
      status: "active",
      riskClass: "high",
      readAccess: true,
      writeAccess: true,
      externalMutation: true,
      memoryWriteAllowed: false,
      approvalPolicy: "owner_required",
      requiredEnv: [],
      auditLogRequired: true,
      currentLimitations: []
    };
  }

  if (prefix === "camera") {
    return {
      id,
      label: `Dynamic Camera Action (${suffix})`,
      description: `Dynamically resolved media capability for camera.${suffix}`,
      category: "media",
      status: "active",
      riskClass: "medium",
      readAccess: true,
      writeAccess: true,
      externalMutation: false,
      memoryWriteAllowed: false,
      approvalPolicy: "none",
      requiredEnv: [],
      auditLogRequired: true,
      currentLimitations: []
    };
  }

  if (prefix === "arsenal") {
    const lowerSuffix = suffix.toLowerCase();
    if (lowerSuffix.includes("browser")) {
      return {
        id,
        label: `Dynamic Arsenal Browser Action (${suffix})`,
        description: `Dynamically resolved browser automation capability for arsenal.${suffix}`,
        category: "browser",
        status: "active",
        riskClass: "high",
        readAccess: true,
        writeAccess: true,
        externalMutation: true,
        memoryWriteAllowed: false,
        approvalPolicy: "screenshot_required",
        requiredEnv: [],
        auditLogRequired: true,
        currentLimitations: []
      };
    } else if (lowerSuffix.includes("runpython") || lowerSuffix.includes("runjs") || lowerSuffix.includes("run_python") || lowerSuffix.includes("run_js")) {
      return {
        id,
        label: `Dynamic Arsenal Code Action (${suffix})`,
        description: `Dynamically resolved sandboxed code execution capability for arsenal.${suffix}`,
        category: "code",
        status: "active",
        riskClass: "critical",
        readAccess: true,
        writeAccess: true,
        externalMutation: false,
        memoryWriteAllowed: false,
        approvalPolicy: "manual_only",
        requiredEnv: [],
        auditLogRequired: true,
        currentLimitations: []
      };
    } else if (lowerSuffix.includes("websearch") || lowerSuffix.includes("research") || lowerSuffix.includes("search")) {
      return {
        id,
        label: `Dynamic Arsenal Search Action (${suffix})`,
        description: `Dynamically resolved web search capability for arsenal.${suffix}`,
        category: "web",
        status: "active",
        riskClass: "low",
        readAccess: true,
        writeAccess: false,
        externalMutation: false,
        memoryWriteAllowed: false,
        approvalPolicy: "none",
        requiredEnv: [],
        auditLogRequired: false,
        currentLimitations: []
      };
    } else {
      return {
        id,
        label: `Dynamic Arsenal Action (${suffix})`,
        description: `Dynamically resolved capability for arsenal.${suffix}`,
        category: "system",
        status: "active",
        riskClass: "medium",
        readAccess: true,
        writeAccess: true,
        externalMutation: false,
        memoryWriteAllowed: false,
        approvalPolicy: "none",
        requiredEnv: [],
        auditLogRequired: true,
        currentLimitations: []
      };
    }
  }

  return null;
}

/** Get capability definition for a specific tool ID. */
export function getToolCapability(id: string): ToolCapability | null {
  return TOOL_REGISTRY[id] ?? generateDynamicCapability(id);
}

/** Get list of required env keys that are missing in the current process. */
export function getMissingEnvForTool(id: string): string[] {
  const cap = getToolCapability(id);
  if (!cap) return [];
  const missing: string[] = [];
  for (const key of cap.requiredEnv) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }
  return missing;
}

/** Compute a health status summary for a tool based on env key presence. */
export function getToolHealthSummary(): ToolHealthInfo[] {
  return getToolCapabilities().map((cap) => {
    const missing = getMissingEnvForTool(cap.id);
    const hasRequired = missing.length === 0;

    let health: ToolHealthStatus = "active";
    if (cap.status === "blocked") {
      health = "blocked";
    } else if (cap.status === "inert") {
      // Parked-by-choice: env is irrelevant while inert, so it is NOT a setup
      // gap. Report "inert" (not "missing_env") and clear missingEnv so the
      // matrix's "Missing Setup Env" count only reflects tools we intend to run.
      health = "inert";
    } else if (!hasRequired) {
      health = "missing_env";
    } else if (cap.optionalEnv && cap.optionalEnv.some((key) => !process.env[key])) {
      health = "degraded";
    }

    return {
      id: cap.id,
      status: cap.status,
      health,
      missingEnv: cap.status === "inert" || cap.status === "blocked" ? [] : missing,
      riskClass: cap.riskClass
    };
  });
}
