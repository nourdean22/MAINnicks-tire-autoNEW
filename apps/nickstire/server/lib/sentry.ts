/**
 * Sentry integration — opt-in via SENTRY_DSN env var.
 *
 * @sentry/node is a pinned dependency. We still LAZY-load it (dynamic import
 * inside initSentry) so it's only pulled in when a DSN is actually set — startup
 * stays lean on local dev / any deploy that leaves Sentry disabled.
 *
 * To enable (the dep is already installed — no install step):
 *   1. Set SENTRY_DSN=<your-dsn> on Railway
 *   2. Optionally SENTRY_ENVIRONMENT=production (defaults to NODE_ENV)
 *   3. Optionally SENTRY_TRACES_SAMPLE_RATE=0.1 (defaults to 0)
 *
 * Every error recorded via errorTelemetry.record() also goes to Sentry if
 * initialized. Nothing else changes.
 *
 * 2026-10-16 (observability proof): this module now keeps its own receipts.
 * "DSN present" was the only health signal, which is the same false green as
 * the 2026-09-02 placeholder-DSN incident (keys set, "started" logged, zero
 * events). `getSentryStatus()` reports what actually left the process: events
 * captured since boot, the last event id, the last capture error and the last
 * flush result. `/api/system/observability-status` turns those into
 * HEALTHY / DEGRADED / UNKNOWN; `/api/system/observability-probe` plants a
 * known positive. The release is the deployed COMMIT (resolveNickDeployIdentity),
 * not Railway's deployment id, so an issue pins to a diff.
 */

import { createLogger } from "./logger";
import { resolveNickDeployIdentity } from "./deployIdentity";

const log = createLogger("sentry");

type SentryLike = {
  captureException: (e: unknown, ctx?: Record<string, unknown>) => string | undefined;
  captureMessage: (msg: string, ctx?: Record<string, unknown>) => string | undefined;
  flush: (timeout?: number) => Promise<boolean>;
};

let sentryClient: SentryLike | null = null;

const receipts = {
  release: null as string | null,
  initError: null as string | null,
  eventsCapturedSinceBoot: 0,
  eventsAckedSinceBoot: 0,
  lastAckAt: null as string | null,
  lastAckStatus: null as number | null,
  lastEventId: null as string | null,
  lastEventAt: null as string | null,
  lastCaptureError: null as string | null,
  lastCaptureErrorAt: null as string | null,
  lastFlushOk: null as boolean | null,
  lastFlushAt: null as string | null,
};

export interface SentryStatus {
  /** SENTRY_DSN is non-empty. Presence only; never read it as "working". */
  dsnSet: boolean;
  /** Sentry.init ran and the client is held. */
  initialized: boolean;
  release: string | null;
  initError: string | null;
  /** Captures that returned an event id since boot. An id is issued locally: it is NOT proof of delivery. */
  eventsCapturedSinceBoot: number;
  /** Events Sentry's transport answered with a 2xx since boot (afterSendEvent hook). This is the delivery receipt. */
  eventsAckedSinceBoot: number;
  lastAckAt: string | null;
  /** HTTP status of the last transport response (2xx or not); null until one arrived. */
  lastAckStatus: number | null;
  lastEventId: string | null;
  lastEventAt: string | null;
  lastCaptureError: string | null;
  lastCaptureErrorAt: string | null;
  /** Result of the last flush(); null until one ran. */
  lastFlushOk: boolean | null;
  lastFlushAt: string | null;
}

/** Resolve the release string: the deployed commit, else Railway's deployment id, else nothing. */
export function resolveSentryRelease(env: Record<string, string | undefined>): string | undefined {
  const identity = resolveNickDeployIdentity(env);
  return identity.commit ?? identity.deploymentId ?? undefined;
}

/**
 * Initialize Sentry if SENTRY_DSN is set.
 * Silently no-ops if the DSN is missing (or, defensively, if the Sentry
 * module ever fails to load).
 * Call once at server startup.
 */
export async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    log.info("SENTRY_DSN not set — Sentry disabled");
    return;
  }

  try {
    // Lazy dynamic import: @sentry/node is a hard dep, but we only load it when a
    // DSN is set so startup stays lean while Sentry is disabled. The string-cast
    // keeps the import untyped; .catch(null) defends against a corrupt/failed
    // module load, not a missing dependency.
    const Sentry = (await import("@sentry/node" as unknown as string).catch(() => null)) as
      | null
      | ({
          init: (opts: Record<string, unknown>) => void;
          getClient?: () => { on?: (hook: string, cb: (event: unknown, resp?: { statusCode?: number }) => void) => unknown } | undefined;
        } & SentryLike);

    if (!Sentry) {
      receipts.initError = "@sentry/node failed to load";
      log.warn("SENTRY_DSN set but the @sentry/node module failed to load — Sentry disabled for this process.");
      return;
    }

    const release = resolveSentryRelease(process.env);
    receipts.release = release ?? null;

    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0"),
      release,
      beforeSend(event: Record<string, unknown>) {
        // Strip PII from the event before it leaves our server.
        const req = (event.request ?? {}) as Record<string, unknown>;
        if (req.cookies) delete req.cookies;
        if (req.headers) {
          const h = req.headers as Record<string, unknown>;
          delete h.cookie;
          delete h.authorization;
        }
        return event;
      },
    });

    // Delivery receipts: the transport's own answer, not the locally issued event id.
    Sentry.getClient?.()?.on?.("afterSendEvent", (event, resp) =>
      recordTransportResponse(resp?.statusCode, (event as { event_id?: string } | undefined)?.event_id),
    );

    sentryClient = {
      captureException: Sentry.captureException.bind(Sentry),
      captureMessage: Sentry.captureMessage.bind(Sentry),
      flush: Sentry.flush.bind(Sentry),
    };

    log.info("Sentry initialized", { environment: process.env.NODE_ENV, release: release ?? "unknown" });
  } catch (err) {
    receipts.initError = err instanceof Error ? err.message : String(err);
    log.warn("Sentry init failed", { error: receipts.initError });
  }
}

function recordCapture(run: () => string | undefined): string | null {
  try {
    const eventId = run();
    if (eventId) {
      receipts.eventsCapturedSinceBoot += 1;
      receipts.lastEventId = eventId;
      receipts.lastEventAt = new Date().toISOString();
      return eventId;
    }
    return null;
  } catch (err) {
    receipts.lastCaptureError = err instanceof Error ? err.message : String(err);
    receipts.lastCaptureErrorAt = new Date().toISOString();
    return null;
  }
}

/** Transport answers for the most recent event ids (bounded), so a probe checks ITS event, not a counter delta. */
const ACK_LOG_MAX = 50;
const ackLog = new Map<string, number | null>();

/** The transport's answer for one event id: a status code, null (answered without one), or undefined (no answer yet). */
export function transportAnswerFor(eventId: string): number | null | undefined {
  return ackLog.get(eventId);
}

/** Record one transport response. 2xx counts as an ack; anything else is a capture error. Exported for tests. */
export function recordTransportResponse(statusCode: number | undefined, eventId?: string): void {
  const at = new Date().toISOString();
  receipts.lastAckStatus = statusCode ?? null;
  if (eventId) {
    ackLog.set(eventId, statusCode ?? null);
    if (ackLog.size > ACK_LOG_MAX) ackLog.delete(ackLog.keys().next().value as string);
  }
  if (statusCode !== undefined && statusCode >= 200 && statusCode < 300) {
    receipts.eventsAckedSinceBoot += 1;
    receipts.lastAckAt = at;
    return;
  }
  receipts.lastCaptureError = `transport answered ${statusCode ?? "no status"}`;
  receipts.lastCaptureErrorAt = at;
}

/** Send an exception to Sentry (no-op if not initialized). Returns the event id when one was issued. */
export function captureException(err: unknown, ctx?: Record<string, unknown>): string | null {
  if (!sentryClient) return null;
  const client = sentryClient;
  return recordCapture(() => client.captureException(err, ctx));
}

/** Send a string message to Sentry (no-op if not initialized). Returns the event id when one was issued. */
export function captureMessage(msg: string, ctx?: Record<string, unknown>): string | null {
  if (!sentryClient) return null;
  const client = sentryClient;
  return recordCapture(() => client.captureMessage(msg, ctx));
}

/**
 * Flush pending events (shutdown, or after a probe). Resolves true when the
 * transport drained inside the timeout, false otherwise; false when disabled.
 */
export async function flushSentry(timeoutMs: number = 2000): Promise<boolean> {
  if (!sentryClient) return false;
  let ok = false;
  try {
    ok = await sentryClient.flush(timeoutMs);
  } catch (err) {
    receipts.lastCaptureError = `flush: ${err instanceof Error ? err.message : String(err)}`;
    receipts.lastCaptureErrorAt = new Date().toISOString();
  }
  receipts.lastFlushOk = ok;
  receipts.lastFlushAt = new Date().toISOString();
  return ok;
}

/** Returns true if Sentry is initialized and actively capturing. */
export function isSentryEnabled(): boolean {
  return sentryClient !== null;
}

/** The receipts behind every Sentry health claim. Counters, never env presence alone. */
export function getSentryStatus(): SentryStatus {
  return {
    dsnSet: Boolean(process.env.SENTRY_DSN),
    initialized: sentryClient !== null,
    ...receipts,
  };
}

/** Test seam: swap the client and forget every receipt. */
export function __setSentryClientForTests(client: SentryLike | null): void {
  sentryClient = client;
  ackLog.clear();
  receipts.release = null;
  receipts.initError = null;
  receipts.eventsCapturedSinceBoot = 0;
  receipts.eventsAckedSinceBoot = 0;
  receipts.lastAckAt = null;
  receipts.lastAckStatus = null;
  receipts.lastEventId = null;
  receipts.lastEventAt = null;
  receipts.lastCaptureError = null;
  receipts.lastCaptureErrorAt = null;
  receipts.lastFlushOk = null;
  receipts.lastFlushAt = null;
}
