/**
 * MCP protocol contract for the shared agent-bridge (POST /api/mcp).
 *
 * Salvaged from the superseded standalone bridge (PR #487) and adapted
 * to the shipped agent-bridge (#493): exercises handleMcpMessage()
 * directly (the route is a thin auth + JSON shell) so it runs without
 * Next.js request plumbing. Assertions are about ENVELOPE shape +
 * protocol correctness, not live data.
 *
 * NOTE: the bridge is "full operational mode" (writes permitted), so the
 * read-only *safety* invariant is reframed: we don't assert every tool is
 * read-only (it isn't), we assert no write tool is ever MISLABELED
 * read-only to clients.
 */
import { describe, it, expect } from "vitest";
import {
  handleMcpMessage,
  MCP_SERVER_INFO,
  MCP_PROTOCOL_VERSIONS,
  RPC_ERROR,
} from "@/lib/agent-bridge/mcp-server";
import { getBridgeSafeTools } from "@/lib/agent-bridge/tool-adapter";

describe("agent-bridge mcp · protocol", () => {
  it("initialize echoes a supported protocol version", async () => {
    const res = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    expect(res?.error).toBeUndefined();
    const r = res?.result as {
      protocolVersion: string;
      serverInfo: typeof MCP_SERVER_INFO;
      capabilities: { tools: unknown };
    };
    expect(r.protocolVersion).toBe("2025-06-18");
    expect(r.serverInfo.name).toBe("statenour-command");
    expect(r.capabilities.tools).toBeDefined();
  });

  it("initialize falls back to the newest version for an unknown request", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect((res?.result as { protocolVersion: string }).protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0]);
  });

  it("notifications (and id-less requests) produce no response — the 202 path", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "ping" })).toBeNull();
  });

  it("ping returns an empty result", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "ping" });
    expect(res?.result).toEqual({});
  });

  it("rejects JSON-RPC batches", async () => {
    const res = await handleMcpMessage([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
    expect(res?.error?.code).toBe(RPC_ERROR.INVALID_REQUEST);
  });

  it("rejects a non-object message", async () => {
    const res = await handleMcpMessage("not-an-object");
    expect(res?.error?.code).toBe(RPC_ERROR.INVALID_REQUEST);
  });

  it("returns METHOD_NOT_FOUND for unknown methods", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 4, method: "does/not/exist" });
    expect(res?.error?.code).toBe(RPC_ERROR.METHOD_NOT_FOUND);
  });

  it("tools/list exposes object schemas + consistent per-tool annotations", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 5, method: "tools/list" });
    const tools = (res?.result as {
      tools: Array<{ name: string; inputSchema: { type?: string }; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }>;
    }).tools;
    expect(tools.length).toBe(getBridgeSafeTools("mcp").length);
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(typeof t.annotations.readOnlyHint).toBe("boolean");
      // a tool is either read-only or destructive, never labeled both
      expect(t.annotations.destructiveHint).toBe(!t.annotations.readOnlyHint);
    }
  });

  it("NEVER labels a side-effecting tool as read-only (full-operational safety)", async () => {
    const safe = getBridgeSafeTools("mcp");
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 6, method: "tools/list" });
    const readOnlyByName = new Map(
      (res?.result as { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> }).tools.map(
        (t) => [t.name, t.annotations.readOnlyHint] as const,
      ),
    );
    const leaked = safe.filter((t: any) => t.meta?.sideEffecting === true && readOnlyByName.get(t.name) === true);
    expect(leaked.map((t: any) => t.name)).toEqual([]);
  });

  it("tools/call on a read-only tool returns a JSON text envelope", async () => {
    const readTool = getBridgeSafeTools("mcp").find((t: any) => t.meta?.sideEffecting !== true);
    if (!readTool) return; // nothing read-only exposed in this env → skip
    const res = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: readTool.name, arguments: {} },
    });
    expect(res?.error).toBeUndefined(); // tool failures are results, not protocol errors
    const r = res?.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(r.content[0]?.type).toBe("text");
    expect(typeof r.content[0]?.text).toBe("string");
  });

  it("tools/call on an unknown tool is INVALID_PARAMS", async () => {
    const res = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "definitely_not_a_tool", arguments: {} },
    });
    expect(res?.error?.code).toBe(RPC_ERROR.INVALID_PARAMS);
  });
});
