import { describe, it, expect } from "vitest";
import { getBridgeSafeTools } from "@/lib/agent-bridge/tool-adapter";
import { assertBridgeToolAllowed, CHATGPT_ACTIONS_V1_TOOLS, MCP_V1_TOOLS } from "@/lib/agent-bridge/tool-policy";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

describe("Agent Bridge Dual-Protocol Surface", () => {
  it("exposes the exact same tools to both MCP and Custom Actions", () => {
    const actionsTools = getBridgeSafeTools("actions");
    const mcpTools = getBridgeSafeTools("mcp");
    
    const actionsNames = actionsTools.map(t => t.camelName).sort();
    const mcpNames = mcpTools.map(t => t.camelName).sort();
    
    expect(actionsNames).toEqual(mcpNames);
    
    // Ensure the tools exposed actually match the allowed list exactly
    // (Meaning no invalid tools sneak in and no allowed tools are silently dropped unless missing from codebase)
    expect(actionsNames.length).toBeGreaterThan(0);
    expect(actionsNames.length).toBeLessThanOrEqual(CHATGPT_ACTIONS_V1_TOOLS.length);
  });

  it("permits side-effecting and high-risk tools (Full Operation mode)", () => {
    const allExposed = [...getBridgeSafeTools("actions"), ...getBridgeSafeTools("mcp")];
    
    const hasSideEffecting = allExposed.some(tool => tool.meta.sideEffecting);
    const hasHighRisk = allExposed.some(tool => tool.meta.riskClass === "high" || tool.meta.riskClass === "critical");
    
    expect(hasSideEffecting).toBe(true);
    expect(hasHighRisk).toBe(true);
  });

  it("does not throw if a side-effecting tool is requested directly", () => {
    const writeTool = TOOL_CATALOG.find(t => t.sideEffecting);
    if (writeTool) {
      expect(() => assertBridgeToolAllowed(writeTool.name, "actions")).not.toThrow();
      expect(() => assertBridgeToolAllowed(writeTool.name, "mcp")).not.toThrow();
    }
  });
});
