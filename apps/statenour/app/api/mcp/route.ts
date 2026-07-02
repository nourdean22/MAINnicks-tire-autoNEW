/**
 * POST /api/mcp — StateNour Command MCP facade (Streamable HTTP).
 *
 * External control port for MCP clients (ChatGPT Apps/connectors,
 * Claude, MCP Inspector). Read-only Tier 1 per docs/MCP-PLAN.md.
 *
 * Auth: dedicated bearer secret (MCP_ACCESS_TOKEN) — NOT apiHandler's
 * `auth: "owner"` session path, because connector clients can't hold a
 * NextAuth session and the JSON-RPC envelope needs protocol-shaped
 * errors, not the standard API error body. Fail-closed: env unset →
 * 503 for everything.
 *
 * GET (SSE stream) and DELETE (session teardown) answer 405 — this
 * server is stateless; every POST is a complete JSON-RPC exchange.
 */
import { NextResponse } from "next/server";
import { requireMcpAuth, McpAuthError } from "@/lib/mcp/auth";
import { handleMcpMessage, RPC_ERROR } from "@/lib/mcp/server";
import { auditMcp } from "@/lib/mcp/audit";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    requireMcpAuth(req);
  } catch (err) {
    const status = err instanceof McpAuthError ? err.status : 401;
    auditMcp({ event: "auth_failed", ok: false, error: `status ${status}` });
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: RPC_ERROR.INVALID_REQUEST, message: err instanceof Error ? err.message : "Unauthorized" } },
      { status },
    );
  }

  let message: unknown;
  try {
    message = await req.json();
  } catch {
    auditMcp({ event: "request", ok: false, error: "parse error" });
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: RPC_ERROR.PARSE, message: "Parse error" } },
      { status: 400 },
    );
  }

  const started = Date.now();
  const method = (message as { method?: unknown })?.method;
  const response = await handleMcpMessage(message);
  auditMcp({
    event: "request",
    method: typeof method === "string" ? method : undefined,
    ok: response?.error === undefined,
    ms: Date.now() - started,
  });

  // Notifications get 202 Accepted with no body per Streamable HTTP.
  if (response === null) {
    return new Response(null, { status: 202 });
  }
  return NextResponse.json(response);
}

export function GET(): Response {
  // No server-initiated SSE stream in v1 (stateless server).
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

export function DELETE(): Response {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
