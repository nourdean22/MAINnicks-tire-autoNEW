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
import { and, gte, eq, inArray, sql } from "drizzle-orm";
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
  // wave-181.15 · silent-failure audit Finding #3: was returning
  // { recordsProcessed: 0, details: "..." } from all three failure
  // paths (no api key / 4xx-5xx / fetch error). Same class as the
  // wave-181.3 warrantyAlerts.ts fix — the cron runner treated the
  // return as success and wrote cron_log row as status='completed'.
  // Now: throw from every failure path so runJob marks 'failed'.
  const apiKey = (process.env.VAPI_API_KEY || "").trim();
  if (!apiKey) {
    log.error("vapi_api_key_missing", { errorId: "VAPI_LATENCY_SYNC_NO_KEY" });
    throw new Error("VAPI_API_KEY unset");
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
      log.error("vapi_call_list_failed", { status: r.status, errorId: "VAPI_LATENCY_SYNC_HTTP_ERROR" });
      throw new Error(`VAPI /call returned ${r.status}`);
    }
    // wave-181.16 code-review F5 · explicit DESC sort so the iteration
    // order is deterministic regardless of VAPI's default response order.
    // Dedup is by callId so order doesn't change correctness, but it
    // makes the cron log predictable + future-proofs against upstream
    // sort changes.
    calls = ((await r.json()) as VapiCallApi[])
      .filter((c) => c.createdAt)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  } catch (err) {
    log.error("vapi_call_fetch_error", {
      errorId: "VAPI_LATENCY_SYNC_FETCH_THREW",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
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
    // wave-181.69 (chip #3) · DB-backed dedup via cron_alerts_fired table.
    // Pre-fix: `lastAlertDate` module-level variable re-fired today's
    // alert after any pod restart, and multi-pod (Railway N>1) sent one
    // copy per pod. Now: atomic INSERT IGNORE on (alert_key, fired_for)
    // PK · affectedRows=1 means we won the claim, fire the alert ·
    // affectedRows=0 means another pod (or earlier on this pod) already
    // claimed today's slot, skip silently. The `lastAlertDate` variable
    // is kept as a process-local fast-path to skip the DB roundtrip
    // entirely once we know we fired today on this pod.
    const todayIso = new Date().toISOString().slice(0, 10);
    if (lastAlertDate !== todayIso) {
      let claimed = false;
      try {
        const d = await getDb();
        if (d) {
          const [claimResult] = await d.execute(sql`
            INSERT IGNORE INTO cron_alerts_fired (alert_key, fired_for, fired_at, payload)
            VALUES ('vapi_latency_breach', CURDATE(), NOW(), ${JSON.stringify({ streak: breach.streak })})
          `);
          const affected = (claimResult as { affectedRows?: number })?.affectedRows ?? 0;
          claimed = affected === 1;
          if (!claimed) {
            // Peer-pod (or earlier on this pod) already fired today —
            // still update the local fast-path so we skip the DB
            // roundtrip on subsequent ticks today.
            lastAlertDate = todayIso;
          }
        } else {
          // DB unreachable · fall through to in-memory dedup so we
          // don't spam, but accept the risk of a duplicate alert if
          // the DB comes back online later.
          claimed = true;
        }
      } catch (err) {
        log.warn("vapi_alert_dedup_failed_using_inmem_fallback", {
          errorId: "VAPI_ALERT_DEDUP_QUERY_ERROR",
          error: err instanceof Error ? err.message : String(err),
        });
        claimed = true;
      }

      if (claimed) {
        try {
          const { sendTelegramMessage } = await import("../../services/telegram");
          // 2026-07-09 · the streak now measures llm_first_token (see
          // getCurrentBreachStreak) — report that stage, not call duration.
          const ftok = stages.find((s) => s.stage === "llm_first_token");
          const lines = [
            "🔴 <b>Voice latency · breach streak</b>",
            "",
            `Consecutive call-days with first-token p50 over ${VOICE_LATENCY_TARGET_MS}ms · ${breach.streak}`,
            ftok
              ? `7d llm_first_token · p50 ${ftok.p50}ms · p95 ${ftok.p95}ms · ${ftok.count} samples`
              : "7d llm_first_token · no data",
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
  }

  return {
    recordsProcessed: writtenCount,
    details: `fetched=${calls.length} written=${writtenCount} skippedExisting=${skippedExisting} skippedUnusable=${skippedUnusable} breachStreak=${breach.streak} alertPushed=${alertPushed}`,
  };
}
