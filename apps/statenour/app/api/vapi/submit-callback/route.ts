/**
 * POST /api/vapi/submit-callback — VAPI tool · log a callback request.
 *
 * v10.0.270 · called by the "Nick" voice assistant when a caller asks
 * for a callback (price questions Nick won't quote, Spanish escalation,
 * angry callers needing a human, after-hours requests, etc.). Forwards
 * to nickstire.org admin (Auto Labor Guide) first · falls back to
 * brainMemory only if the bridge is unreachable.
 *
 * // public: VAPI webhook · authenticated via X-Vapi-Secret header
 * // (NOT session-auth). Soft-fails to dev mode if env not set.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { postCallbackToNickstire, type CallbackPayload } from "@/lib/services/nickstire-write";

const log = rootLogger.withSurface("api/vapi/submit-callback");

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

// v10.0.525 · security S-1 fix · shared timing-safe verifier.
import { verifyVapiSecret } from "@/lib/auth/vapi-webhook";

export async function POST(req: NextRequest) {
  // v10.0.526 · Arc A F3 · webhook-receive anchor for latency capture.
  const webhookReceivedAt = Date.now();
  if (!verifyVapiSecret(req)) {
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
        reason?: string;
        urgency?: string;
        preferredTime?: string;
        language?: string;
      };

      if (!args.phone && !args.name) {
        return {
          toolCallId: tc.id,
          result:
            "I need at least a name or phone number to set up the callback. Can you share one?",
        };
      }

      const payload: CallbackPayload = {
        source: "vapi:nick",
        vapiCallId,
        capturedAt: new Date().toISOString(),
        name: args.name ?? null,
        phone: args.phone ?? null,
        reason: args.reason ?? null,
        urgency: args.urgency ?? "normal",
        preferredTime: args.preferredTime ?? null,
        language: args.language ?? "english",
      };

      // 1. Forward to nickstire admin first (canonical record)
      const bridge = await postCallbackToNickstire(payload);

      // 2. Always mirror to brainMemory (primary if bridge miss, backup if bridge ok)
      try {
        const callbackKey = `vapi_callback_${vapiCallId ?? Date.now()}`;
        await prisma.brainMemory.create({
          data: {
            category: "callback_request",
            key: callbackKey,
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
              ? "vapi:submit-callback:bridged"
              : "vapi:submit-callback:fallback",
          },
        });
      } catch (err) {
        log.error("callback_persist_failed", {
          vapiCallId,
          error: err instanceof Error ? err.message : String(err),
          bridgeOk: bridge.ok,
        });
        if (!bridge.ok) {
          return {
            toolCallId: tc.id,
            result:
              "Looks like the system hiccuped on me. Stop by during business hours or try us again and we'll take care of you.",
          };
        }
      }

      log.info("callback_captured", {
        vapiCallId,
        phoneTail: args.phone?.slice(-4),
        urgency: args.urgency,
        language: args.language,
        via: bridge.via,
        bridgeOk: bridge.ok,
      });

      return {
        toolCallId: tc.id,
        result:
          "Perfect · I've got your info and someone from the shop will give you a call back as soon as they can.",
      };
    }),
  );

  // v10.0.526 · Arc A F3 · tool-call latency capture · fail-open.
  if (vapiCallId) {
    try {
      const { captureVoiceLatency } = await import("@/lib/services/voice-latency");
      await captureVoiceLatency({
        callId: vapiCallId,
        assistantId,
        stage: "llm_first_token",
        latencyMs: Date.now() - webhookReceivedAt,
        metadata: { source: "vapi:submit-callback", toolCalls: calls.length },
      });
    } catch {
      // intentionally swallow
    }
  }

  return NextResponse.json({ results });
}
