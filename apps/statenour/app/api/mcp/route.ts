import { assertBridgeAuth } from "@/lib/agent-bridge/auth";
import { auditBridgeRejection, classifyBridgeFailure } from "@/lib/agent-bridge/audit";
import { handleMcpMessage, RPC_ERROR } from "@/lib/agent-bridge/mcp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertBridgeAuth(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: RPC_ERROR.PARSE, message: "Parse error" } },
        { status: 400 },
      );
    }

    const res = await handleMcpMessage(body);
    // Notifications get no response body (JSON-RPC + MCP spec).
    if (res === null) return new Response(null, { status: 202 });
    return Response.json(res);
  } catch (error: any) {
    const message: string = error?.message ?? "Internal error";
    // Rejections never reach handleToolsCall(), so auditBridgeCall() never
    // fires for them and this route does not wrap apiHandler() — without this
    // line a refused call leaves no trace anywhere. Responses are unchanged.
    const reason = classifyBridgeFailure(message);
    if (reason) await auditBridgeRejection({ protocol: "mcp", reason, req });

    if (message === "Unauthorized") return new Response("Unauthorized", { status: 401 });
    if (message === "Forbidden") return new Response("Forbidden", { status: 403 });
    if (message.includes("disabled") || message.includes("missing")) {
      return new Response(message, { status: 503 });
    }
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: RPC_ERROR.INTERNAL, message } });
  }
}

// The Streamable-HTTP surface here is POST-only. Advertise the others as 405.
export function GET() {
  return new Response("Method Not Allowed", { status: 405 });
}
export function DELETE() {
  return new Response("Method Not Allowed", { status: 405 });
}
