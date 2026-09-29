/**
 * MCP integration canaries for the StateNour agent bridge.
 *
 * The SDK owns JSON-RPC framing and protocol-era negotiation. These tests pin
 * only StateNour's contract at that boundary: one endpoint for legacy + modern,
 * scoped/deterministic tools, truthful annotations, and policy-safe calls.
 */
import { describe, expect, it } from "vitest";
import {
  MCP_SERVER_INFO,
  handleAuthenticatedMcpRequest,
} from "@/lib/agent-bridge/mcp-server";
import { getBridgeSafeTools } from "@/lib/agent-bridge/tool-adapter";

const MODERN = "2026-07-28";
const PROTOCOL_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";
const TASKS = { clientId: "test-tasks", scope: "tasks" as const };
const READ = { clientId: "test-read", scope: "read" as const };

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
function modernBody(
  id: number,
  method: string,
  params: Record<string, unknown> = {},
) {
  const priorMeta =
    params._meta && typeof params._meta === "object"
      ? (params._meta as Record<string, unknown>)
      : {};
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        ...priorMeta,
        [PROTOCOL_KEY]: MODERN,
        [CAPABILITIES_KEY]: {},
      },
    },
  };
}

function modernHeaders(method: string, name?: string) {
  return {
    "MCP-Protocol-Version": MODERN,
    "Mcp-Method": method,
    ...(name ? { "Mcp-Name": name } : {}),
  };
}
async function decodeMcpResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    return data.length ? JSON.parse(data[data.length - 1]!) : null;
  }
  return JSON.parse(text);
}

async function invoke(
  body: unknown,
  identity = TASKS,
  headers: Record<string, string> = {},
) {
  const response = await handleAuthenticatedMcpRequest(post(body, headers), identity);
  return { response, body: await decodeMcpResponse(response) };
}

describe("agent-bridge MCP · official v2 handler integration", () => {
  it("serves legacy initialize on the same POST endpoint", async () => {
    const { response, body } = await invoke({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });
    expect(response.status).toBe(200);
    expect(body.result?.protocolVersion).toBe("2025-06-18");
    expect(body.result?.serverInfo?.name).toBe(MCP_SERVER_INFO.name);
    expect(body.result?.capabilities?.tools).toBeDefined();
  });
  it("serves 2026-07-28 server/discover with SDK metadata + cache hints", async () => {
    const { response, body } = await invoke(
      modernBody(2, "server/discover"),
      TASKS,
      modernHeaders("server/discover"),
    );
    expect(response.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.result?.supportedVersions).toContain(MODERN);
    expect(body.result?.capabilities?.tools).toBeDefined();
    expect(body.result?.ttlMs).toBe(60_000);
    expect(body.result?.cacheScope).toBe("private");
    expect(body.result?._meta?.[SERVER_INFO_KEY]?.name).toBe(MCP_SERVER_INFO.name);
  });

  it("uses the SDK standard -32020 for modern header/body mismatch", async () => {
    const { response, body } = await invoke(
      modernBody(3, "tools/list"),
      TASKS,
      modernHeaders("tools/call"),
    );
    expect(response.status).toBe(400);
    expect(body.error?.code).toBe(-32020);
  });

  it("uses the SDK standard -32022 for an unsupported modern revision", async () => {
    const body = modernBody(4, "server/discover");
    body.params._meta[PROTOCOL_KEY] = "2099-01-01";
    const { body: result } = await invoke(body, TASKS, {
      "MCP-Protocol-Version": "2099-01-01",
      "Mcp-Method": "server/discover",
    });
    expect(result.error?.code).toBe(-32022);
  });
  it("returns a deterministic tasks-scoped tools list with truthful annotations", async () => {
    const { body } = await invoke(
      modernBody(5, "tools/list"),
      TASKS,
      modernHeaders("tools/list"),
    );
    const tools = body.result?.tools as Array<{
      name: string;
      inputSchema: { type?: string };
      annotations: { readOnlyHint?: boolean; destructiveHint?: boolean };
    }>;
    expect(tools.length).toBe(getBridgeSafeTools("mcp", "tasks").length);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.map((tool) => tool.name)).toEqual(
      [...tools.map((tool) => tool.name)].sort((a, b) => a.localeCompare(b)),
    );
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
      expect(tool.annotations.destructiveHint).toBe(!tool.annotations.readOnlyHint);
    }
  });

  it("narrows the advertised surface for a read-scoped identity", async () => {
    const { body } = await invoke(
      modernBody(6, "tools/list"),
      READ,
      modernHeaders("tools/list"),
    );
    const names = (body.result?.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(names).toEqual(getBridgeSafeTools("mcp", "read").map((tool) => tool.name).sort());
    expect(names).not.toContain("create_task");
  });
  it("keeps unknown tools as protocol InvalidParams", async () => {
    const name = "definitely_not_a_tool";
    const { response, body } = await invoke(
      modernBody(7, "tools/call", { name, arguments: {} }),
      TASKS,
      modernHeaders("tools/call", name),
    );
    expect(response.status).toBe(200);
    expect(body.error?.code).toBe(-32602);
  });

  it("returns tool execution failures as tool results, not protocol failures", async () => {
    const readTool = getBridgeSafeTools("mcp", "read")[0];
    expect(readTool).toBeDefined();
    const { body } = await invoke(
      modernBody(8, "tools/call", { name: readTool.name, arguments: {} }),
      READ,
      modernHeaders("tools/call", readTool.name),
    );
    expect(body.error).toBeUndefined();
    expect(body.result?.content?.[0]?.type).toBe("text");
    expect(typeof body.result?.content?.[0]?.text).toBe("string");
  });
});
