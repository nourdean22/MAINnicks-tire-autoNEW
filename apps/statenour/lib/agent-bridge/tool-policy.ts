import { TOOL_CATALOG, ToolMeta } from "@/lib/ai/tools/catalog";

// We now expose all tools from the catalog for full operational capability.
export const CHATGPT_ACTIONS_V1_TOOLS = TOOL_CATALOG.map(t => t.name);

// MCP uses the exact same base list.
export const MCP_V1_TOOLS = [...CHATGPT_ACTIONS_V1_TOOLS];

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
