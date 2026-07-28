/**
 * ALG Probe Budget — demand-driven probe scheduler.
 *
 * THE PROBLEM:
 * Probing ALG/ShopDriver requires our server to authenticate against the
 * same login Moe uses at the shop counter. Every probe kicks Moe out.
 * The previous cron-driven model (every 5 min when admin tab is open)
 * meant Moe got kicked every 5 minutes during normal admin work.
 *
 * THE SOLUTION:
 * Probes only fire when there's an explicit demand:
 *   1. admin_login    — Nour just logged into /admin
 *   2. chat_query     — Nick chat asks "what's our revenue today?"
 *   3. manual_refresh — Admin clicks "Refresh from ALG" button
 *   4. overnight      — Single 3 AM ET probe (shop closed, no Moe risk)
 *   5. health_check   — Stale-data detector (DB-only, no probe — see runIfStale)
 *
 * Every probe is tracked in `alg_probe_log` so admin can see when/why
 * the last probe fired + outcome.
 *
 * 30-second dedup: 5 simultaneous chat queries = 1 probe.
 *
 * USAGE:
 *   import { requestAlgProbe } from "./algProbeBudget";
 *   await requestAlgProbe("chat_query", { detail: "session-abc-123" });
 */

import { createLogger } from "../lib/logger";
import { db } from "../lib/db-helper";

const log = createLogger("alg-probe-budget");

// ─── DEDUP STATE ────────────────────────────────────────
// Track last probe timestamp + an in-flight promise for coalescing.
let lastProbeStartedAt = 0;
let lastProbeFinishedAt = 0;
let inFlightProbe: Promise<ProbeResult> | null = null;
const DEDUP_WINDOW_MS = 30_000; // 30 sec — coalesce burst requests
const RECENT_SUCCESS_TTL_MS = 5 * 60_000; // skip if last success < 5 min ago

export type ProbeReason =
  | "admin_login"
  | "chat_query"
  | "manual_refresh"
  | "overnight"
  | "evening"
  | "health_check";

export type ProbeOutcome =
  | "success"
  | "auth_failed"
  | "empty"
  | "dedup"
  | "skipped_recent"
  | "error";

export interface ProbeResult {
  outcome: ProbeOutcome;
  recordsProcessed: number;
  durationMs: number;
  reason: ProbeReason;
  detail?: string;
  errorMessage?: string;
  alreadyFresh?: boolean;
}

interface ProbeOptions {
  /** Sub-detail for the log row (chat session id, admin user, etc) */
  detail?: string;
  /** Force the probe even if a recent one succeeded. Default: false. */
  force?: boolean;
  /** Run estimate sync too. Default: true. */
  includeEstimates?: boolean;
}

/**
 * Request an ALG probe. Returns the probe result.
 *
 * Behavior:
 *   - If a probe completed successfully in the last 5 min and `force` is
 *     not set, returns `skipped_recent` immediately. Caller's data is
 *     already fresh, no need to kick Moe.
 *   - If a probe is currently in-flight, waits for it (coalesces).
 *   - Otherwise: starts a probe, runs full mirror + estimate sync,
 *     writes to alg_probe_log.
 */
export async function requestAlgProbe(
  reason: ProbeReason,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const now = Date.now();

  // Recent success? Skip — caller's data is already fresh.
  if (!options.force && now - lastProbeFinishedAt < RECENT_SUCCESS_TTL_MS) {
    const ageSec = Math.round((now - lastProbeFinishedAt) / 1000);
    log.info(`Probe skipped (fresh data, ${ageSec}s old)`, { reason });
    await writeProbeLog({
      reason,
      detail: options.detail,
      outcome: "skipped_recent",
      recordsProcessed: 0,
      durationMs: 0,
    });
    return {
      outcome: "skipped_recent",
      recordsProcessed: 0,
      durationMs: 0,
      reason,
      detail: options.detail,
      alreadyFresh: true,
    };
  }

  // In-flight probe? Coalesce — multiple simultaneous chat queries shouldn't
  // each fire their own probe. They all wait for the same result.
  if (inFlightProbe) {
    log.info(`Probe coalesced into in-flight probe`, { reason });
    await writeProbeLog({
      reason,
      detail: options.detail,
      outcome: "dedup",
      recordsProcessed: 0,
      durationMs: 0,
    });
    return inFlightProbe;
  }

  // Dedup window — even if no in-flight, suppress probes within 30s of
  // last start. Catches retry storms.
  if (!options.force && now - lastProbeStartedAt < DEDUP_WINDOW_MS) {
    log.info(`Probe deduped (within 30s of last)`, { reason });
    await writeProbeLog({
      reason,
      detail: options.detail,
      outcome: "dedup",
      recordsProcessed: 0,
      durationMs: 0,
    });
    return {
      outcome: "dedup",
      recordsProcessed: 0,
      durationMs: 0,
      reason,
      detail: options.detail,
    };
  }

  // Start a fresh probe.
  lastProbeStartedAt = now;
  inFlightProbe = runProbe(reason, options);
  try {
    return await inFlightProbe;
  } finally {
    inFlightProbe = null;
  }
}

async function runProbe(reason: ProbeReason, options: ProbeOptions): Promise<ProbeResult> {
  const start = Date.now();
  log.info(`Starting ALG probe`, { reason, detail: options.detail });

  try {
    // Run full mirror first (customers + invoices)
    const { runFullMirror } = await import("./shopDriverMirror");
    const mirrorResult = await runFullMirror();

    // Run estimate sync if not explicitly disabled
    let estimateResult: { recordsProcessed: number; details: string } | null = null;
    if (options.includeEstimates !== false) {
      try {
        const { runEstimateMirror } = await import("./shopDriverEstimateSync");
        estimateResult = await runEstimateMirror();
      } catch (err) {
        log.warn("Estimate sync failed during probe (non-fatal)", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const durationMs = Date.now() - start;
    const totalRecords = mirrorResult.recordsProcessed + (estimateResult?.recordsProcessed || 0);

    // Auth failure detection
    const authFailed = mirrorResult.details.includes("Auth failed") || mirrorResult.details.includes("auth_failed");
    const empty = totalRecords === 0 && !authFailed;

    let outcome: ProbeOutcome = "success";
    if (authFailed) outcome = "auth_failed";
    else if (empty) outcome = "empty";

    // Mark fresh on success
    if (outcome === "success") {
      lastProbeFinishedAt = Date.now();
    }

    await writeProbeLog({
      reason,
      detail: options.detail,
      outcome,
      recordsProcessed: totalRecords,
      durationMs,
      errorMessage: outcome !== "success" ? mirrorResult.details : undefined,
    });

    log.info(`Probe complete: ${outcome}`, { reason, totalRecords, durationMs });

    return {
      outcome,
      recordsProcessed: totalRecords,
      durationMs,
      reason,
      detail: options.detail,
      errorMessage: outcome !== "success" ? mirrorResult.details : undefined,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error(`Probe failed: ${errorMessage}`, { reason });

    await writeProbeLog({
      reason,
      detail: options.detail,
      outcome: "error",
      recordsProcessed: 0,
      durationMs,
      errorMessage: errorMessage.slice(0, 500),
    });

    return {
      outcome: "error",
      recordsProcessed: 0,
      durationMs,
      reason,
      detail: options.detail,
      errorMessage,
    };
  }
}

/**
 * Write a row to alg_probe_log. Fire-and-forget — failure to log
 * shouldn't break the probe itself.
 */
async function writeProbeLog(params: {
  reason: ProbeReason;
  detail?: string;
  outcome: ProbeOutcome;
  recordsProcessed: number;
  durationMs: number;
  errorMessage?: string;
}): Promise<void> {
  try {
    const d = await db();
    if (!d) return;
    const { algProbeLog } = await import("../../drizzle/schema");
    await d.insert(algProbeLog).values({
      reason: params.reason,
      detail: params.detail || null,
      outcome: params.outcome,
      recordsProcessed: params.recordsProcessed,
      durationMs: params.durationMs,
      errorMessage: params.errorMessage || null,
      completedAt: new Date(),
    });
  } catch (err) {
    log.warn("alg_probe_log insert failed (non-critical)", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Read the last N probes for admin dashboard display.
 */
export async function getRecentProbes(limit = 20): Promise<Array<{
  id: number;
  reason: string;
  detail: string | null;
  outcome: string;
  recordsProcessed: number;
  durationMs: number;
  errorMessage: string | null;
  startedAt: Date;
}>> {
  try {
    const d = await db();
    if (!d) return [];
    const { algProbeLog } = await import("../../drizzle/schema");
    const { desc } = await import("drizzle-orm");
    const rows = await d
      .select({
        id: algProbeLog.id,
        reason: algProbeLog.reason,
        detail: algProbeLog.detail,
        outcome: algProbeLog.outcome,
        recordsProcessed: algProbeLog.recordsProcessed,
        durationMs: algProbeLog.durationMs,
        errorMessage: algProbeLog.errorMessage,
        startedAt: algProbeLog.startedAt,
      })
      .from(algProbeLog)
      .orderBy(desc(algProbeLog.startedAt))
      .limit(limit);
    return rows;
  } catch (err) {
    log.warn("getRecentProbes failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * In-memory probe state for status endpoints.
 */
export function getProbeBudgetState() {
  const now = Date.now();
  return {
    lastProbeStartedAt: lastProbeStartedAt > 0 ? new Date(lastProbeStartedAt).toISOString() : null,
    lastProbeFinishedAt: lastProbeFinishedAt > 0 ? new Date(lastProbeFinishedAt).toISOString() : null,
    inFlight: inFlightProbe !== null,
    secondsSinceLastFinish: lastProbeFinishedAt > 0 ? Math.round((now - lastProbeFinishedAt) / 1000) : null,
    dedupWindowMs: DEDUP_WINDOW_MS,
    freshnessTTLMs: RECENT_SUCCESS_TTL_MS,
  };
}
