/**
 * Per-instrument observability state, from the server's own counters.
 *
 * Three states, never two (skill empty-vs-error, fleet-truth.ts doctrine):
 *   HEALTHY  - the instrument proved itself: an event or batch was acked.
 *   DEGRADED - the last attempt failed (capture threw, flush timed out, ingestion non-2xx).
 *   UNKNOWN  - nothing measured: keys unset, zero events since boot, or the last proof is stale.
 * Missing telemetry is never HEALTHY. Pure given its inputs, so every state is testable.
 */
import type { SentryStatus } from "./sentry";
import type { LangfuseIngestStatus } from "./langfuse-ingest";

export type InstrumentState = "HEALTHY" | "DEGRADED" | "UNKNOWN";

export interface InstrumentStatus {
  state: InstrumentState;
  /** When this state began (ISO), or null when nothing dates it. */
  since: string | null;
  detail: string;
}

/** A Langfuse proof older than this is no longer a proof of the running process. */
export const LANGFUSE_FRESH_MS = 12 * 60 * 60 * 1000;

export function resolveSentryInstrument(s: SentryStatus, bootAt: string): InstrumentStatus {
  if (!s.dsnSet) {
    return { state: "UNKNOWN", since: bootAt, detail: "SENTRY_DSN unset: nothing is captured (set it on the Railway service)" };
  }
  if (!s.initialized) {
    return { state: "DEGRADED", since: bootAt, detail: `DSN set but Sentry did not initialize: ${s.initError ?? "unknown init error"}` };
  }
  // An event id is issued locally; only the transport's 2xx (lastAckAt) proves delivery.
  const errorAfterLastAck =
    s.lastCaptureErrorAt !== null && (s.lastAckAt === null || s.lastCaptureErrorAt > s.lastAckAt);
  if (errorAfterLastAck) {
    return { state: "DEGRADED", since: s.lastCaptureErrorAt, detail: `last capture failed: ${s.lastCaptureError}` };
  }
  if (s.lastFlushOk === false && (s.lastAckAt === null || (s.lastFlushAt ?? "") >= s.lastAckAt)) {
    return { state: "DEGRADED", since: s.lastFlushAt, detail: "last flush did not drain: the event may not have left the process" };
  }
  if (s.eventsAckedSinceBoot >= 1) {
    return {
      state: "HEALTHY",
      since: s.lastAckAt,
      detail: `${s.eventsAckedSinceBoot} event(s) acked by Sentry since boot, last id ${s.lastEventId}, release ${s.release ?? "unknown"}`,
    };
  }
  return {
    state: "UNKNOWN",
    since: bootAt,
    detail:
      s.eventsCapturedSinceBoot > 0
        ? `DSN set, ${s.eventsCapturedSinceBoot} event(s) captured but 0 acked by Sentry since boot: no delivery receipt yet`
        : "DSN set, 0 events acked since boot: POST /api/system/observability-probe to plant one",
  };
}

export function resolveLangfuseInstrument(s: LangfuseIngestStatus, nowMs: number, bootAt: string): InstrumentStatus {
  if (!s.configured) {
    return { state: "UNKNOWN", since: bootAt, detail: "LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY unset: tracing is off" };
  }
  if (s.lastIngestOk === false) {
    return {
      state: "DEGRADED",
      since: s.lastIngestAt,
      detail: `last ingestion failed${s.lastHttpStatus ? ` (HTTP ${s.lastHttpStatus})` : ""}: ${s.lastError ?? "unknown error"}; ${s.queued} queued`,
    };
  }
  if (s.lastIngestOk === true && s.lastIngestAt) {
    const ageMs = nowMs - Date.parse(s.lastIngestAt);
    if (ageMs <= LANGFUSE_FRESH_MS) {
      return {
        state: "HEALTHY",
        since: s.lastIngestAt,
        detail: `${s.batchesSent} batch(es) acked, ${s.eventsTraced} generation(s) traced since boot, ${s.skipped.private} skipped as private`,
      };
    }
    return {
      state: "UNKNOWN",
      since: s.lastIngestAt,
      detail: `last 2xx ingestion ${Math.round(ageMs / 3_600_000)} h ago (over 12 h): no recent proof`,
    };
  }
  return {
    state: "UNKNOWN",
    since: bootAt,
    detail: `keys set, no ingestion attempted since boot (${s.queued} queued): POST /api/system/observability-probe to plant one`,
  };
}

export interface ObservabilityStatusPayload {
  generatedAt: string;
  bootAt: string;
  instruments: {
    sentry: InstrumentStatus & { receipts: SentryStatus };
    langfuse: InstrumentStatus & { receipts: LangfuseIngestStatus };
  };
}

export function resolveObservabilityStatus(input: {
  sentry: SentryStatus;
  langfuse: LangfuseIngestStatus;
  nowMs: number;
  bootAt: string;
}): ObservabilityStatusPayload {
  return {
    generatedAt: new Date(input.nowMs).toISOString(),
    bootAt: input.bootAt,
    instruments: {
      sentry: { ...resolveSentryInstrument(input.sentry, input.bootAt), receipts: input.sentry },
      langfuse: { ...resolveLangfuseInstrument(input.langfuse, input.nowMs, input.bootAt), receipts: input.langfuse },
    },
  };
}
