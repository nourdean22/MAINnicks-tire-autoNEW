/**
 * Cron · vapi-latency-sync
 *
 * Migrated to nickstire from statenour-os (v10.0.526 Arc A F3) per the
 * business-separation directive — VAPI is shop infrastructure, belongs
 * on nickstire.
 *
 * Nightly sync · pulls the last 24h of VAPI calls via the same REST
 * pattern as /api/admin/vapi-calls. Derives end-to-end latency for
 * each call that didn't write fine-grained events at runtime · writes
 * voice_latency_events rows (deduped by (callId, stage="end_to_end"))
 * so retries are idempotent.
 *
 * Then checks the breach streak · if ≥ threshold (default 3) AND
 * today's Telegram alert hasn't fired, push it.
 */

import { getDb } from "../../db";
import { voiceLatencyEvents } from "../../../drizzle/schema";
import { and, gte, eq, inArray } from "drizzle-orm";
import { createLogger } from "../../lib/logger";
import {
  captureVoiceLatency,
  getCurrentBreachStreak,
  getEndToEndFromVapiCall,
  getP50P95ByStage,
  type VapiCallLike,
  VOICE_LATENCY_TARGET_MS,
} from "../../services/voice-latency";

const log = createLogger("cron:vapi-latency-sync");

interface VapiCallApi extends VapiCallLike {
  assistantId?: string | null;
  endedReason?: string | null;
}

// Module-level dedup marker for today's alert. The Telegram helper
// itself doesn't dedupe across cron invocations within a process
// lifetime; we keep an in-memory date marker so a hourly re-run
// can't re-fire today's alert. Reset on process restart (which is
// rare enough — cron only runs once daily anyway).
let lastAlertDate: string | null = null;

export async function processVapiLatencySync(): Promise<{ recordsProcessed: number; details?: string }> {
  const apiKey = (process.env.VAPI_API_KEY || "").trim();
  if (!apiKey) {
    log.warn("vapi_api_key_missing");
    return { recordsProcessed: 0, details: "VAPI_API_KEY unset" };
  }

  const since = new Date(Date.now() - 86_400_000); // 24h
  let calls: VapiCallApi[] = [];
  try {
    const r = await fetch(
      `https://api.vapi.ai/call?limit=100&createdAtGt=${encodeURIComponent(since.toISOString())}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!r.ok) {
      log.warn("vapi_call_list_failed", { status: r.status });
      return { recordsProcessed: 0, details: `vapi returned ${r.status}` };
    }
    calls = (await r.json()) as VapiCallApi[];
  } catch (err) {
    log.error("vapi_call_fetch_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { recordsProcessed: 0, details: "vapi_fetch_failed" };
  }

  // Pull existing end_to_end rows for dedup
  let existingIds = new Set<string>();
  try {
    const d = await getDb();
    if (d) {
      const callIds = calls.map((c) => c.id).filter((id): id is string => !!id);
      if (callIds.length > 0) {
        const existing = await d
          .select({ callId: voiceLatencyEvents.callId })
          .from(voiceLatencyEvents)
          .where(and(
            eq(voiceLatencyEvents.stage, "end_to_end"),
            inArray(voiceLatencyEvents.callId, callIds),
            gte(voiceLatencyEvents.createdAt, since),
          ));
        existingIds = new Set(existing.map((e: { callId: string }) => e.callId));
      }
    }
  } catch (err) {
    // Table may not have migration applied yet. Degrade gracefully.
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

  // Breach streak + Telegram alert
  const breach = await getCurrentBreachStreak();
  const stages = await getP50P95ByStage(7);

  let alertPushed = false;
  if (breach.alertReady) {
    const todayIso = new Date().toISOString().slice(0, 10);
    if (lastAlertDate !== todayIso) {
      try {
        const { sendTelegramMessage } = await import("../../services/telegram");
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
          "Source · /api/admin/voice-latency",
        ];
        const sent = await sendTelegramMessage(lines.join("\n"), "critical");
        alertPushed = sent;
        lastAlertDate = todayIso;
      } catch (err) {
        log.warn("telegram_send_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return {
    recordsProcessed: writtenCount,
    details: `fetched=${calls.length} written=${writtenCount} skippedExisting=${skippedExisting} skippedUnusable=${skippedUnusable} breachStreak=${breach.streak} alertPushed=${alertPushed}`,
  };
}
