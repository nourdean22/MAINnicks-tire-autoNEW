import { assertBridgeAuth } from "@/lib/agent-bridge/auth";
import { getBridgeSafeTools, executeBridgeTool } from "@/lib/agent-bridge/tool-adapter";
import { auditBridgeCall, auditBridgeRejection, classifyBridgeFailure } from "@/lib/agent-bridge/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  try {
    assertBridgeAuth(req);
    
    const { tool: toolName } = await params;
    const tools = getBridgeSafeTools("actions");
    const tool = tools.find(t => t.name === toolName);
    
    if (!tool) {
      return Response.json({ error: `Tool ${toolName} not found or not permitted for Actions.` }, { status: 404 });
    }
    
    let args = {};
    try {
      const text = await req.text();
      if (text) {
        args = JSON.parse(text);
      }
    } catch (e) {
      // empty or invalid JSON falls back to {}
    }

    const startTime = Date.now();
    const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(7);
    let status: "success" | "error" = "success";
    let errorCode = undefined;
    let rawResult;
    
    try {
      rawResult = await executeBridgeTool(tool, args);
      if (rawResult && rawResult.error === true) {
        throw new Error(rawResult.message);
      }
      return Response.json(rawResult);
    } catch (error: any) {
      status = "error";
      errorCode = error.message;
      return Response.json({ error: error.message }, { status: 500 });
    } finally {
      const latencyMs = Date.now() - startTime;
      await auditBridgeCall({
        requestId,
        protocol: "actions",
        toolName: tool.camelName,
        externalName: toolName,
        status,
        latencyMs,
        inputRaw: JSON.stringify(args || {}),
        errorCode,
        resultSize: JSON.stringify(rawResult || "").length,
        riskClass: tool.meta.riskClass || "low"
      });
    }
  } catch (error: any) {
    // Mirrors /api/mcp: this route does not wrap apiHandler() either, and
    // auditBridgeCall() only fires once a tool has matched — so a refused
    // call was previously untraceable. Responses are unchanged.
    const message: string = error?.message ?? "Internal error";
    const reason = classifyBridgeFailure(message);
    if (reason) await auditBridgeRejection({ protocol: "actions", reason, req });

    if (message === "Unauthorized") return new Response("Unauthorized", { status: 401 });
    if (message === "Forbidden") return new Response("Forbidden", { status: 403 });
    if (message.includes("disabled") || message.includes("missing")) {
      return new Response(message, { status: 503 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
