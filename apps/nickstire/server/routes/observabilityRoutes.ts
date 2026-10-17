/**
 * Operator-only observability routes (Authorization: Bearer $ADMIN_API_KEY,
 * the same gate as POST /api/health/recover).
 *
 *   POST /api/system/observability-probe   plant a known positive in each sink
 *   GET  /api/system/observability-status  HEALTHY | DEGRADED | UNKNOWN per instrument
 *
 * Why the probe exists: on 2026-09-02 statenour had real keys, a "started"
 * log and zero observations. A green badge, a started client and a dead sink
 * look the same from outside; only an event you planted yourself, read back by
 * its probe id, tells them apart. `ok` is true only when the sink was enabled,
 * the event was flushed AND the transport acked it; a disabled sink reports
 * ok:false with a reason.
 *
 *   · sentry   one info-level message tagged probe_id + commit, then flush().
 *              Read back in Sentry by event id or tag probe_id.
 *   · langfuse one synthetic generation named observability-probe (no model
 *              call, no tokens) with the probe id in metadata, then one OTLP
 *              export (POST /api/public/otel/v1/traces). Read back with
 *              GET /api/public/v2/observations?name=observability-probe&fromStartTime=<iso>&fields=core,basic,metadata
 *              (Basic auth, cursor paging) and take the row whose metadata.probeId is
 *              the probeId in this response. The old GET read-backs are removed on 2026-11-16.
 *
 * Observe-only: no database writes.
 */
import type { Express, Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { captureMessage, flushSentry, getSentryStatus, transportAnswerFor } from "../lib/sentry";
import { flushLangfuse, getLangfuseStatus, traceGeneration } from "../lib/langfuse-ingest";
import { resolveObservabilityStatus } from "../lib/observabilityStatus";
import { resolveNickDeployIdentity } from "../lib/deployIdentity";

const BOOT_AT = new Date().toISOString();

type Target = "sentry" | "langfuse";
const ALL_TARGETS: Target[] = ["sentry", "langfuse"];

async function probeSentry(probeId: string) {
  const status = getSentryStatus();
  if (!status.dsnSet) {
    return { enabled: false, ok: false, eventId: null, flushed: false, acked: false, reason: "SENTRY_DSN unset: the client is disabled and nothing was sent" };
  }
  if (!status.initialized) {
    return { enabled: false, ok: false, eventId: null, flushed: false, acked: false, reason: `DSN set but Sentry did not initialize: ${status.initError ?? "unknown"}` };
  }
  const t0 = Date.now();
  const commit = resolveNickDeployIdentity(process.env).commitShort ?? "unknown";
  const eventId = captureMessage(`observability-probe ${probeId}`, {
    level: "info",
    tags: { probe: "true", probe_id: probeId, commit },
  });
  const flushed = await flushSentry(5000);
  const after = getSentryStatus();
  // THIS event's transport answer, not a counter delta another event could move.
  const answer = eventId ? transportAnswerFor(eventId) : undefined;
  const acked = typeof answer === "number" && answer >= 200 && answer < 300;
  const reason = !eventId
    ? (after.lastCaptureError ?? "captureMessage returned no event id")
    : !flushed
      ? "Sentry.flush() did not drain: the event may not have left the process"
      : !acked
        ? `flushed but Sentry's transport did not 2xx this event (answer ${answer === undefined ? "none" : String(answer)})`
        : null;
  return {
    enabled: true,
    ok: reason === null,
    eventId,
    flushed,
    acked,
    release: status.release,
    durationMs: Date.now() - t0,
    ...(reason ? { reason } : {}),
  };
}

async function probeLangfuse(probeId: string) {
  const status = getLangfuseStatus();
  if (!status.configured) {
    return { enabled: false, ok: false, flushed: false, reason: "LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY unset: nothing was exported" };
  }
  const t0 = Date.now();
  const traceId = randomUUID().replace(/-/g, ""); // an OTLP trace id is 32 hex: flush.traceIds echoes it back
  const queued = traceGeneration({
    traceId,
    name: "observability-probe",
    site: "routes/observabilityRoutes.ts",
    model: "probe",
    promptText: `observability-probe ${probeId}`,
    input: `ping ${probeId}`,
    output: `pong ${probeId}`,
    latencyMs: 0,
    ok: true,
    // The one excerpt opt-in: synthetic ping/pong text, no customer data.
    excerpt: true,
    metadata: { probeId, probe: true },
  });
  if (queued !== "queued") {
    return { enabled: true, ok: false, flushed: false, reason: `probe event not queued (${queued})` };
  }
  // Confirm OUR batch: an in-flight timer flush answers for an older one, so flush
  // until our trace id is in an accepted batch, a flush fails, or nothing is left.
  let flush = await flushLangfuse();
  for (let i = 0; i < 5 && flush.ok && !flush.traceIds.includes(traceId) && getLangfuseStatus().queued > 0; i++) {
    flush = await flushLangfuse();
  }
  const ok = flush.ok && flush.traceIds.includes(traceId);
  return {
    enabled: true,
    ok,
    flushed: flush.attempted,
    httpStatus: flush.httpStatus,
    sent: flush.sent,
    durationMs: Date.now() - t0,
    ...(ok ? {} : { reason: flush.error ?? "the probe's batch was not confirmed by Langfuse" }),
  };
}

async function observabilityProbeHandler(req: Request, res: Response): Promise<void> {
  const probeId = randomUUID().slice(0, 10);
  try {
    const body = (req.body ?? {}) as { targets?: unknown };
    const requested = Array.isArray(body.targets)
      ? body.targets.filter((t): t is Target => (ALL_TARGETS as unknown[]).includes(t))
      : [];
    const targets = new Set<Target>(requested.length > 0 ? requested : ALL_TARGETS);
    const identity = resolveNickDeployIdentity(process.env);
    res.json({
      probeId,
      startedAt: new Date().toISOString(),
      commit: identity.commitShort,
      targets: [...targets],
      ...(targets.has("sentry") ? { sentry: await probeSentry(probeId) } : {}),
      ...(targets.has("langfuse") ? { langfuse: await probeLangfuse(probeId) } : {}),
    });
  } catch (err) {
    // An async throw would otherwise be an unhandled rejection with no response.
    res.status(500).json({ probeId, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function observabilityStatusHandler(_req: Request, res: Response): void {
  res.json(
    resolveObservabilityStatus({
      sentry: getSentryStatus(),
      langfuse: getLangfuseStatus(),
      nowMs: Date.now(),
      bootAt: BOOT_AT,
    }),
  );
}

/** `auth` is requireAdminApiKey, passed in so this module stays free of adminRoutes' imports. */
export function registerObservabilityRoutes(app: Express, auth: RequestHandler): void {
  app.post("/api/system/observability-probe", auth, observabilityProbeHandler);
  app.get("/api/system/observability-status", auth, observabilityStatusHandler);
}
