/**
 * MCP smoke test — protocol round-trips over the dispatch core plus
 * auth fail-closed behavior (docs/MCP-PLAN.md §4, §6).
 *
 * Uses handleMcpMessage directly (the route is a thin auth+JSON shell
 * around it) so the test runs without Next.js request plumbing. Tool
 * handlers that hit Prisma degrade gracefully in the vitest env (their
 * own .catch fallbacks) — the smoke assertions are about ENVELOPE
 * shape, not live data.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleMcpMessage, MCP_SERVER_INFO, RPC_ERROR } from "@/lib/mcp/server";
import { getMcpTools } from "@/lib/mcp/tool-adapter";
import { requireMcpAuth, McpAuthError } from "@/lib/mcp/auth";
import { MCP_TOOL_COUNT } from "@/lib/mcp/tool-allowlist";

describe("mcp · protocol smoke", () => {
  it("initialize negotiates a supported protocol version", async () => {
    const res = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    expect(res?.error).toBeUndefined();
    const result = res?.result as { protocolVersion: string; serverInfo: typeof MCP_SERVER_INFO; capabilities: { tools: unknown } };
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.serverInfo.name).toBe("statenour-command");
    expect(result.capabilities.tools).toBeDefined();
  });

  it("initialize falls back to the latest version for unknown requests", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect((res?.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
  });

  it("notifications/initialized produces no response (202 path)", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res).toBeNull();
  });

  it("ping returns an empty result", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "ping" });
    expect(res?.result).toEqual({});
  });

  it("tools/list exposes exactly the allowlisted tools with object schemas + read-only annotations", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 4, method: "tools/list" });
    const tools = (res?.result as { tools: Array<{ name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }> }).tools;
    expect(tools.length).toBe(MCP_TOOL_COUNT);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.annotations.readOnlyHint).toBe(true);
    }
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_tasks");
    expect(names).toContain("get_shop_snapshot");
    expect(names).toContain("get_marketing_attribution");
  });

  it("tools/call get_tasks returns a structured JSON text envelope", async () => {
    const res = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "get_tasks", arguments: {} },
    });
    expect(res?.error).toBeUndefined();
    const result = res?.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(result.content[0]?.type).toBe("text");
    // Whatever the DB state (vitest env → handler's own [] fallback),
    // the payload must be parseable JSON.
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });

  it("tools/call with an unknown tool is INVALID_PARAMS", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "run_device_command", arguments: {} } });
    expect(res?.error?.code).toBe(RPC_ERROR.INVALID_PARAMS);
  });

  it("unknown methods are METHOD_NOT_FOUND", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 7, method: "resources/list" });
    expect(res?.error?.code).toBe(RPC_ERROR.METHOD_NOT_FOUND);
  });

  it("JSON-RPC batches are rejected", async () => {
    const res = await handleMcpMessage([{ jsonrpc: "2.0", id: 8, method: "ping" }]);
    expect(res?.error?.code).toBe(RPC_ERROR.INVALID_REQUEST);
  });

  it("adapter exposes every tool with an invokable handler", () => {
    const tools = getMcpTools();
    expect(tools.length).toBe(MCP_TOOL_COUNT);
    for (const t of tools) {
      expect(typeof t.invoke).toBe("function");
      expect(t.description).toContain("read-only");
    }
  });
});

describe("mcp · auth fail-closed", () => {
  const ORIGINAL = process.env.MCP_ACCESS_TOKEN;
  beforeEach(() => {
    delete process.env.MCP_ACCESS_TOKEN;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.MCP_ACCESS_TOKEN;
    else process.env.MCP_ACCESS_TOKEN = ORIGINAL;
  });

  function reqWith(headers: Record<string, string>): Request {
    return new Request("http://localhost/api/mcp", { method: "POST", headers });
  }

  it("503 when MCP_ACCESS_TOKEN is unset (Tier 0 default posture)", () => {
    try {
      requireMcpAuth(reqWith({ authorization: "Bearer anything" }));
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(McpAuthError);
      expect((err as McpAuthError).status).toBe(503);
    }
  });

  it("401 on wrong or missing token", () => {
    process.env.MCP_ACCESS_TOKEN = "correct-token-value";
    for (const headers of [{ authorization: "Bearer wrong" }, {}]) {
      try {
        requireMcpAuth(reqWith(headers));
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as McpAuthError).status).toBe(401);
      }
    }
  });

  it("accepts the correct token via Authorization or x-mcp-token", () => {
    process.env.MCP_ACCESS_TOKEN = "correct-token-value";
    expect(requireMcpAuth(reqWith({ authorization: "Bearer correct-token-value" })).actor).toBe("mcp:external");
    expect(requireMcpAuth(reqWith({ "x-mcp-token": "correct-token-value" })).actor).toBe("mcp:external");
  });
});
