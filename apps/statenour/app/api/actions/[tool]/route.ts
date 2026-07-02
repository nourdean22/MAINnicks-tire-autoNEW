import { assertBridgeAuth } from "@/lib/agent-bridge/auth";
import { getBridgeSafeTools, executeBridgeTool } from "@/lib/agent-bridge/tool-adapter";
import { auditBridgeCall } from "@/lib/agent-bridge/audit";

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
    if (error.message === "Unauthorized") return new Response("Unauthorized", { status: 401 });
    if (error.message === "Forbidden") return new Response("Forbidden", { status: 403 });
    if (error.message.includes("disabled") || error.message.includes("missing")) {
      return new Response(error.message, { status: 503 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
}
