/**
 * lib/agent-bridge/mcp-server.ts
 *
 * Stateless MCP JSON-RPC 2.0 dispatch for the StateNour Command bridge
 * (POST /api/mcp). The route is a thin auth + JSON shell around
 * handleMcpMessage(), which keeps the dispatch testable without Next.js
 * request plumbing.
 *
 * Provenance: the protocol rigor here was salvaged from the superseded
 * standalone `lib/mcp/` bridge (PR #487) and ported onto the SHIPPED
 * shared agent-bridge (#493) — version negotiation, batch rejection,
 * ping/notifications handling, structuredContent, and per-tool
 * annotations that the earlier inline route lacked.
 *
 * IMPORTANT: the bridge runs in "full operational mode" (writes are
 * permitted per lib/agent-bridge/tool-policy.ts). Tool annotations are
 * therefore derived PER-TOOL from catalog metadata — `readOnlyHint` is
 * NOT blanket-true, so write-capable tools are never mislabeled
 * read-only to MCP clients.
 */
import { getBridgeSafeTools, executeBridgeTool } from "./tool-adapter";
import { auditBridgeCall } from "./audit";

/** Advertised in newest-first order; initialize echoes a supported request or falls back to [0]. */
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export const MCP_SERVER_INFO = {
  name: "statenour-command",
  title: "StateNour Command",
  version: "1.0.0",
} as const;

/** JSON-RPC 2.0 reserved error codes. */
export const RPC_ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const;

type JsonRpcId = string | number | null;

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
}

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
  });
}

function handleToolsList(id: JsonRpcId): JsonRpcResponse {
  const tools = getBridgeSafeTools("mcp").map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    // Per-tool from catalog metadata — the bridge is full-operational, so
    // a write tool must report readOnlyHint:false (never mislabel it).
    annotations: {
      readOnlyHint: t.meta?.sideEffecting !== true,
      destructiveHint: t.meta?.sideEffecting === true,
      openWorldHint: t.meta?.needsBridge === true,
    },
  }));
  return ok(id, { tools });
}

/** structuredContent must be an object — wrap arrays/scalars losslessly. */
function wrapStructured(result: unknown): Record<string, unknown> {
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result: result ?? null };
}

async function handleToolsCall(id: JsonRpcId, params: Record<string, unknown> | undefined): Promise<JsonRpcResponse> {
  const name = typeof params?.name === "string" ? params.name : "";
  const args = (params?.arguments ?? {}) as Record<string, unknown>;
  const tool = getBridgeSafeTools("mcp").find((t) => t.name === name);
  if (!tool) {
    return fail(id, RPC_ERROR.INVALID_PARAMS, `Unknown tool: ${name || "(missing name)"}`);
  }

  const started = Date.now();
  const requestId =
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  let status: "success" | "error" = "success";
  let errorCode: string | undefined;
  let rawResult: any;

  try {
    rawResult = await executeBridgeTool(tool, args);
    if (rawResult && rawResult.error === true) {
      throw new Error(rawResult.message);
    }
    return ok(id, {
      content: [{ type: "text", text: JSON.stringify(rawResult ?? null, null, 2) }],
      structuredContent: wrapStructured(rawResult),
      isError: false,
    });
  } catch (err) {
    status = "error";
    const message = err instanceof Error ? err.message : String(err);
    errorCode = message;
    // Tool execution failures are tool RESULTS per MCP spec (the model
    // should see them), not protocol errors — and we never leak stacks.
    return ok(id, {
      content: [{ type: "text", text: `Tool ${name} failed: ${message}` }],
      isError: true,
    });
  } finally {
    await auditBridgeCall({
      requestId,
      protocol: "mcp",
      toolName: tool.camelName,
      externalName: name,
      status,
      latencyMs: Date.now() - started,
      inputRaw: JSON.stringify(args || {}),
      errorCode,
      resultSize: JSON.stringify(rawResult || "").length,
      riskClass: tool.meta?.riskClass || "low",
    });
  }
}

/**
 * Dispatch one decoded JSON-RPC message. Returns null for notifications
 * (the route answers HTTP 202 with no body).
 */
export async function handleMcpMessage(message: unknown): Promise<JsonRpcResponse | null> {
  if (Array.isArray(message)) {
    return fail(null, RPC_ERROR.INVALID_REQUEST, "JSON-RPC batching is not supported");
  }
  if (!message || typeof message !== "object") {
    return fail(null, RPC_ERROR.INVALID_REQUEST, "Expected a JSON-RPC request object");
  }
  const req = message as { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> };
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
