import crypto from "crypto";

export async function auditBridgeCall(params: {
  requestId: string;
  protocol: "mcp" | "actions";
  toolName: string;
  externalName: string;
  status: "success" | "error";
  latencyMs: number;
  inputRaw: string;
  resultSize?: number;
  riskClass: string;
  errorCode?: string;
}) {
  const { inputRaw, ...rest } = params;
  
  const inputHash = crypto.createHash("sha256").update(inputRaw).digest("hex");
  
  console.log(JSON.stringify({
    event: "agent_bridge_audit",
    timestamp: new Date().toISOString(),
    inputHash,
    ...rest
  }));
}

/** Why a bridge call never reached a tool. */
export type BridgeRejectionReason = "disabled" | "misconfigured" | "unauthorized" | "forbidden";

/**
 * Audit a bridge call rejected BEFORE any tool matched.
 *
 * auditBridgeCall() above only fires inside the tool-execution path, and
 * neither bridge route wraps apiHandler() from lib/utils/http.ts — so until
 * this existed a rejected call was invisible in all three sinks at once: no
 * apiHandler start/done line, no ApiRequestLog row, no agent_bridge_audit.
 *
 * Verified 2026-08-10, not inferred: a probe that provably reached the handler
 * (HTTP 403 — assertBridgeAuth threw Forbidden) produced ZERO /api/mcp lines in
 * the statenour-web log stream, while /api/health logged 94 times in the same
 * 500-line window. Two things were therefore impossible: detecting token
 * brute-forcing against a surface publishing 177 tools (21 sideEffecting), and
 * answering "is anything actually calling the bridge?" — the question any
 * proposal to build ON the bridge depends on.
 *
 * The bearer token is NEVER read here. The caller IP is hashed, so repeated
 * attempts stay correlatable without holding an address in the clear.
 */
export async function auditBridgeRejection(params: {
  protocol: "mcp" | "actions";
  reason: BridgeRejectionReason;
  req: Request;
  externalName?: string;
}) {
  const { protocol, reason, req, externalName } = params;
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";

  console.log(JSON.stringify({
    event: "agent_bridge_rejected",
    timestamp: new Date().toISOString(),
    protocol,
    reason,
    externalName,
    method: req.method,
    clientHash: crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12),
    userAgent: req.headers.get("user-agent")?.slice(0, 120) ?? null,
  }));
}

/** Map an assertBridgeAuth() failure message onto a rejection reason. */
export function classifyBridgeFailure(message: string): BridgeRejectionReason | null {
  if (message === "Unauthorized") return "unauthorized";
  if (message === "Forbidden") return "forbidden";
  if (message.includes("disabled")) return "disabled";
  if (message.includes("missing")) return "misconfigured";
  return null;
}
