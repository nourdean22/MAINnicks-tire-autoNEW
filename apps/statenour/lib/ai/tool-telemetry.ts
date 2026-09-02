/**
 * TOOL TELEMETRY — Apr 19.
 *
 * Nick has 149+ tools and the semantic tool pruner decides which to
 * ship to the model each turn. But we have NO feedback on which tools
 * are pulling weight. A tool that errors 40% of the time wastes context
 * budget AND produces bad downstream reasoning. A tool nobody calls
 * wastes embedding time.
 *
 * This module provides:
 *   1. `recordToolInvocation` — call once per tool call (success/fail +
 *      duration). UPSERTs the canonical `tool_telemetry` typed table.
 *   2. `getToolStats` — reads aggregate stats for the dashboard +
 *      problem-tools pruning heuristic.
 *
 * The chat route's onFinish walks the tool-call events emitted by
 * streamText and fires recordToolInvocation for each one. Fire-and-
 * forget, 3s cap.
 *
 * v10.0.529.106 · Wave 53 · Phase 3 cutover · the BrainMemory
 * `tool_telemetry` dual-write that ran from v10.0.194 (when the typed
 * table was added) until now has been deleted. ~70 lines of legacy
 * JSON-blob UPSERT removed · all writes now go to the typed table
 * (which has been stable in prod since May 5, 2026). Legacy rows
 * stay in BrainMemory until the category-ttl cron prunes them
 * (deprecated category TTL set to 7d in lib/brain/category-ttl.ts).
 */

import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

export interface ToolInvocation {
  toolName: string;
  success: boolean;
  durationMs: number;
  /** Short error string when success=false. */
  errorMessage?: string;
  /** Optional conversation id for cross-reference. */
  conversationId?: string;
}

/**
 * Record a single tool invocation. Merges into an aggregate row per
 * tool (one row per tool, updated per call) so we can query recent
 * success rates without scanning a massive history.
 *
 * Graceful: never throws. Caller should fire-and-forget.
 */
export async function recordToolInvocation(inv: ToolInvocation): Promise<void> {
  try {
    const successDelta = inv.success ? 1 : 0;
    const failDelta = inv.success ? 0 : 1;
    const errorMessage = !inv.success && inv.errorMessage
      ? inv.errorMessage.slice(0, 200)
      : null;

    // v10.0.194 → v10.0.529.106 Wave 53 · canonical typed write.
    //
    // Same atomic-merge contract: ON CONFLICT increments counters,
    // appends the latest error to lastErrors[] (capped at 5),
    // recomputes failure_rate_pct on every write so the dashboard
    // sort doesn't need a derived view. Failures here are silent
    // (caught in the outer try/catch).
    const errPayload = errorMessage
      ? JSON.stringify([{ message: errorMessage, at: Date.now() }])
      : "[]";
    await prisma.$executeRaw`
      INSERT INTO tool_telemetry (
        id, tool_name, total_calls, success_count, fail_count,
        total_duration_ms, last_errors, last_call_at,
        failure_rate_pct, created_at, updated_at
      )
      VALUES (
        gen_random_uuid()::text,
        ${inv.toolName},
        1,
        ${successDelta}::int,
        ${failDelta}::int,
        ${inv.durationMs}::bigint,
        ${errPayload}::jsonb,
        NOW(),
        ${inv.success ? 0 : 100}::float,
        NOW(),
        NOW()
      )
      ON CONFLICT (tool_name) DO UPDATE SET
        total_calls = tool_telemetry.total_calls + 1,
        success_count = tool_telemetry.success_count + ${successDelta}::int,
        fail_count = tool_telemetry.fail_count + ${failDelta}::int,
        total_duration_ms = tool_telemetry.total_duration_ms + ${inv.durationMs}::bigint,
        last_errors = CASE
          WHEN ${errorMessage}::text IS NULL THEN tool_telemetry.last_errors
          ELSE (
            -- Append new error then keep last 5
            SELECT jsonb_agg(elem)
            FROM (
              SELECT elem
              FROM jsonb_array_elements(
                tool_telemetry.last_errors ||
                jsonb_build_array(jsonb_build_object('message', ${errorMessage}::text, 'at', extract(epoch from now()) * 1000))
              ) AS elem
              ORDER BY (elem->>'at')::float DESC
              LIMIT 5
            ) sub
          )
        END,
        last_call_at = NOW(),
        failure_rate_pct = CASE
          WHEN (tool_telemetry.total_calls + 1) >= 10
          THEN ((tool_telemetry.fail_count + ${failDelta}::int)::float
                / (tool_telemetry.total_calls + 1)::float) * 100
          ELSE NULL
        END,
        updated_at = NOW()
    `;

    // Update circuit breaker state — block tools that misbehave
    // before they cost more turns. See block at bottom of file for
    // the breaker semantics.
    if (inv.success) recordToolSuccess(inv.toolName);
    else recordToolFailure(inv.toolName);
  } catch (err) {
    // Telemetry failures must never break chat. Swallow silently; the
    // next invocation will attempt again.
    logError("ai.tool-telemetry", err, { fn: "recordToolInvocation" });
    console.warn(
      "[tool-telemetry] record failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

export interface ToolStat {
  toolName: string;
  totalCalls: number;
  successRate: number;        // 0-1
  avgDurationMs: number;
  failCount: number;
  lastCallAt?: number;
  lastErrors: Array<{ message: string; at: number }>;
}

/**
 * Fetch aggregate stats for all tools. Sorted by totalCalls descending
 * by default. Used by the brain dashboard + the future low-success
 * tool pruning hint.
 *
 * v10.0.529.106 · Wave 53 · reads the canonical ToolTelemetry typed
 * table directly · pre-Wave-53 this was a BrainMemory JSON-blob read
 * which required client-side parsing of metadata fields. Typed reads
 * are ~10x faster (no JSON parse, indexed sort key, BigInt converted
 * once here for the Number-API consumers).
 *
 * ── THROWS on a read failure (2026-09-02) ──
 * This used to `logError(...)` and `return []`. Every consumer is a
 * DASHBOARD, and every one of them then rebuilt its rows from
 * TOOL_CATALOG, so a dead database rendered all 185 tools GREEN with
 * `totalCalls: 0, successRate: 0` and an empty problem list — the exact
 * "confident zero" shape as brain-maturity's phantom 7. The tRPC
 * procedure at lib/trpc/routers/brain.ts:1060-1064 physically COULD NOT
 * error, so ToolTelemetryPanel had nothing to branch on.
 *
 * Letting it throw is the fix: React Query surfaces `isError`, the panel
 * says "unknown, not empty", and /api/brain/tools 500s instead of
 * serving a fabricated all-clear. The one caller that genuinely wants
 * degrade-to-empty (lib/services/system-pages-b.ts:303) already writes
 * its own `.catch(() => [])` at the call site — which is the difference
 * that matters: an opt-out you can read, not one hidden in the callee.
 * The error is still logged here so the trail survives whatever the
 * caller does with it.
 */
export async function getToolStats(limit = 50): Promise<ToolStat[]> {
  const rows = await prisma.toolTelemetry
    .findMany({
      orderBy: { totalCalls: "desc" },
      take: limit,
      select: {
        toolName: true,
        totalCalls: true,
        successCount: true,
        failCount: true,
        totalDurationMs: true,
        lastErrors: true,
        lastCallAt: true,
      },
    })
    .catch((err: unknown): never => {
      logError("ai.tool-telemetry", err, { fn: "getToolStats.findMany" });
      throw err;
    });

  return rows.map((row) => {
    // totalDurationMs is BigInt — convert once to Number for the
    // arithmetic. Safe because Number's 2^53 ceiling represents
    // ~285 thousand years of ms · we'll cap out elsewhere first.
    const durationMs = Number(row.totalDurationMs);
    const avgDurationMs =
      row.totalCalls > 0 ? Math.round(durationMs / row.totalCalls) : 0;
    const errors = (row.lastErrors as Array<{ message: string; at: number }> | null) ?? [];
    return {
      toolName: row.toolName,
      totalCalls: row.totalCalls,
      successRate: row.totalCalls > 0 ? row.successCount / row.totalCalls : 0,
      avgDurationMs,
      failCount: row.failCount,
      lastCallAt: row.lastCallAt ? row.lastCallAt.getTime() : undefined,
      lastErrors: errors,
    };
  });
}

/** A tool with ≥ this many lifetime calls is eligible for the rate lane. */
const LIFETIME_MIN_CALLS = 10;
/** Lifetime success rate below this trips the lane. */
const LIFETIME_RATE_FLOOR = 0.5;

/**
 * Tools currently worth an alarm. TWO lanes, because one of them cannot
 * fire for the tools whose failure costs most.
 *
 * ── LANE 1 · lifetime rate (the old, structurally-dead one) ──
 * `totalCalls >= 10 && successRate < 0.5` over the counters at :87-89,
 * which ONLY ever increment — no window, no decay, and no reset path
 * anywhere in this repo. Do the arithmetic: a tool with 1,000 lifetime
 * calls at a 95% historical rate needs more than 500 CONSECUTIVE failures
 * before its lifetime rate crosses 0.5. It is 100% broken today and this
 * lane stays silent for days. The lane is kept because it is the right
 * signal for a young tool that has never worked; it is not, and never
 * was, a signal about now.
 *
 * ── LANE 2 · the circuit breaker (recent behaviour) ──
 * The breaker below already measures exactly what lane 1 cannot: 5
 * failures inside a 10-minute rolling window, with `recordToolSuccess`
 * clearing the window on any success. Its state was tripped on every real
 * outage and surfaced NOWHERE on /brain. Unioning it in makes the alarm
 * fire on today's behaviour with zero new persistence and zero new
 * thresholds to tune — the repo already chose these.
 *
 * KNOWN LIMIT of lane 2: `breakerState` is an in-process Map, so it is
 * empty for the first 10 minutes after a deploy or restart, and a tool
 * that broke before the restart shows clean until it fails 5 more times.
 * Lane 1 is the (slow) durable backstop for that. A persisted recent-
 * failure window would close it properly; that is a schema change, and
 * deliberately not made here.
 */
export async function getProblemTools(): Promise<string[]> {
  const stats = await getToolStats(100);
  const lifetime = stats
    .filter(
      (s) =>
        s.totalCalls >= LIFETIME_MIN_CALLS &&
        s.successRate < LIFETIME_RATE_FLOOR,
    )
    .map((s) => s.toolName);
  const acute = getBlockedTools().map((b) => b.toolName);
  // Acute first — a tool that is broken RIGHT NOW is the one to look at.
  return [...new Set([...acute, ...lifetime])];
}

// ═══════════════════════════════════════════════════════════════
// CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════
// Tools that fail ≥ 5 times within a 10-minute rolling window get
// removed from the toolset for COOLDOWN_MS. This prevents:
//   1. Repeated failed tool calls eating context budget every turn
//   2. Cascading slow turns when a tool is genuinely broken
//   3. Cost waste on retries against dead tools
//
// Listing is in-memory (per-lambda) — fine for serverless because a
// dead tool typically affects ALL parallel instances simultaneously
// (e.g. 3rd-party API down). Each lambda will trip the breaker on
// its own. Reset is automatic when COOLDOWN_MS elapses.

const FAIL_THRESHOLD = 5;
const FAIL_WINDOW_MS = 10 * 60_000; // 10 min
const COOLDOWN_MS = 30 * 60_000; // 30 min

interface BreakerEntry {
  /** Recent failure timestamps, trimmed to FAIL_WINDOW_MS. */
  failures: number[];
  /** When the breaker tripped open. Tool blocked until at + COOLDOWN_MS. */
  trippedAt?: number;
}

const breakerState = new Map<string, BreakerEntry>();

/**
 * Record a tool failure. Returns true if this failure tripped the
 * breaker (caller may want to log a louder warning).
 */
export function recordToolFailure(toolName: string): boolean {
  const now = Date.now();
  const cutoff = now - FAIL_WINDOW_MS;
  const entry = breakerState.get(toolName) ?? { failures: [] };
  entry.failures = entry.failures.filter((t) => t >= cutoff);
  entry.failures.push(now);
  if (entry.failures.length >= FAIL_THRESHOLD && !entry.trippedAt) {
    entry.trippedAt = now;
    breakerState.set(toolName, entry);
    console.warn(
      `[tool-breaker] OPEN: ${toolName} — ${FAIL_THRESHOLD}+ failures in ${FAIL_WINDOW_MS / 60_000}min. Blocking for ${COOLDOWN_MS / 60_000}min.`,
    );
    return true;
  }
  breakerState.set(toolName, entry);
  return false;
}

/** Record a successful call. Resets the failure window. */
export function recordToolSuccess(toolName: string): void {
  const entry = breakerState.get(toolName);
  if (!entry) return;
  // Don't auto-reset trippedAt — the cooldown stands. But a success
  // does clear the failure count to prevent immediate retrip after
  // half-cooldown semi-recovery scenarios.
  entry.failures = [];
  breakerState.set(toolName, entry);
}

/**
 * Check whether a tool is currently blocked by the breaker. Used by
 * the tool selector to filter blocked tools out of the per-turn set.
 */
export function isToolBlocked(toolName: string): boolean {
  const entry = breakerState.get(toolName);
  if (!entry?.trippedAt) return false;
  const now = Date.now();
  if (now - entry.trippedAt >= COOLDOWN_MS) {
    // Cooldown elapsed — half-open: clear trip + failures, allow retry.
    entry.trippedAt = undefined;
    entry.failures = [];
    breakerState.set(toolName, entry);
    console.info(`[tool-breaker] HALF-OPEN: ${toolName} — cooldown elapsed, allowing retry.`);
    return false;
  }
  return true;
}

/** List currently-blocked tools (for /system/chat-health visibility). */
export function getBlockedTools(): Array<{
  toolName: string;
  trippedAt: number;
  remainingMs: number;
}> {
  const now = Date.now();
  const out: Array<{ toolName: string; trippedAt: number; remainingMs: number }> = [];
  for (const [toolName, entry] of breakerState) {
    if (!entry.trippedAt) continue;
    const remaining = COOLDOWN_MS - (now - entry.trippedAt);
    if (remaining > 0) {
      out.push({ toolName, trippedAt: entry.trippedAt, remainingMs: remaining });
    }
  }
  return out;
}

/** Manual reset — used from /system/chat-health "reset breaker" button. */
export function resetToolBreaker(toolName: string): void {
  breakerState.delete(toolName);
}
