import { assertBridgeAuth } from "@/lib/agent-bridge/auth";
import { getBridgeSafeTools, executeBridgeTool } from "@/lib/agent-bridge/tool-adapter";
import { auditBridgeCall } from "@/lib/agent-bridge/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SERVER_INFO = {
  name: "statenour-command",
  version: "1.0.0"
};

export async function POST(req: Request) {
  try {
    assertBridgeAuth(req);
    const body = await req.json();
    const { method, params, id } = body;

    if (method === "initialize") {
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO
        }
      });
    }

    if (method === "tools/list") {
      const tools = getBridgeSafeTools("mcp").map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }));
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: { tools }
      });
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;
      const tools = getBridgeSafeTools("mcp");
      const tool = tools.find(t => t.name === name);

      if (!tool) {
        return Response.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Tool not found: ${name}` }
        });
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
        
        return Response.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(rawResult, null, 2) }],
            isError: false
          }
        });
      } catch (error: any) {
        status = "error";
        errorCode = error.message;
        return Response.json({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true
          }
        });
      } finally {
        const latencyMs = Date.now() - startTime;
        await auditBridgeCall({
          requestId,
          protocol: "mcp",
          toolName: tool.camelName,
          externalName: name,
          status,
          latencyMs,
          inputRaw: JSON.stringify(args || {}),
          errorCode,
          resultSize: JSON.stringify(rawResult || "").length,
          riskClass: tool.meta.riskClass || "low"
        });
      }
    }

    return Response.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    });
  } catch (error: any) {
    if (error.message === "Unauthorized") return new Response("Unauthorized", { status: 401 });
    if (error.message === "Forbidden") return new Response("Forbidden", { status: 403 });
    if (error.message.includes("disabled") || error.message.includes("missing")) {
      return new Response(error.message, { status: 503 });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: error.message }
    });
  }
}
