import { ProtocolErrorCode } from "@modelcontextprotocol/server";
import { assertBridgeAuth } from "@/lib/agent-bridge/auth";
import { auditBridgeRejection, classifyBridgeFailure } from "@/lib/agent-bridge/audit";
import { handleAuthenticatedMcpRequest } from "@/lib/agent-bridge/mcp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const identity = assertBridgeAuth(req);
    return await handleAuthenticatedMcpRequest(req, identity);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal error";
    const reason = classifyBridgeFailure(message);
    if (reason) await auditBridgeRejection({ protocol: "mcp", reason, req });

    if (message === "Unauthorized") return new Response("Unauthorized", { status: 401 });
    if (message === "Forbidden") return new Response("Forbidden", { status: 403 });
    if (
      message.includes("disabled") ||
      message.includes("missing") ||
      message.includes("Failing closed")
    ) {
      return new Response(message, { status: 503 });
    }

    return Response.json({
      jsonrpc: "2.0",
      id: null,
      error: { code: ProtocolErrorCode.InternalError, message },
    });
  }
}

// The public bridge remains POST-only. The v2 handler's modern exchange and
// its 2025 stateless fallback both live behind POST /api/mcp.
export function GET() {
  return new Response("Method Not Allowed", { status: 405 });
}

export function DELETE() {
  return new Response("Method Not Allowed", { status: 405 });
}
