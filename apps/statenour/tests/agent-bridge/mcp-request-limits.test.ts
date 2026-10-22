/**
 * MCP request limits (GHSA-46jr-4wx8-v453, 2026-10-22).
 *
 * One request inside the SDK's default 4 MiB body limit could exhaust memory during argument
 * validation. @modelcontextprotocol/server 2.3.0 ships the fix but leaves it off: the handler
 * needs a smaller maxRequestBodySize, and tool arguments need an element budget. The bridge
 * uses the low-level Server, which has no maxToolInputElements, so the bridge enforces it.
 */
import { describe, expect, it } from "vitest";
import { handleAuthenticatedMcpRequest } from "@/lib/agent-bridge/mcp-server";
import { getBridgeSafeTools } from "@/lib/agent-bridge/tool-adapter";

const MODERN = "2026-07-28";
const READ = { clientId: "test-read", scope: "read" as const };

function callTool(name: string, args: Record<string, unknown>) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name,
      arguments: args,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
  return handleAuthenticatedMcpRequest(
    new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": MODERN,
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
      },
      body: JSON.stringify(body),
    }),
    READ,
  );
}

async function json(response: Response) {
  const text = await response.text();
  const data = text.includes("data:")
    ? text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).pop()
    : text;
  return data ? JSON.parse(data) : null;
}

describe("agent-bridge MCP request limits", () => {
  const tool = getBridgeSafeTools("mcp", "read")[0]!;

  it("answers 413 for a body over 1 MiB, before any parsing", async () => {
    const response = await callTool(tool.name, { pad: "x".repeat(1_100_000) });
    expect(response.status).toBe(413);
  });

  it("positive control: a 500 KB body still reaches the tool", async () => {
    const response = await callTool(tool.name, { pad: "x".repeat(500_000) });
    expect(response.status).toBe(200);
    expect((await json(response))?.error).toBeUndefined();
  });

  it("refuses tool arguments over 10,000 elements as InvalidParams", async () => {
    const body = await json(await callTool(tool.name, { items: new Array(10_001).fill(0) }));
    expect(body?.error?.code).toBe(-32602);
    expect(body?.error?.message).toMatch(/more than the maximum of 10000 elements/);
  });

  it("counts nested object members too, not only top-level arrays", async () => {
    const nested = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, new Array(99).fill(0)]));
    const body = await json(await callTool(tool.name, nested));
    expect(body?.error?.code).toBe(-32602);
  });

  it("positive control: 100 elements pass the budget and reach the tool", async () => {
    const body = await json(await callTool(tool.name, { items: new Array(100).fill(0) }));
    expect(body?.error).toBeUndefined();
    expect(body?.result?.content?.[0]?.type).toBe("text");
  });
});
