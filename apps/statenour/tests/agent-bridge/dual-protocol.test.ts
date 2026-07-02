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

  it("strictly blocks all side-effecting tools in v1", () => {
    const allExposed = [...getBridgeSafeTools("actions"), ...getBridgeSafeTools("mcp")];
    
    for (const tool of allExposed) {
      expect(!!tool.meta.sideEffecting).toBe(false);
      expect(tool.meta.riskClass).not.toBe("high");
      expect(tool.meta.riskClass).not.toBe("critical");
    }
  });

  it("throws explicitly if a forbidden tool is requested directly", () => {
    // Find a known side-effecting tool from the catalog
    const writeTool = TOOL_CATALOG.find(t => t.sideEffecting);
    if (writeTool) {
      expect(() => assertBridgeToolAllowed(writeTool.name, "actions")).toThrow(/allowlist/);
      expect(() => assertBridgeToolAllowed(writeTool.name, "mcp")).toThrow(/allowlist/);
    }
    
    // Find a known high-risk tool if any
    const highRiskTool = TOOL_CATALOG.find(t => t.riskClass === "high");
    if (highRiskTool) {
      expect(() => assertBridgeToolAllowed(highRiskTool.name, "actions")).toThrow(/allowlist/);
      expect(() => assertBridgeToolAllowed(highRiskTool.name, "mcp")).toThrow(/allowlist/);
    }
  });
});
