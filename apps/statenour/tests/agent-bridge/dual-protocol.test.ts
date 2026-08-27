import { describe, it, expect } from "vitest";
import { getBridgeSafeTools } from "@/lib/agent-bridge/tool-adapter";
import { assertBridgeToolAllowed, CHATGPT_ACTIONS_V1_TOOLS, MCP_V1_TOOLS } from "@/lib/agent-bridge/tool-policy";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import { BRIDGE_HARD_DENY } from "@/lib/agent-bridge/scopes";

/**
 * UPDATED 2026-08-27 for the bridge hardening. The three assertions this file
 * used to make — "MCP retains full-operational capability (side-effecting +
 * high-risk tools)", "MCP permits any catalog tool", and MCP_V1_TOOLS ===
 * whole catalog — encoded the DEFECT: the full 181-tool surface, including
 * runPython, behind one flat token, guarded only by a comment. Those are now
 * inverted: the hardened contract is that MCP is a SCOPED subset that excludes
 * every protected operation. Kept: Actions is a curated <=30 subset of the
 * maximal MCP surface, and every curated name resolves to a real tool.
 */
describe("Agent Bridge Dual-Protocol Surface", () => {
  it("Actions is a curated <=30 subset of the maximal MCP surface", () => {
    const actionsTools = getBridgeSafeTools("actions");
    const mcpMax = getBridgeSafeTools("mcp"); // no scope = maximal reachable union

    const actionsNames = actionsTools.map((t) => t.camelName);
    const mcpNames = new Set(mcpMax.map((t) => t.camelName));

    for (const name of actionsNames) {
      expect(mcpNames.has(name), `Actions tool ${name} missing from the MCP surface`).toBe(true);
    }

    expect(CHATGPT_ACTIONS_V1_TOOLS.length).toBeLessThanOrEqual(30);
    expect(actionsNames.length).toBeGreaterThan(0);
    expect(actionsNames.length).toBeLessThanOrEqual(30);
    // Every curated name resolves to a real, exposed tool (typo / unregistered guard).
    expect(actionsNames.length).toBe(CHATGPT_ACTIONS_V1_TOOLS.length);
    // The maximal MCP surface is larger than Actions but is NO LONGER the whole
    // catalog — it is the scoped union with protected ops removed.
    expect(mcpMax.length).toBeGreaterThan(actionsNames.length);
    expect(MCP_V1_TOOLS.length).toBeLessThan(TOOL_CATALOG.length);
  });

  it("HARDENED: the MCP surface exposes NO protected operation, on any path", () => {
    // The inversion of the old "retains full-operational capability" test.
    const mcpMax = getBridgeSafeTools("mcp").map((t) => t.camelName);
    const leaked = mcpMax.filter((n) => BRIDGE_HARD_DENY.has(n));
    expect(leaked, "protected ops must never appear on the MCP surface").toEqual([]);
    // Specifically: no code execution, no customer SMS.
    for (const forbidden of ["runPython", "runDeviceCommand", "sendOpportunitySms"]) {
      expect(mcpMax).not.toContain(forbidden);
    }
    // POSITIVE CONTROL: the surface is real and useful, not empty.
    expect(mcpMax).toContain("getShopSnapshot");
    expect(mcpMax).toContain("searchMemories");
  });

  it("scope gates execution: a protected op is refused on MCP; Actions permits only its curated list", () => {
    // MCP: a protected op throws on every scope (was: not.toThrow on full surface).
    const protectedTool = TOOL_CATALOG.find((t) => BRIDGE_HARD_DENY.has(t.name));
    expect(protectedTool, "the catalog should contain at least one protected op").toBeTruthy();
    if (protectedTool) {
      expect(() => assertBridgeToolAllowed(protectedTool.name, "mcp", "read")).toThrow(/protected operation/);
      expect(() => assertBridgeToolAllowed(protectedTool.name, "mcp", "tasks")).toThrow(/protected operation/);
    }

    // Actions rejects any tool outside its curated list...
    const nonCurated = TOOL_CATALOG.find(
      (t) => !CHATGPT_ACTIONS_V1_TOOLS.includes(t.name) && !BRIDGE_HARD_DENY.has(t.name),
    );
    if (nonCurated) {
      expect(() => assertBridgeToolAllowed(nonCurated.name, "actions")).toThrow(/not in the allowlist/);
    }
    // ...and permits every curated tool.
    for (const name of CHATGPT_ACTIONS_V1_TOOLS) {
      expect(() => assertBridgeToolAllowed(name, "actions")).not.toThrow();
    }
  });
});
