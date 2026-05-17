/**
 * POST /api/vapi/schedule-dropoff — VAPI tool · books a drop-off request.
 *
 * v10.0.270 · called by the "Nick" voice assistant when a caller wants
 * to drop off their car. Forwards to nickstire.org admin (Auto Labor
 * Guide CRM) via the bridge first · falls back to brainMemory only if
 * nickstire is unreachable. The canonical record lives where business
 * data belongs.
 *
 * VAPI tool-call shape:
 *   POST /api/vapi/schedule-dropoff
 *   Headers · X-Vapi-Secret: <shared secret>
 *   Body · { "message": { "toolCallList": [ { "id", "function": { "name", "arguments": {...} } } ] } }
 *
 * VAPI expects the response shape:
 *   { "results": [ { "toolCallId": "...", "result": "<string>" } ] }
 *
 * // public: VAPI webhook · authenticated via X-Vapi-Secret header that
 * // VAPI sends on every tool call. NOT session-auth. Soft-fails to
 * // dev-mode (logs warning) if VAPI_WEBHOOK_SECRET env not set.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { postDropoffToNickstire, type DropoffPayload } from "@/lib/services/nickstire-write";

const log = rootLogger.withSurface("api/vapi/schedule-dropoff");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ToolCall {
  id: string;
  function?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

interface VapiToolPayload {
  message?: {
    toolCallList?: ToolCall[];
    toolCalls?: ToolCall[];
    call?: { id?: string; assistantId?: string };
  };
}

// v10.0.525 · security audit S-1 fix · the local verifyVapiSecret
// pattern was fail-OPEN when env var unset + non-timing-safe ===
// (CVSS 9.1 Critical). Replaced with the shared helper that fails
// closed + uses timingSafeEqual.
import { verifyVapiSecret } from "@/lib/auth/vapi-webhook";

export async function POST(req: NextRequest) {
  // v10.0.526 · Arc A F3 · capture tool-call dispatch start so end-to-
  // end latency derivation has a webhook-side anchor. The actual write
  // happens AFTER results are assembled (below) so a measurement bug
  // can never break the tool-call response.
  const webhookReceivedAt = Date.now();
  if (!verifyVapiSecret(req)) {
    log.warn("vapi_secret_mismatch");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: VapiToolPayload;
  try {
    body = (await req.json()) as VapiToolPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const calls = body.message?.toolCallList ?? body.message?.toolCalls ?? [];
  const vapiCallId = body.message?.call?.id ?? null;
  const assistantId = body.message?.call?.assistantId ?? "unknown";

  const results = await Promise.all(
    calls.map(async (tc) => {
      const args = (tc.function?.arguments ?? {}) as {
        name?: string;
        phone?: string;
        vehicleYear?: string | number;
        vehicleMake?: string;
        vehicleModel?: string;
        concern?: string;
        preferredTime?: string;
        driveable?: boolean | string;
        returningCustomer?: boolean | string;
      };

      // Light validation · refuse only when nothing useful is captured
      if (!args.phone && !args.name) {
        return {
          toolCallId: tc.id,
          result:
            "I need at least a name or phone number to log the drop-off. Could you share that with me?",
        };
      }

      // Build canonical payload once · sent to nickstire AND used for
      // the local-mirror brainMemory write below.
      const payload: DropoffPayload = {
        source: "vapi:nick",
        vapiCallId,
        capturedAt: new Date().toISOString(),
        name: args.name ?? null,
        phone: args.phone ?? null,
        vehicle: {
          year: args.vehicleYear ?? null,
          make: args.vehicleMake ?? null,
          model: args.vehicleModel ?? null,
        },
        concern: args.concern ?? null,
        preferredTime: args.preferredTime ?? null,
        driveable: args.driveable ?? null,
        returningCustomer: args.returningCustomer ?? null,
      };

      // 1. Try nickstire admin first (canonical home for business data)
      const bridge = await postDropoffToNickstire(payload);

      // 2. ALWAYS also mirror to brainMemory · either primary record
      //    (if bridge missed) or backup with upstream ticket-id link.
      try {
        const dropoffKey = `vapi_dropoff_${vapiCallId ?? Date.now()}`;
        await prisma.brainMemory.create({
          data: {
            category: "dropoff_request",
            key: dropoffKey,
            content: JSON.stringify({
              ...payload,
              bridge: {
                via: bridge.via,
                ok: bridge.ok,
                ticketId: bridge.ok ? bridge.data.id ?? null : null,
                reason: bridge.ok ? null : bridge.reason,
              },
            }),
            confidence: 1,
            source: bridge.ok
              ? "vapi:schedule-dropoff:bridged"
              : "vapi:schedule-dropoff:fallback",
          },
        });
      } catch (err) {
        log.error("dropoff_persist_failed", {
          vapiCallId,
          error: err instanceof Error ? err.message : String(err),
          bridgeOk: bridge.ok,
        });
        if (!bridge.ok) {
          // Both bridge AND local failed · tell caller it didn't go through.
          return {
            toolCallId: tc.id,
            result:
              "Looks like that didn't go through on my end. I'll have someone from the shop follow up with you directly.",
          };
        }
      }

      log.info("dropoff_captured", {
        vapiCallId,
        phoneTail: args.phone?.slice(-4),
        hasVehicle: !!(args.vehicleMake || args.vehicleModel),
        via: bridge.via,
        bridgeOk: bridge.ok,
        bridgeReason: bridge.ok ? null : bridge.reason,
      });

      return {
        toolCallId: tc.id,
        result:
          "Got it. I've sent your drop-off info over to the shop and someone will confirm everything with you shortly.",
      };
    }),
  );

  // v10.0.526 · Arc A F3 · capture tool-call handler latency. This is
  // the LLM→tool→ack round-trip, not end-to-end (cron derives that
  // from VAPI's REST). Fail-open · never breaks the response.
  if (vapiCallId) {
    try {
      const { captureVoiceLatency } = await import("@/lib/services/voice-latency");
      await captureVoiceLatency({
        callId: vapiCallId,
        assistantId,
        stage: "llm_first_token",
        latencyMs: Date.now() - webhookReceivedAt,
        metadata: { source: "vapi:schedule-dropoff", toolCalls: calls.length },
      });
    } catch {
      // intentionally swallow
    }
  }

  return NextResponse.json({ results });
}
