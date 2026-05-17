/**
 * POST /api/vapi/check-used-tire-stock — VAPI tool · used-tire stock check.
 *
 * v10.0.278 · the high-volume "do you have a 225/65R17 in used?"
 * scenario. Caller often broken-down on the side of the road, calling
 * around shops. We CAN'T drop them — they have to stay on the line.
 *
 * Flow:
 *   1. This tool captures the size + caller + vehicle + urgency
 *   2. Persists to brainMemory + forwards to nickstire admin bridge
 *      (when it exists) so the request is logged for follow-up
 *   3. Fires an IMMEDIATE Telegram alert to the shop owner so they
 *      see the request flash on their phone before transfer connects
 *   4. Returns success · the assistant then calls transferCall to
 *      hand the live caller to the shop manager line
 *
 * The caller never hangs up · Nick says "hang on a sec while I get
 * the shop on the line" then warm-transfers. The Telegram heads-up
 * arrives in 1-2 seconds so the manager knows context before answering.
 *
 * // public: VAPI webhook · authenticated via X-Vapi-Secret header.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { postCallbackToNickstire, type CallbackPayload } from "@/lib/services/nickstire-write";

const log = rootLogger.withSurface("api/vapi/check-used-tire-stock");

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
        callerName?: string;
        callerPhone?: string;
        tireSize?: string;
        quantity?: number;
        vehicleYear?: string | number;
        vehicleMake?: string;
        vehicleModel?: string;
        urgency?: string;
        notes?: string;
      };

      // v10.0.279 · size is OPTIONAL. Stressed callers may not have it
      // readable. Capture-and-transfer always · the manager gets the
      // size on the live transfer if it wasn't provided here. Per Nour:
      // "most of the calls are customers searching for a used tire size
      // for their car" · so this tool is the HOT PATH, speed > completeness.
      const size = (args.tireSize ?? "").trim();

      const payload = {
        source: "vapi:nick:used-tire-check",
        vapiCallId,
        capturedAt: new Date().toISOString(),
        callerName: args.callerName ?? null,
        callerPhone: args.callerPhone ?? null,
        tireSize: size || "(not yet given · manager to ask on transfer)",
        quantity: args.quantity ?? 1,
        vehicle: {
          year: args.vehicleYear ?? null,
          make: args.vehicleMake ?? null,
          model: args.vehicleModel ?? null,
        },
        urgency: args.urgency ?? "normal",
        notes: args.notes ?? null,
      };

      // 1. Persist to brainMemory (always · primary record until bridge exists)
      try {
        await prisma.brainMemory.create({
          data: {
            category: "tire_stock_request",
            key: `vapi_tire_${vapiCallId ?? Date.now()}`,
            content: JSON.stringify(payload),
            confidence: 1,
            source: "vapi:check-used-tire-stock",
          },
        });
      } catch (err) {
        log.error("tire_stock_persist_failed", {
          vapiCallId,
          error: err instanceof Error ? err.message : String(err),
        });
        // Continue · we still want to fire Telegram so the shop sees it
      }

      // 2. Forward to nickstire admin bridge as a callback request
      //    (until a dedicated tire-stock-check bridge endpoint exists)
      const cb: CallbackPayload = {
        source: payload.source,
        vapiCallId,
        capturedAt: payload.capturedAt,
        name: args.callerName ?? null,
        phone: args.callerPhone ?? null,
        reason: `Used-tire stock check · ${size}${
          args.quantity && args.quantity > 1 ? ` (${args.quantity})` : ""
        }${
          args.vehicleYear || args.vehicleMake
            ? ` · ${args.vehicleYear ?? ""} ${args.vehicleMake ?? ""} ${
                args.vehicleModel ?? ""
              }`.trim()
            : ""
        }${args.notes ? ` · ${args.notes}` : ""}`,
        urgency: "urgent",
        preferredTime: null,
        language: "english",
      };
      void postCallbackToNickstire(cb).catch(() => {
        // best-effort · the brainMemory write above is the safety net
      });

      // 3. Fire IMMEDIATE Telegram heads-up to the shop owner so the
      //    manager sees the request before warm-transfer connects.
      try {
        const { sendTelegram } = await import("@/lib/services/telegram");
        const lines = [
          "🔥 LIVE CALL · USED TIRE STOCK CHECK",
          "",
          size
            ? `Size · ${size}${args.quantity && args.quantity > 1 ? `  (×${args.quantity})` : ""}`
            : "Size · NOT YET GIVEN · ask the caller on the line",
        ];
        if (args.vehicleYear || args.vehicleMake || args.vehicleModel) {
          lines.push(
            `Vehicle · ${[args.vehicleYear, args.vehicleMake, args.vehicleModel]
              .filter(Boolean)
              .join(" ")}`,
          );
        }
        if (args.callerName || args.callerPhone) {
          lines.push(`Caller · ${args.callerName ?? ""}${args.callerPhone ? ` · ${args.callerPhone}` : ""}`.trim());
        }
        if (args.urgency && args.urgency !== "normal") {
          lines.push(`Urgency · ${args.urgency.toUpperCase()}`);
        }
        if (args.notes) lines.push(`Notes · ${args.notes}`);
        lines.push("");
        lines.push("Caller is on hold · Nick is transferring now.");
        await sendTelegram(lines.join("\n"));
        log.info("tire_stock_telegram_sent", {
          vapiCallId,
          size,
          phoneTail: args.callerPhone?.slice(-4),
        });
      } catch (err) {
        log.warn("tire_stock_telegram_failed", {
          vapiCallId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return {
        toolCallId: tc.id,
        result: size
          ? `Got it. ${size}${
              args.quantity && args.quantity > 1 ? ` ×${args.quantity}` : ""
            }. I'm texting the shop right now and connecting you live. Hold the line a second — they'll know what you're calling about before they pick up.`
          : "Got it · I'm texting the shop right now and connecting you live. Hang on a sec — they'll get the size from you on the line.",
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
        metadata: { source: "vapi:check-used-tire-stock", toolCalls: calls.length },
      });
    } catch {
      // intentionally swallow
    }
  }

  return NextResponse.json({ results });
}
