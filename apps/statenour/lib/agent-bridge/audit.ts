import crypto from "crypto";

export async function auditBridgeCall(params: {
  requestId: string;
  protocol: "mcp" | "actions";
  toolName: string;
  externalName: string;
  /** "success" | "error" | "denied" — a scope/HARD_DENY refusal is audited too. */
  status: "success" | "error" | "denied";
  latencyMs: number;
  inputRaw: string;
  resultSize?: number;
  riskClass: string;
  errorCode?: string;
  /** Token NAME (from auth.ts), never the token value. */
  clientId?: string;
  /** The authenticated scope this call ran under. */
  scope?: string;
}) {
  const { inputRaw, ...rest } = params;

  const inputHash = crypto.createHash("sha256").update(inputRaw).digest("hex");

  // Structured console line stays — it is the cheap, always-on sink and is what
  // Railway logs retain. The DURABLE row below is what makes "who called this
  // last month" answerable, the exact question the console-only sink could not
  // (measured 2026-08-27: zero rows in every DB sink for a call that provably
  // reached the handler).
  console.log(JSON.stringify({
    event: "agent_bridge_audit",
    timestamp: new Date().toISOString(),
    inputHash,
    ...rest,
  }));

  // DURABLE row. Fault-tolerant by construction (CIITTY: never crash the API on
  // a missing table): a not-yet-applied migration, or any DB hiccup, degrades
  // to the console line rather than throwing into the tool-execution path. The
  // raw args are NEVER stored — only their sha256, same as the console sink.
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.bridgeCallLog.create({
      data: {
        requestId: params.requestId,
        protocol: params.protocol,
        clientId: params.clientId ?? "unknown",
        scope: params.scope ?? "unknown",
        toolName: params.toolName,
        externalName: params.externalName,
        status: params.status,
        riskClass: params.riskClass,
        latencyMs: params.latencyMs,
        inputHash,
        resultSize: params.resultSize ?? null,
        errorCode: params.errorCode ?? null,
      },
    });
  } catch (err) {
    // The write is best-effort telemetry, not the request's job. Log and move
    // on — a failed audit-write must never turn a good tool call into a 500.
    console.warn(
      JSON.stringify({
        event: "agent_bridge_audit_persist_failed",
        timestamp: new Date().toISOString(),
        requestId: params.requestId,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      }),
    );
  }
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
  // Fail-closed misconfiguration: the legacy "missing" wording plus the
  // 2026-08-27 multi-token message ("no AGENT_BRIDGE token is set ... Failing
  // closed"). Both mean the server cannot authenticate anyone and must be
  // audited as misconfigured, not silently unclassified.
  if (message.includes("missing") || message.includes("Failing closed") || message.includes("no AGENT_BRIDGE token")) {
    return "misconfigured";
  }
  return null;
}
