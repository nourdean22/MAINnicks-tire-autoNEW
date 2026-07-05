import { describe, it, expect } from "vitest";
import { getBridgeSafeTools } from "@/lib/agent-bridge/tool-adapter";
import { assertBridgeToolAllowed, CHATGPT_ACTIONS_V1_TOOLS, MCP_V1_TOOLS } from "@/lib/agent-bridge/tool-policy";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

describe("Agent Bridge Dual-Protocol Surface", () => {
  it("exposes a curated ChatGPT Actions subset (<=30 ops) of the full MCP surface", () => {
    const actionsTools = getBridgeSafeTools("actions");
    const mcpTools = getBridgeSafeTools("mcp");

    const actionsNames = actionsTools.map((t) => t.camelName);
    const mcpNames = new Set(mcpTools.map((t) => t.camelName));

    // No Actions-only tools: the Actions surface is a strict subset of MCP.
    for (const name of actionsNames) {
      expect(mcpNames.has(name), `Actions tool ${name} is missing from the MCP surface`).toBe(true);
    }

    // ChatGPT Custom GPT Actions hard-cap: a schema may declare at most 30 operations.
    // (This is the invariant whose violation broke the bdnick.info action — 150 ops > 30.)
    expect(CHATGPT_ACTIONS_V1_TOOLS.length).toBeLessThanOrEqual(30);
    expect(actionsNames.length).toBeGreaterThan(0);
    expect(actionsNames.length).toBeLessThanOrEqual(30);

    // Every curated name must resolve to a real, exposed tool — catches typos or
    // tools that were curated but never registered in nourTools.
    expect(actionsNames.length).toBe(CHATGPT_ACTIONS_V1_TOOLS.length);

    // MCP keeps the full catalog — materially larger than the curated Actions set.
    expect(mcpTools.length).toBeGreaterThan(actionsNames.length);
    expect(MCP_V1_TOOLS.length).toBe(TOOL_CATALOG.length);
  });

  it("MCP retains full-operational capability (side-effecting + high-risk tools)", () => {
    const mcpTools = getBridgeSafeTools("mcp");

    const hasSideEffecting = mcpTools.some((t) => t.meta.sideEffecting);
    const hasHighRisk = mcpTools.some((t) => t.meta.riskClass === "high" || t.meta.riskClass === "critical");

    expect(hasSideEffecting).toBe(true);
    expect(hasHighRisk).toBe(true);
  });

  it("MCP permits any catalog tool; Actions is limited to the curated allowlist", () => {
    // MCP exposes the full surface — side-effecting tools included.
    const writeTool = TOOL_CATALOG.find((t) => t.sideEffecting);
    if (writeTool) {
      expect(() => assertBridgeToolAllowed(writeTool.name, "mcp")).not.toThrow();
    }

    // Actions rejects any tool outside the curated <=30 list...
    const nonCurated = TOOL_CATALOG.find((t) => !CHATGPT_ACTIONS_V1_TOOLS.includes(t.name));
    if (nonCurated) {
      expect(() => assertBridgeToolAllowed(nonCurated.name, "actions")).toThrow();
    }

    // ...but permits every curated tool (including curated side-effecting ones like sendTelegram).
    for (const name of CHATGPT_ACTIONS_V1_TOOLS) {
      expect(() => assertBridgeToolAllowed(name, "actions")).not.toThrow();
    }
  });
});
