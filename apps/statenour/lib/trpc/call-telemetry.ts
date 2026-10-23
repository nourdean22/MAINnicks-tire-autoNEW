/**
 * Per-call tRPC telemetry sink (2026-10-23, usage telemetry). One system_metrics row per procedure call:
 * metric "trpc.call", value = duration ms, source "trpc", tags { procedure, type, ok, code?, batch }.
 * Reader: Appendix E query 3 in docs/research/2026-10-23-brain-usage-map-appendix-e.md (procedure,
 * calls, errors, p50 over 14 days) and the next usage map.
 *
 * Why system_metrics and not api_request_logs: that table is read as "REST traffic" by the system
 * performance panel, the morning digest's slow-route count (p95 > 2 s, which every AI procedure would
 * trip), the requests-24h tile and the logs feed, and apiHandler samples its successes at 10%, so
 * unsampled tRPC rows would also skew every ratio there. system_metrics rows are read only by metric
 * name, so a new name changes no existing reader. Retention: 90 days (data-cleanup), longer than the 14
 * days the reads need; volume is UNMEASURED until the first day of rows exists.
 *
 * Privacy: the tags are the procedure path, the call type, ok, the tRPC error code and the batch size.
 * Never the input, the output, the error message, a header or a URL.
 */
import { recordMetricStrict } from "@/lib/services/metrics";
import { logError } from "@/lib/utils/error-log";

export const TRPC_CALL_METRIC = "trpc.call";

/** One failed-write report per process per minute: a dead sink must be visible, not a flood. */
const FAILURE_LOG_INTERVAL_MS = 60_000;
let lastFailureLoggedAt = 0;

function reportWriteFailure(procedure: string, cause: unknown): void {
  const now = Date.now();
  if (now - lastFailureLoggedAt < FAILURE_LOG_INTERVAL_MS) return;
  lastFailureLoggedAt = now;
  try {
    logError("trpc-telemetry", cause, { procedure }, "warn");
  } catch {
    // reporting is best-effort too
  }
}

export interface TrpcCall {
  procedure: string;
  type: string;
  ok: boolean;
  /** tRPC error code, set when ok is false. */
  code?: string;
  ms: number;
  batch: number;
}

/**
 * Fire and forget: never awaited, never throws. A rejected or synchronously throwing write is reported
 * (rate-limited) with the procedure name and then dropped.
 */
export function recordTrpcCall(call: TrpcCall): void {
  try {
    void recordMetricStrict(TRPC_CALL_METRIC, call.ms, {
      unit: "ms",
      source: "trpc",
      tags: {
        procedure: call.procedure,
        type: call.type,
        ok: call.ok,
        ...(call.code ? { code: call.code } : {}),
        batch: call.batch,
      },
    }).catch((e) => reportWriteFailure(call.procedure, e));
  } catch (e) {
    reportWriteFailure(call.procedure, e);
  }
}
