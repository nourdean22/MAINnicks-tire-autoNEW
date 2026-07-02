/**
 * MCP allowlist contract test (docs/MCP-PLAN.md §2-3).
 *
 * The invariant this file exists to protect: NO side-effecting or
 * non-battle-safe tool can ever be exposed through the MCP facade in
 * v1. The adapter re-checks at runtime; this test makes the mistake
 * un-mergeable at CI time.
 */
import { describe, it, expect } from "vitest";
import { nourTools } from "@/lib/ai/tools";
import { getToolMeta } from "@/lib/ai/tools/catalog";
import {
  MCP_TOOL_ALLOWLIST,
  MCP_FORBIDDEN_TOOLS,
  MCP_TOOL_COUNT,
  toMcpName,
} from "@/lib/mcp/tool-allowlist";

describe("mcp · tool allowlist contract", () => {
  it("stays a deliberately small set (growth is a reviewed decision)", () => {
    expect(MCP_TOOL_COUNT).toBe(12);
    expect(MCP_TOOL_ALLOWLIST.length).toBeLessThanOrEqual(16);
  });

  it("every entry resolves to a real nourTools handler", () => {
    const missing = MCP_TOOL_ALLOWLIST.filter((e) => !(e.toolName in nourTools));
    expect(missing.map((e) => e.toolName)).toEqual([]);
  });

  it("every entry has a catalog record", () => {
    const missing = MCP_TOOL_ALLOWLIST.filter((e) => getToolMeta(e.toolName) === null);
    expect(missing.map((e) => e.toolName)).toEqual([]);
  });

  it("every entry is battle-safe (catalog battle: true)", () => {
    const notBattle = MCP_TOOL_ALLOWLIST.filter((e) => getToolMeta(e.toolName)?.battle !== true);
    expect(notBattle.map((e) => e.toolName)).toEqual([]);
  });

  it("NO entry is side-effecting", () => {
    const sideEffecting = MCP_TOOL_ALLOWLIST.filter(
      (e) => getToolMeta(e.toolName)?.sideEffecting === true,
    );
    expect(sideEffecting.map((e) => e.toolName)).toEqual([]);
  });

  it("NO forbidden (Tier 4) tool appears in the allowlist", () => {
    const forbidden = new Set(MCP_FORBIDDEN_TOOLS);
    const leaked = MCP_TOOL_ALLOWLIST.filter((e) => forbidden.has(e.toolName));
    expect(leaked.map((e) => e.toolName)).toEqual([]);
  });

  it("forbidden list itself stays sane — every name is a real catalog tool", () => {
    // Guards against typos that would silently un-forbid a tool after
    // a rename (e.g. runDeviceCommand → runDevice).
    const unknown = MCP_FORBIDDEN_TOOLS.filter((name) => getToolMeta(name) === null);
    expect(unknown).toEqual([]);
  });

  it("mcp names are unique snake_case derived from the tool name", () => {
    const names = MCP_TOOL_ALLOWLIST.map((e) => e.mcpName);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of MCP_TOOL_ALLOWLIST) {
      expect(entry.mcpName).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(entry.mcpName).toBe(toMcpName(entry.toolName));
    }
  });

  it("business-ring entries are exactly the bridge snapshot reads", () => {
    const business = MCP_TOOL_ALLOWLIST.filter((e) => e.ring === "business").map((e) => e.toolName).sort();
    expect(business).toEqual(["getMarketingAttribution", "getShopSnapshot"]);
    // and both are needsBridge in the catalog — summarized cross-ring reads
    for (const name of business) {
      expect(getToolMeta(name)?.needsBridge).toBe(true);
    }
  });

  it("write-capable catalog categories never appear in the allowlist", () => {
    const writeCategories = new Set(["personal_write", "business_write", "comms", "content", "browser"]);
    const leaked = MCP_TOOL_ALLOWLIST.filter((e) =>
      writeCategories.has(getToolMeta(e.toolName)?.category ?? ""),
    );
    expect(leaked.map((e) => e.toolName)).toEqual([]);
  });
});
