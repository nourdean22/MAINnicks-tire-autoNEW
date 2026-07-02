/**
 * lib/mcp/tool-allowlist.ts
 *
 * HARD-CODED v1 allowlist for the MCP facade (docs/MCP-PLAN.md §3).
 *
 * The MCP endpoint never auto-exposes nourTools. Every externally
 * visible tool is named here by hand, and tests/mcp/tool-allowlist.test.ts
 * asserts each entry is catalog-verified read-only:
 *   · exists in TOOL_CATALOG and in nourTools
 *   · battle: true   (fast, read-only per the catalog contract)
 *   · NOT sideEffecting
 *   · NOT in MCP_FORBIDDEN_TOOLS (Tier 4)
 *
 * Adding a tool here is a permission-tier promotion — update
 * docs/MCP-PLAN.md and the tests in the same commit.
 */

/** Which ring a tool reads from (docs/MCP-PLAN.md §5 — never blur them). */
export type McpRing = "personal" | "business";

export interface McpAllowlistEntry {
  /** Key in nourTools / TOOL_CATALOG (camelCase). */
  toolName: string;
  /** Externally visible MCP tool name (snake_case). */
  mcpName: string;
  ring: McpRing;
  /** One-line purpose shown to the client on tools/list. */
  summary: string;
}

/** Convert a nourTools camelCase key to the external snake_case MCP name. */
export function toMcpName(name: string): string {
  return name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

/**
 * Tier 1 — read-only spyglass. 12 tools. All battle-safe catalog reads.
 * Business-ring entries return summarized snapshots via the nickstire
 * bridge only — no raw customer PII surface.
 */
export const MCP_TOOL_ALLOWLIST: readonly McpAllowlistEntry[] = [
  // ── personal ring ────────────────────────────────────────────────
  { toolName: "getTasks",              mcpName: "get_tasks",               ring: "personal", summary: "Active tasks (INBOX/READY/DOING) with mission context, priority-ordered." },
  { toolName: "getMissions",           mcpName: "get_missions",            ring: "personal", summary: "Current missions/projects and their state." },
  { toolName: "getCommitments",        mcpName: "get_commitments",         ring: "personal", summary: "Open commitments (promises to people) with deadlines." },
  { toolName: "getTodaySchedule",      mcpName: "get_today_schedule",      ring: "personal", summary: "Today's calendar schedule." },
  { toolName: "getDriftAlerts",        mcpName: "get_drift_alerts",        ring: "personal", summary: "Active drift alerts — where behavior is sliding off system." },
  { toolName: "getDecisionReplays",    mcpName: "get_decision_replays",    ring: "personal", summary: "Journaled decisions due for outcome replay." },
  { toolName: "getFinancialSnapshot",  mcpName: "get_financial_snapshot",  ring: "personal", summary: "Personal financial snapshot." },
  { toolName: "getBrainHealth",        mcpName: "get_brain_health",        ring: "personal", summary: "BrainMemory system health metrics." },
  { toolName: "searchDocuments",       mcpName: "search_documents",        ring: "personal", summary: "Semantic search over ingested documents." },
  { toolName: "searchMemories",        mcpName: "search_memories",         ring: "personal", summary: "Semantic recall over BrainMemory." },
  // ── business ring (summarized bridge reads only) ─────────────────
  { toolName: "getShopSnapshot",       mcpName: "get_shop_snapshot",       ring: "business", summary: "Live Nick's Tire shop snapshot (summarized, via bridge)." },
  { toolName: "getMarketingAttribution", mcpName: "get_marketing_attribution", ring: "business", summary: "Marketing attribution per source: leads, conversions, revenue." },
] as const;

/**
 * Tier 4 — forbidden until manual review (docs/MCP-PLAN.md §2).
 * The allowlist test asserts none of these ever appear in
 * MCP_TOOL_ALLOWLIST, so an accidental "just add it" edit fails CI.
 */
export const MCP_FORBIDDEN_TOOLS: readonly string[] = [
  "runDeviceCommand",
  "createQuickQuote",
  "sendTelegram",
  "stageCustomerAlert",
  "generateImage",
  "triggerInstagramAutopost",
  "setInstagramAutopostConfig",
  "syncDriveMemory",
  "syncKnowledge",
  "githubCreateIssue",
  "githubCreatePR",
  "resolveContradiction",
  "moneyprinter",
  "findCustomer", // raw customer lookup stays on the business ring until Tier 3 review
] as const;

/** v1 exposed-tool count — smoke tests pin this so growth is deliberate. */
export const MCP_TOOL_COUNT = MCP_TOOL_ALLOWLIST.length;
