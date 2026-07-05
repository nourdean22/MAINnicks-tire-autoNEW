import { TOOL_CATALOG, ToolMeta } from "@/lib/ai/tools/catalog";

// MCP (the /api/mcp bridge) has NO per-schema operation cap — expose the
// full catalog for maximum operational capability.
export const MCP_V1_TOOLS = TOOL_CATALOG.map((t) => t.name);

// ── ChatGPT Custom GPT Actions: hard 30-operation cap ────────────────
// ChatGPT rejects any action whose OpenAPI schema declares more than 30
// operations ("OpenAPI spec can have a maximum of 30 operations"). The
// full catalog is ~150 tools, so the Actions surface exposes a CURATED,
// priority-ordered subset (<=30) of the highest-leverage tools for the
// "Nour Command" operator GPT. This one list is the single source of
// truth for BOTH the /api/actions/openapi schema and the
// /api/actions/[tool] executor, so the advertised and executable
// surfaces never drift. Actions is a strict subset of MCP_V1_TOOLS.
// INVARIANT (enforced by tests/agent-bridge/dual-protocol.test.ts):
//   - length <= 30
//   - every name is present in the catalog (and therefore in MCP_V1_TOOLS)
// To add/remove: edit this list; keep it at or under 30 entries.
export const CHATGPT_ACTIONS_V1_TOOLS: string[] = [
  // business & revenue
  "getDashboardSummary",
  "getRevenueStats",
  "getReviewStats",
  "getTopServices",
  "getEstimateLeaks",
  "compareCompetitors",
  "pricingAdvisorySummary",
  // live shop (nickstire cross-ring bridge)
  "getShopSnapshot",
  "getMarketingAttribution",
  "getAttentionAlerts",
  "getGscSummary",
  // personal execution
  "getTasks",
  "createTask",
  "completeTask",
  "getMissions",
  "getFinancialSnapshot",
  "getTodaySchedule",
  "getWeeklyTargets",
  "rankNextActions",
  "suggestMIT",
  "dailyPulse",
  // brain & strategy
  "searchMemories",
  "searchReflections",
  "getBlindSpots",
  "getPendingRevenueMoves",
  "decisionPreFlight",
  "analyzePowerDynamics",
  "getPowerBalanceSummary",
  // research & comms
  "searchWebVerified",
  "sendTelegram",
];

export function getBridgeToolPolicy(toolName: string): ToolMeta | undefined {
  return TOOL_CATALOG.find((t) => t.name === toolName);
}

export function assertBridgeToolAllowed(toolName: string, protocol: "mcp" | "actions"): void {
  const allowlist = protocol === "mcp" ? MCP_V1_TOOLS : CHATGPT_ACTIONS_V1_TOOLS;
  
  if (!allowlist.includes(toolName)) {
    throw new Error(`Tool ${toolName} is not in the allowlist for ${protocol}.`);
  }

  const policy = getBridgeToolPolicy(toolName);
  if (!policy) {
    throw new Error(`Tool ${toolName} missing catalog metadata. Failing closed.`);
  }

  // Full Operational Mode Activated: All write, side-effecting, and high-risk tools are now permitted.
  // The operator assumes full responsibility for the commands executed through the bridge.
}
