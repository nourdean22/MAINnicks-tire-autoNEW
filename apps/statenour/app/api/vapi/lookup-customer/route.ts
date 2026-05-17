/**
 * POST /api/vapi/lookup-customer — VAPI tool · returning-customer recognition.
 *
 * v10.0.270 · called by the "Nick" voice assistant when a caller's phone
 * number comes through. Asks nickstire.org admin (Auto Labor Guide) first
 * for the canonical customer record. Falls back to a brainMemory scan if
 * the bridge is unreachable.
 *
 * // public: VAPI webhook · authenticated via X-Vapi-Secret header
 * // (NOT session-auth). Soft-fails to dev mode if env not set.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { lookupCustomerOnNickstire } from "@/lib/services/nickstire-write";

const log = rootLogger.withSurface("api/vapi/lookup-customer");

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

function normalizePhone(s: string): string {
  return s.replace(/\D+/g, "").slice(-10);
}

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
      const args = (tc.function?.arguments ?? {}) as { phone?: string };
      if (!args.phone) {
        return {
          toolCallId: tc.id,
          result:
            "No phone provided · treating as a new caller.",
        };
      }
      const phoneNorm = normalizePhone(args.phone);
      if (phoneNorm.length < 10) {
        return {
          toolCallId: tc.id,
          result:
            "Phone number didn't parse · treating as a new caller.",
        };
      }

      // 1. Try nickstire admin first (canonical Auto Labor Guide record)
      const bridge = await lookupCustomerOnNickstire(phoneNorm);
      if (bridge.ok && bridge.data.found) {
        log.info("customer_found_via_bridge", {
          phoneTail: phoneNorm.slice(-4),
          visitCount: bridge.data.visitCount,
        });
        const name = bridge.data.name;
        const visits = bridge.data.visitCount ?? 1;
        return {
          toolCallId: tc.id,
          result: name
            ? `Returning customer · ${name} · ${visits} prior visit${visits === 1 ? "" : "s"} (Auto Labor Guide).`
            : `Returning caller · ${visits} prior visit${visits === 1 ? "" : "s"} (Auto Labor Guide).`,
        };
      }
      if (bridge.ok && !bridge.data.found) {
        log.info("customer_not_found_in_bridge", { phoneTail: phoneNorm.slice(-4) });
        return {
          toolCallId: tc.id,
          result: "New caller · no prior record in Auto Labor Guide.",
        };
      }

      // 2. Bridge missed · fall back to brainMemory scan (cached recents)
      try {
        const memories = await prisma.brainMemory.findMany({
          where: {
            category: { in: ["customer", "dropoff_request", "callback_request"] },
            content: { contains: phoneNorm },
            deletedAt: null,
          },
          select: { id: true, category: true, content: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        });
        if (memories.length === 0) {
          log.info("customer_not_found_local_fallback", {
            phoneTail: phoneNorm.slice(-4),
            bridgeReason: bridge.ok ? "not_found" : bridge.reason,
          });
          return {
            toolCallId: tc.id,
            result: "New caller · no prior record on file.",
          };
        }
        let name: string | null = null;
        for (const m of memories) {
          try {
            const data = JSON.parse(m.content) as { name?: string };
            if (data.name && !name) name = data.name;
          } catch {
            // skip non-JSON
          }
        }
        log.info("customer_found_local_fallback", {
          phoneTail: phoneNorm.slice(-4),
          recordCount: memories.length,
          bridgeReason: bridge.ok ? "not_found" : bridge.reason,
        });
        return {
          toolCallId: tc.id,
          result: name
            ? `Returning customer · ${name} · ${memories.length} prior interaction${memories.length > 1 ? "s" : ""} (local cache · admin offline).`
            : `Returning caller · ${memories.length} prior interaction${memories.length > 1 ? "s" : ""} (local cache · admin offline).`,
        };
      } catch (err) {
        log.error("customer_lookup_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          toolCallId: tc.id,
          result: "Lookup failed · proceeding as a new caller.",
        };
      }
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
        metadata: { source: "vapi:lookup-customer", toolCalls: calls.length },
      });
    } catch {
      // intentionally swallow
    }
  }

  return NextResponse.json({ results });
}
