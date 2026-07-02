import { TOOL_CATALOG, ToolMeta } from "@/lib/ai/tools/catalog";

export const CHATGPT_ACTIONS_V1_TOOLS = [
  "getBrainHealth",
  "toolHealth",
  "getTasks",
  "getMissions",
  "getCommitments",
  "getTodaySchedule",
  "getFinancialSnapshot",
  "getDriftAlerts",
  "getDecisionsDueForReplay",
  "searchDocuments",
  "searchMemories",
  "findRelatedConversations",
  "getShopSnapshot",
  "getMarketingAttribution",
  "getEstimateLeaks",
  "getAttentionAlerts",
  "getPendingRevenueMoves"
];

// MCP uses the exact same base list for now.
export const MCP_V1_TOOLS = [...CHATGPT_ACTIONS_V1_TOOLS];

export function getBridgeToolPolicy(toolName: string): ToolMeta | undefined {
  return TOOL_CATALOG.find((t) => t.name === toolName);
}

export function assertBridgeToolAllowed(toolName: string, protocol: "mcp" | "actions"): void {
  const allowlist = protocol === "mcp" ? MCP_V1_TOOLS : CHATGPT_ACTIONS_V1_TOOLS;
  
  if (!allowlist.includes(toolName)) {
    throw new Error(`Tool ${toolName} is not in the V1 read-only allowlist for ${protocol}.`);
  }

  const policy = getBridgeToolPolicy(toolName);
  if (!policy) {
    throw new Error(`Tool ${toolName} missing catalog metadata. Failing closed.`);
  }

  if (policy.sideEffecting || policy.riskClass === "high" || policy.riskClass === "critical") {
    throw new Error(`Tool ${toolName} has side-effects or high risk. Write tools are blocked in v1.`);
  }

  // Explicitly block categories mentioned by user just to be safe
  if (
    policy.name.toLowerCase().includes("run") ||
    policy.name.toLowerCase().includes("device") ||
    policy.name.toLowerCase().includes("browser") ||
    policy.name.toLowerCase().includes("github") ||
    policy.name.toLowerCase().includes("telegram") ||
    policy.name.toLowerCase().includes("quote") ||
    policy.name.toLowerCase().includes("image")
  ) {
    throw new Error(`Tool ${toolName} falls into a blocked heuristic category.`);
  }
}
