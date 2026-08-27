import { assertBridgeAuth } from "@/lib/agent-bridge/auth";
import { getBridgeSafeTools, executeBridgeTool, bridgeCatalogIndex } from "@/lib/agent-bridge/tool-adapter";
import { assertBridgeToolAllowed } from "@/lib/agent-bridge/tool-policy";
import { auditBridgeCall, auditBridgeRejection, classifyBridgeFailure } from "@/lib/agent-bridge/audit";
import { getToolRiskClass } from "@/lib/ai/tools/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function newRequestId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(7);
}

export async function POST(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  try {
    const identity = assertBridgeAuth(req);

    const { tool: toolName } = await params;
    // P1 (Codex #1944): pass the caller's scope so a read-only token cannot
    // execute an Actions write. getBridgeSafeTools now filters the curated list
    // to the caller's scope.
    const tools = getBridgeSafeTools("actions", identity.scope);
    const tool = tools.find((t) => t.name === toolName);

    if (!tool) {
      // P2 (Codex #1944): a refused Action — unknown, out-of-scope, or a
      // protected op like run_python — must leave a durable `denied` row, same
      // as the MCP path. Classify against the FULL catalog so a HARD_DENY probe
      // is audited rather than silently 404'd.
      const known = bridgeCatalogIndex().find((t) => t.name === toolName);
      if (known) {
        let reason = "denied for actions";
        try {
          assertBridgeToolAllowed(known.camelName, "actions", identity.scope);
        } catch (e) {
          reason = e instanceof Error ? e.message : String(e);
        }
        await auditBridgeCall({
          requestId: newRequestId(),
          protocol: "actions",
          toolName: known.camelName,
          externalName: toolName,
          clientId: identity.clientId,
          scope: identity.scope,
          status: "denied",
          latencyMs: 0,
          inputRaw: "",
          errorCode: reason,
          riskClass: getToolRiskClass(known.camelName, known.meta),
        });
      }
      return Response.json(
        { error: `Tool ${toolName} not found or not permitted for Actions.` },
        { status: 404 },
      );
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
    const requestId = newRequestId();
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
        clientId: identity.clientId,
        scope: identity.scope,
        status,
        latencyMs,
        inputRaw: JSON.stringify(args || {}),
        errorCode,
        resultSize: JSON.stringify(rawResult || "").length,
        // See the note in mcp-server.ts: camelName, not the snake route param.
        riskClass: getToolRiskClass(tool.camelName, tool.meta),
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
    // P2 (Codex #1944): the new multi-token fail-closed message ("no
    // AGENT_BRIDGE token ... Failing closed") is a configuration outage — 503,
    // not 500, so monitoring treats it as a bridge outage not a request bug.
    if (message.includes("disabled") || message.includes("missing") || message.includes("Failing closed")) {
      return new Response(message, { status: 503 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
