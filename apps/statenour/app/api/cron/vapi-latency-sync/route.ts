/**
 * GET /api/cron/vapi-latency-sync · v10.0.526 · Arc A Feature 3
 *
 * Nightly sync · pulls the last 24h of VAPI calls via the same REST
 * pattern as /api/system/vapi-calls (DO NOT duplicate that fetch
 * logic in a new client · same VAPI_API_KEY · same shape). Derives
 * end-to-end latency for each call that didn't write fine-grained
 * events at runtime · writes VoiceLatencyEvent rows (deduped by
 * (callId, stage="end_to_end")) so retries are idempotent.
 *
 * Then checks the breach streak · if ≥ threshold (default 3) AND
 * we haven't fired today's Telegram alert, push it.
 *
 * Folded into mega-evening so we keep the Vercel cron budget tight.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { sendTelegram } from "@/lib/services/telegram";
import {
  captureVoiceLatency,
  getCurrentBreachStreak,
  getEndToEndFromVapiCall,
  getP50P95ByStage,
  type VapiCallLike,
  VOICE_LATENCY_TARGET_MS,
} from "@/lib/services/voice-latency";

const log = rootLogger.withSurface("cron/vapi-latency-sync");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

interface VapiCallApi extends VapiCallLike {
  assistantId?: string | null;
  endedReason?: string | null;
}

export const GET = cronHandler(async () => {
  const apiKey = process.env.VAPI_API_KEY?.trim();
  if (!apiKey) {
    log.warn("vapi_api_key_missing");
    return { ok: false, skipped: true, reason: "VAPI_API_KEY unset" };
  }

  const since = new Date(Date.now() - 86_400_000); // 24h
  let calls: VapiCallApi[] = [];
  try {
    const r = await fetch(
      `https://api.vapi.ai/call?limit=100&createdAtGt=${encodeURIComponent(since.toISOString())}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!r.ok) {
      log.warn("vapi_call_list_failed", { status: r.status });
      return { ok: false, status: r.status };
    }
    calls = (await r.json()) as VapiCallApi[];
  } catch (err) {
    log.error("vapi_call_fetch_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "vapi_fetch_failed" };
  }

  // ── Pull existing end_to_end rows for dedup ─────────────────────
  let existingIds = new Set<string>();
  try {
    const existing = await prisma.voiceLatencyEvent.findMany({
      where: {
        stage: "end_to_end",
        createdAt: { gte: since },
      },
      select: { callId: true },
    });
    existingIds = new Set(existing.map((e) => e.callId));
  } catch (err) {
    // Table may be parked · degrade gracefully.
    log.warn("dedup_query_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let writtenCount = 0;
  let skippedExisting = 0;
  let skippedUnusable = 0;

  for (const call of calls) {
    const derived = getEndToEndFromVapiCall(call);
    if (!derived.ok || derived.endToEndMs === null) {
      skippedUnusable += 1;
      continue;
    }
    if (existingIds.has(derived.callId)) {
      skippedExisting += 1;
      continue;
    }
    const result = await captureVoiceLatency({
      callId: derived.callId,
      assistantId: derived.assistantId,
      stage: "end_to_end",
      latencyMs: derived.endToEndMs,
      metadata: {
        source: "cron:vapi-latency-sync",
        endedReason: call.endedReason ?? null,
      },
    });
    if (result.ok) writtenCount += 1;
  }

  // ── Breach streak + Telegram alert ──────────────────────────────
  const breach = await getCurrentBreachStreak();
  const stages = await getP50P95ByStage(7);

  let alertPushed = false;
  if (breach.alertReady) {
    // Idempotent per UTC date · we don't want to spam if the cron
    // retries within the same day. BrainMemory(category=voice_latency_alert)
    // doubles as the dedup marker.
    const todayIso = new Date().toISOString().slice(0, 10);
    let alreadyPushed = false;
    try {
      const existing = await prisma.brainMemory.findFirst({
        where: {
          category: "voice_latency_alert",
          key: todayIso,
        },
        select: { id: true },
      });
      alreadyPushed = existing !== null;
    } catch {
      alreadyPushed = false;
    }

    if (!alreadyPushed) {
      const e2e = stages.find((s) => s.stage === "end_to_end");
      const lines = [
        "🔴 <b>Voice latency · breach streak</b>",
        "",
        `Consecutive call-days over ${VOICE_LATENCY_TARGET_MS}ms · ${breach.streak}`,
        e2e
          ? `7d end_to_end · p50 ${e2e.p50}ms · p95 ${e2e.p95}ms · ${e2e.count} calls`
          : "7d end_to_end · no data",
        "",
        "Recent p50s · " +
          breach.recentP50s
            .slice(0, 5)
            .map((d) => `${d.date.slice(5)} ${d.p50}ms`)
            .join(" · "),
        "",
        "Source · /api/system/voice-latency",
      ];
      try {
        const sent = await sendTelegram(lines.join("\n"), undefined, "HTML");
        alertPushed = sent;
      } catch (err) {
        log.warn("telegram_send_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      // Persist marker regardless of Telegram outcome · the streak
      // is the real signal; Telegram is best-effort.
      try {
        await prisma.brainMemory.create({
          data: {
            category: "voice_latency_alert",
            key: todayIso,
            content: JSON.stringify({
              streak: breach.streak,
              recentP50s: breach.recentP50s,
              endToEnd: e2e ?? null,
            }),
            confidence: 1,
            source: "cron:vapi-latency-sync",
          },
        });
      } catch {
        // marker write best-effort
      }
    }
  }

  return {
    ok: true,
    fetched: calls.length,
    written: writtenCount,
    skippedExisting,
    skippedUnusable,
    breach: {
      streak: breach.streak,
      alertReady: breach.alertReady,
      alertPushed,
    },
    target: VOICE_LATENCY_TARGET_MS,
  };
});
