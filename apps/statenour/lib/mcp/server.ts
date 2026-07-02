/**
 * lib/mcp/server.ts
 *
 * Stateless MCP server core — JSON-RPC 2.0 dispatch for the
 * Streamable HTTP transport (docs/MCP-PLAN.md §6).
 *
 * Hand-rolled instead of @modelcontextprotocol/sdk's server transport
 * on purpose: the SDK's StreamableHTTPServerTransport wants Node
 * http req/res objects (not Next.js App Router Request/Response), and
 * the surface we need is four methods. Keeping the dispatch in ~150
 * auditable lines beats bridging transports for a private operator
 * port. The SDK stays in the tree for the CLIENT side
 * (lib/intelligence/search/*-mcp.ts) — unchanged.
 *
 * Supported methods:
 *   initialize · ping · tools/list · tools/call
 *   notifications/* are acknowledged with no response (per spec).
 * Batches are rejected — JSON-RPC batching was removed in the
 * 2025-06-18 MCP revision, and we only advertise versions ≥ that
 * behavior for POST-only clients.
 */
import { getMcpTools, findMcpTool, McpInvalidParamsError } from "@/lib/mcp/tool-adapter";
import { auditMcp } from "@/lib/mcp/audit";

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MCP_SERVER_INFO = {
  name: "statenour-command",
  title: "StateNour Command (read-only bridge)",
  version: "1.0.0",
} as const;

const SERVER_INSTRUCTIONS =
  "Read-only spyglass over StateNour (Nour's personal OS) plus summarized " +
  "Nick's Tire business snapshots. Every tool is a live-state read — nothing " +
  "here mutates anything. Ground answers in these reads instead of guessing; " +
  "for 'what should I do next', combine get_tasks, get_commitments, " +
  "get_today_schedule, get_drift_alerts, and get_shop_snapshot.";

type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// JSON-RPC 2.0 reserved error codes.
export const RPC_ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const;

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function handleInitialize(id: JsonRpcId, params: Record<string, unknown> | undefined): JsonRpcResponse {
  const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
  const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : MCP_PROTOCOL_VERSIONS[0];
  return ok(id, {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: MCP_SERVER_INFO,
    instructions: SERVER_INSTRUCTIONS,
  });
}

function handleToolsList(id: JsonRpcId): JsonRpcResponse {
  const tools = getMcpTools().map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: t.ring === "business", // bridge reads leave the local DB
    },
  }));
  return ok(id, { tools });
}

async function handleToolsCall(
  id: JsonRpcId,
  params: Record<string, unknown> | undefined,
): Promise<JsonRpcResponse> {
  const name = typeof params?.name === "string" ? params.name : "";
  const args = (params?.arguments ?? {}) as unknown;
  const tool = findMcpTool(name);
  if (!tool) {
    auditMcp({ event: "tools/call", tool: name || "(missing)", ok: false, error: "unknown tool" });
    return fail(id, RPC_ERROR.INVALID_PARAMS, `Unknown tool: ${name || "(missing name)"}`);
  }
  const started = Date.now();
  try {
    const result = await tool.invoke(args);
    auditMcp({ event: "tools/call", tool: name, ok: true, ms: Date.now() - started });
    return ok(id, {
      content: [{ type: "text", text: JSON.stringify(result ?? null) }],
      structuredContent: wrapStructured(result),
      isError: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    auditMcp({ event: "tools/call", tool: name, ok: false, ms: Date.now() - started, error: message });
    if (err instanceof McpInvalidParamsError) {
      return fail(id, RPC_ERROR.INVALID_PARAMS, message);
    }
    // Tool execution failures are tool RESULTS per MCP spec (the model
    // should see them), not protocol errors — and we never leak stacks.
    return ok(id, {
      content: [{ type: "text", text: `Tool ${name} failed: ${message}` }],
      isError: true,
    });
  }
}

/**
 * structuredContent must be an object — wrap arrays/scalars so every
 * tool result round-trips losslessly.
 */
function wrapStructured(result: unknown): Record<string, unknown> {
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result: result ?? null };
}

/**
 * Handle one decoded JSON-RPC message. Returns null for notifications
 * (no response body — the route answers 202).
 */
export async function handleMcpMessage(message: unknown): Promise<JsonRpcResponse | null> {
  if (Array.isArray(message)) {
    return fail(null, RPC_ERROR.INVALID_REQUEST, "JSON-RPC batching is not supported");
  }
  if (!message || typeof message !== "object") {
    return fail(null, RPC_ERROR.INVALID_REQUEST, "Expected a JSON-RPC request object");
  }
  const req = message as JsonRpcRequest;
  const method = req.method;
  const id = req.id ?? null;

  if (typeof method !== "string") {
    return fail(id, RPC_ERROR.INVALID_REQUEST, "Missing method");
  }

  // Notifications (no id) get no response.
  if (req.id === undefined || method.startsWith("notifications/")) {
    return null;
  }

  switch (method) {
    case "initialize":
      return handleInitialize(id, req.params);
    case "ping":
      return ok(id, {});
    case "tools/list":
      return handleToolsList(id);
    case "tools/call":
      return handleToolsCall(id, req.params);
    default:
      return fail(id, RPC_ERROR.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}
