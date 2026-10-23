/**
 * Per-call tRPC telemetry (2026-10-23, usage telemetry; aggregated after the pre-PR review). Calls are
 * counted IN MEMORY per (procedure, type, ok, code) and ONE createMany per minute per process writes the
 * buckets to system_metrics: metric "trpc.call", value = total ms of the bucket, source "trpc",
 * tags { procedure, type, ok, code?, count, max_ms }. A row's created_at is the flush time, so it covers
 * the minute before it. Reader: Appendix E query 3 in
 * docs/research/2026-10-23-brain-usage-map-appendix-e.md (calls, errors, mean and max ms by procedure).
 *
 * Why aggregated: the app polls tRPC every 5 s from two pages (system/actions, system/inbox), so one
 * insert per call is up to 17,280 rows a day per poller against a table that receives about 460 rows a
 * day in all (prod read 2026-10-23, 30 metrics), and every insert queues on the 10-slot Prisma pool
 * (lib/prisma.ts) beside the user's own queries. A bucket costs one row per minute while a procedure is
 * being called, and nothing while it is not.
 *
 * Why system_metrics and not api_request_logs: that table is read as "REST traffic" by the system
 * performance panel, the morning digest's slow-route count, the requests-24h tile and the logs feed, and
 * apiHandler samples its successes at 10%. system_metrics is mostly read by metric name, with two
 * readers that are not: the unified logs feed (lib/services/system-pages-b.ts buildSystemLogs, which
 * excludes TRPC_CALL_METRIC) and a whole-table census count that counts every row on purpose.
 * Retention: 90 days (data-cleanup).
 *
 * Failure: a flush that fails is reported once (ErrorLog, source "trpc-telemetry", with the procedure
 * names) and its buckets are DROPPED, never retried or kept, so memory is bounded by the number of
 * procedures x types x outcomes. Exit: a SIGTERM drain flushes the open buckets (the Railway redeploy
 * path), then restores default termination when nothing else handles the signal.
 *
 * Privacy: the tags are the procedure path, the call type, ok, the tRPC error code, a count and a
 * max duration. Never the input, the output, the error message, a header or a URL.
 */
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

export const TRPC_CALL_METRIC = "trpc.call";

export const FLUSH_INTERVAL_MS = 60_000;

interface Bucket {
  procedure: string;
  type: string;
  ok: boolean;
  code?: string;
  count: number;
  totalMs: number;
  maxMs: number;
}

export interface TrpcCall {
  procedure: string;
  type: string;
  ok: boolean;
  /** tRPC error code, set when ok is false. */
  code?: string;
  ms: number;
}

let buckets = new Map<string, Bucket>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** One registration per process, even when the module is evaluated twice (dev reload, tests). */
const SIGTERM_KEY = Symbol.for("statenour.trpcTelemetry.sigterm");

function hookSigterm(): void {
  const g = globalThis as Record<symbol, unknown>;
  if (g[SIGTERM_KEY]) return;
  g[SIGTERM_KEY] = true;
  process.once("SIGTERM", () => {
    // Adding a SIGTERM listener switches off Node's default exit. If nobody else handles the signal,
    // put the default back once the buckets are out.
    void flushTrpcTelemetry().finally(() => {
      if (process.listenerCount("SIGTERM") === 0) process.kill(process.pid, "SIGTERM");
    });
  });
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => void flushTrpcTelemetry(), FLUSH_INTERVAL_MS);
  timer.unref?.();
}

/**
 * Count one call. In memory only: never awaited, never throws, never touches the database on the
 * caller's path.
 */
export function recordTrpcCall(call: TrpcCall): void {
  try {
    const ms = Number.isFinite(call.ms) && call.ms >= 0 ? call.ms : 0;
    const key = [call.procedure, call.type, call.ok, call.code ?? ""].join("\u0000");
    let b = buckets.get(key);
    if (!b) {
      b = { procedure: call.procedure, type: call.type, ok: call.ok, code: call.code, count: 0, totalMs: 0, maxMs: 0 };
      buckets.set(key, b);
    }
    b.count += 1;
    b.totalMs += ms;
    b.maxMs = Math.max(b.maxMs, ms);
    schedule();
    hookSigterm();
  } catch {
    // telemetry is best-effort
  }
}

/**
 * Write the open buckets as one createMany and start fresh. The buckets are taken BEFORE the write, so a
 * failed or hung write loses only what it held and later calls fill new buckets. Never rejects.
 */
export async function flushTrpcTelemetry(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (buckets.size === 0) return;
  const taken = [...buckets.values()];
  buckets = new Map();
  try {
    await prisma.systemMetric.createMany({
      data: taken.map((b) => ({
        metric: TRPC_CALL_METRIC,
        value: b.totalMs,
        unit: "ms",
        source: "trpc",
        tags: {
          procedure: b.procedure,
          type: b.type,
          ok: b.ok,
          ...(b.code ? { code: b.code } : {}),
          count: b.count,
          max_ms: b.maxMs,
        },
      })),
    });
  } catch (e) {
    try {
      logError("trpc-telemetry", e, { buckets: taken.length, procedures: [...new Set(taken.map((b) => b.procedure))].slice(0, 5) }, "warn");
    } catch {
      // reporting is best-effort too
    }
  }
}
