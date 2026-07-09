/**
 * Voice Latency capture + analyzer
 *
 * Migrated to nickstire from statenour-os (v10.0.527 Arc A Feature 3)
 * per the business-separation directive — VAPI is shop infrastructure,
 * belongs on nickstire.
 *
 * The voice-agent loop targets sub-800ms end-to-end (per `voice-agents`
 * skill: STT + LLM + TTS + network round-trips). This service is the
 * measurement instrument:
 *
 *   1. Every VAPI tool-call/webhook captures whichever stage
 *      timestamps it has visibility into (`captureVoiceLatency`).
 *   2. Nightly cron (vapi-latency-sync) pulls the last 24h of
 *      VAPI's REST call list and derives end-to-end latency for
 *      calls that didn't write fine-grained events at runtime.
 *   3. The /api/admin/voice-latency endpoint surfaces P50/P95 per
 *      stage + breach streak for the admin observability tile.
 *
 * FAIL-OPEN · every write swallows DB errors at the call site so an
 * un-applied migration (table from drizzle/0038_*.sql) never breaks a
 * VAPI webhook in production.
 *
 * DOUBLE-COUNT AVOIDANCE · the existing vapi.ts webhook handler
 * already logs tool-call dispatch; this service captures the
 * end-to-end timing legs that aren't visible at the tRPC procedure
 * level (STT/TTS/network).
 */

import { db } from "../lib/db-helper";
import { voiceLatencyEvents } from "../../drizzle/schema";
import { and, gte, eq, desc } from "drizzle-orm";
import { createLogger } from "../lib/logger";

const log = createLogger("services/voice-latency");

// ── Stage taxonomy ────────────────────────────────────────────────

export type VoiceLatencyStage =
  | "stt_start"
  | "stt_end"
  | "llm_start"
  | "llm_first_token"
  | "tts_start"
  | "tts_first_byte"
  | "end_to_end";

export const VOICE_LATENCY_STAGES: readonly VoiceLatencyStage[] = [
  "stt_start",
  "stt_end",
  "llm_start",
  "llm_first_token",
  "tts_start",
  "tts_first_byte",
  "end_to_end",
] as const;

/** Target latency · sub-800ms is the voice-agents skill ceiling.
 *  Breach is defined relative to p50 (median) over the trailing
 *  window; sub-500ms is the aspirational P50 floor (3 consecutive
 *  call-day breaches trigger the Telegram alert). */
export const VOICE_LATENCY_TARGET_MS = 500;
export const VOICE_LATENCY_BREACH_STREAK_THRESHOLD = 3;

// ── Capture ────────────────────────────────────────────────────────

export interface CaptureVoiceLatencyInput {
  callId: string;
  assistantId: string;
  stage: VoiceLatencyStage;
  latencyMs: number;
  metadata?: Record<string, unknown> | null;
}

/**
 * Write one latency event row. Fails open · DB errors are logged
 * but never thrown · the caller (VAPI webhook) must not break on
 * a missing table or transient outage.
 *
 * Idempotency: callers passing the same (callId, stage) pair will
 * produce multiple rows. Dedup is the cron's responsibility (it
 * already checks for existing rows before inserting derived
 * end_to_end events). Webhook captures don't dedupe · the volume
 * is bounded by VAPI's per-call rate.
 */
// wave-181.17 silent-failure F7 · warn-burst rate-limit state.
// captureVoiceLatency is called ~10-50 times per VAPI call. When a DB
// issue causes per-call failures, the un-throttled log.warn produced
// 50+ identical entries per minute, consuming Sentry alert budget +
// drowning out real signal. Now: one error-aggregate log per minute
// when failure rate exceeds threshold.
const CAPTURE_FAIL_BURST_THRESHOLD = 10;
const CAPTURE_FAIL_BURST_WINDOW_MS = 60_000;
let captureFailureCount = 0;
let captureFailureWindowStart = Date.now();
let captureFailureBurstReported = false;

export async function captureVoiceLatency(
  input: CaptureVoiceLatencyInput,
): Promise<{ ok: boolean }> {
  if (!input.callId || !input.assistantId) return { ok: false };
  if (!Number.isFinite(input.latencyMs) || input.latencyMs < 0) return { ok: false };
  if (!VOICE_LATENCY_STAGES.includes(input.stage)) return { ok: false };

  try {
    const d = await db();
    if (!d) return { ok: false };
    await d.insert(voiceLatencyEvents).values({
      callId: input.callId,
      assistantId: input.assistantId,
      stage: input.stage,
      latencyMs: Math.round(input.latencyMs),
      metadata: (input.metadata ?? null) as never,
    });
    return { ok: true };
  } catch (err) {
    // wave-181.17 · throttle the warn-burst when failures cluster.
    // Window starts on first failure; aggregate one error log when
    // threshold is hit; reset on the next window. Individual failures
    // still increment the counter but don't emit until the burst
    // threshold or window-reset boundary.
    const now = Date.now();
    if (now - captureFailureWindowStart > CAPTURE_FAIL_BURST_WINDOW_MS) {
      captureFailureCount = 0;
      captureFailureWindowStart = now;
      captureFailureBurstReported = false;
    }
    captureFailureCount += 1;

    if (captureFailureCount >= CAPTURE_FAIL_BURST_THRESHOLD && !captureFailureBurstReported) {
      log.error("voice_latency_capture_burst", {
        errorId: "VOICE_LATENCY_CAPTURE_BURST",
        failureCount: captureFailureCount,
        windowMs: CAPTURE_FAIL_BURST_WINDOW_MS,
        latestError: err instanceof Error ? err.message : String(err),
        note: "DB issue suspected. Subsequent failures in this minute will be silenced.",
      });
      captureFailureBurstReported = true;
    } else if (captureFailureCount < CAPTURE_FAIL_BURST_THRESHOLD) {
      // Below threshold = real first-N-of-burst, log normally
      log.warn("capture_failed", {
        callId: input.callId,
        stage: input.stage,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { ok: false };
  }
}

// ── Quantile aggregation ──────────────────────────────────────────

export interface StageStats {
  stage: VoiceLatencyStage;
  count: number;
  p50: number;
  p95: number;
}

/**
 * Compute P50/P95 per stage over the last N days. Uses an in-process
 * sort because the row count per stage per day is bounded (<2k for
 * 24h of VAPI calls).
 *
 * wave-181.17 silent-failure F6 · added LIMIT to guard the 90-day path
 * which could pull 1.26M rows (90d * 7 stages * 2k/day) into Node memory
 * = ~100MB heap balloon. 50k rows = ~4MB and covers ~25 days of typical
 * traffic per stage. Beyond that we truncate (better than OOM) and emit
 * a warning so the operator knows to ship a percentile-pushdown query.
 */
const VOICE_LATENCY_ROW_LIMIT = 50_000;

export async function getP50P95ByStage(days = 7): Promise<StageStats[]> {
  const windowDays = Math.max(1, Math.min(90, Math.round(days)));
  const since = new Date(Date.now() - windowDays * 86_400_000);

  let rows: Array<{ stage: string; latencyMs: number }> = [];
  try {
    const d = await db();
    if (!d) throw new Error("DB unavailable");
    rows = await d
      .select({ stage: voiceLatencyEvents.stage, latencyMs: voiceLatencyEvents.latencyMs })
      .from(voiceLatencyEvents)
      .where(gte(voiceLatencyEvents.createdAt, since))
      .limit(VOICE_LATENCY_ROW_LIMIT);
    if (rows.length === VOICE_LATENCY_ROW_LIMIT) {
      log.warn("p50p95_truncated", {
        errorId: "VOICE_LATENCY_ROW_LIMIT_HIT",
        windowDays,
        limit: VOICE_LATENCY_ROW_LIMIT,
        note: "Push percentile math into MySQL via PERCENTILE_DISC before this becomes a regular event.",
      });
    }
  } catch (err) {
    log.warn("aggregate_failed", { error: err instanceof Error ? err.message : String(err) });
    return VOICE_LATENCY_STAGES.map((stage) => ({ stage, count: 0, p50: 0, p95: 0 }));
  }

  const byStage = new Map<string, number[]>();
  for (const row of rows) {
    const arr = byStage.get(row.stage) ?? [];
    arr.push(row.latencyMs);
    byStage.set(row.stage, arr);
  }

  return VOICE_LATENCY_STAGES.map((stage) => {
    const values = byStage.get(stage) ?? [];
    if (values.length === 0) return { stage, count: 0, p50: 0, p95: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    return {
      stage,
      count: sorted.length,
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
    };
  });
}

/** Nearest-rank quantile · sorted array, q in [0,1]. */
// wave-181.19 · exported for unit testing per test-analyzer Gap 3.
// Nearest-rank quantile (Math.ceil(q*n)-1 index lookup). The p50/p95
// breach-streak detection depends on this being correct.
export function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = Math.ceil(q * sortedAsc.length) - 1;
  const idx = Math.max(0, Math.min(sortedAsc.length - 1, rank));
  return sortedAsc[idx];
}

// ── Breach streak ─────────────────────────────────────────────────

export interface BreachStreak {
  /** Count of consecutive trailing call-days whose end_to_end p50
   *  exceeded VOICE_LATENCY_TARGET_MS. */
  streak: number;
  /** True when streak >= threshold · primary alert trigger. */
  alertReady: boolean;
  /** P50 per day in trailing order (most recent first). Days with
   *  zero calls are skipped. */
  recentP50s: Array<{ date: string; p50: number; count: number }>;
}

/**
 * Walk the trailing 14 call-days backward, computing p50(end_to_end)
 * per day. Returns the streak of consecutive most-recent days that
 * exceeded the target. A day with zero calls breaks the streak (no
 * data ≠ breach).
 *
 * Why call-days instead of consecutive-calls: a single off-hours
 * outlier call shouldn't trigger an alert; we want sustained
 * regression over the operating day.
 */
export async function getCurrentBreachStreak(): Promise<BreachStreak> {
  const days = 14;
  const since = new Date(Date.now() - days * 86_400_000);

  let rows: Array<{ createdAt: Date; latencyMs: number }> = [];
  try {
    const d = await db();
    if (!d) throw new Error("DB unavailable");
    // wave-181.17 silent-failure F6 · same LIMIT guard as
    // getP50P95ByStage. 14-day window, capped for safety.
    //
    // 2026-07-09 metric fix · the streak used to bucket `end_to_end`
    // rows — but those are startedAt→endedAt, i.e. WHOLE-CALL DURATION
    // (live 14d p50 was ~33.6 SECONDS), compared against the 500ms
    // responsiveness target. A phone call can never finish in 500ms,
    // so every call-day breached and the daily 🔴 alert fired forever
    // (a 13-day streak was live when this was caught — pure alarm
    // fatigue). The stage the target actually describes is
    // `llm_first_token` — time until the model starts answering —
    // which was a genuinely healthy ~488ms avg over the same window.
    rows = await d
      .select({ createdAt: voiceLatencyEvents.createdAt, latencyMs: voiceLatencyEvents.latencyMs })
      .from(voiceLatencyEvents)
      .where(and(eq(voiceLatencyEvents.stage, "llm_first_token"), gte(voiceLatencyEvents.createdAt, since)))
      .orderBy(desc(voiceLatencyEvents.createdAt))
      .limit(VOICE_LATENCY_ROW_LIMIT);
  } catch (err) {
    log.warn("breach_streak_failed", { error: err instanceof Error ? err.message : String(err) });
    return { streak: 0, alertReady: false, recentP50s: [] };
  }

  // Bucket by ISO-date string (UTC) — VAPI timestamps are UTC and
  // collisions across day boundaries don't matter at p50 grain.
  const byDate = new Map<string, number[]>();
  for (const row of rows) {
    const date = row.createdAt.toISOString().slice(0, 10);
    const arr = byDate.get(date) ?? [];
    arr.push(row.latencyMs);
    byDate.set(date, arr);
  }

  const ordered: Array<{ date: string; p50: number; count: number }> = [];
  for (const [date, values] of byDate.entries()) {
    const sorted = [...values].sort((a, b) => a - b);
    ordered.push({ date, p50: quantile(sorted, 0.5), count: sorted.length });
  }
  ordered.sort((a, b) => (a.date < b.date ? 1 : -1)); // most-recent first

  let streak = 0;
  for (const day of ordered) {
    if (day.p50 > VOICE_LATENCY_TARGET_MS) streak += 1;
    else break;
  }

  return {
    streak,
    alertReady: streak >= VOICE_LATENCY_BREACH_STREAK_THRESHOLD,
    recentP50s: ordered.slice(0, 7),
  };
}

// ── End-to-end derivation from VAPI call object ───────────────────

/** Subset of the VAPI /call response we actually consume. */
export interface VapiCallLike {
  id?: string;
  assistantId?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  /** Optional per-stage breakdown VAPI returns on some calls. */
  latency?: Partial<Record<string, number>> | null;
}

export interface DerivedEndToEnd {
  callId: string;
  assistantId: string;
  /** Milliseconds from startedAt → endedAt. Falls back to
   *  createdAt when startedAt missing. */
  endToEndMs: number | null;
  /** True when both endpoints were derivable. */
  ok: boolean;
}

/**
 * Derive end-to-end latency from a single VAPI call object. Returns
 * `ok=false` when timestamps are missing · the cron skips those.
 */
export function getEndToEndFromVapiCall(call: VapiCallLike): DerivedEndToEnd {
  const callId = call.id ?? "";
  const assistantId = call.assistantId ?? "unknown";
  if (!callId) return { callId: "", assistantId, endToEndMs: null, ok: false };

  const startIso = call.startedAt ?? call.createdAt ?? null;
  const endIso = call.endedAt ?? null;
  if (!startIso || !endIso) return { callId, assistantId, endToEndMs: null, ok: false };

  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { callId, assistantId, endToEndMs: null, ok: false };
  }
  if (endMs <= startMs) return { callId, assistantId, endToEndMs: null, ok: false };

  return { callId, assistantId, endToEndMs: endMs - startMs, ok: true };
}

// ── Composite snapshot for the admin observability endpoint ─────

export interface VoiceLatencyState {
  windowDays: number;
  target: { ms: number; streakThreshold: number };
  stages: StageStats[];
  breach: BreachStreak;
  /** Recommended delta per stage · positive value = stage is over
   *  target and should shed that many ms. */
  recommendedDeltaMs: Array<{ stage: VoiceLatencyStage; deltaMs: number }>;
}

export async function getVoiceLatencyState(days = 7): Promise<VoiceLatencyState> {
  const [stages, breach] = await Promise.all([
    getP50P95ByStage(days),
    getCurrentBreachStreak(),
  ]);

  const recommendedDeltaMs = stages.map((s) => ({
    stage: s.stage,
    deltaMs: s.count === 0 ? 0 : Math.max(0, s.p50 - VOICE_LATENCY_TARGET_MS),
  }));

  return {
    windowDays: Math.max(1, Math.min(90, Math.round(days))),
    target: { ms: VOICE_LATENCY_TARGET_MS, streakThreshold: VOICE_LATENCY_BREACH_STREAK_THRESHOLD },
    stages,
    breach,
    recommendedDeltaMs,
  };
}
