/**
 * Operator-only observability routes (Authorization: Bearer $ADMIN_API_KEY,
 * the same gate as POST /api/health/recover).
 *
 *   POST /api/system/observability-probe   plant a known positive in each sink
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
 *
 * Observe-only: no database writes.
 */
import type { Express, Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { captureMessage, flushSentry, getSentryStatus } from "../lib/sentry";
import { resolveNickDeployIdentity } from "../lib/deployIdentity";

type Target = "sentry";
const ALL_TARGETS: Target[] = ["sentry"];

export async function probeSentry(probeId: string) {
  const status = getSentryStatus();
  if (!status.dsnSet) {
    return { enabled: false, ok: false, eventId: null, flushed: false, acked: false, reason: "SENTRY_DSN unset: the client is disabled and nothing was sent" };
  }
  if (!status.initialized) {
    return { enabled: false, ok: false, eventId: null, flushed: false, acked: false, reason: `DSN set but Sentry did not initialize: ${status.initError ?? "unknown"}` };
  }
  const t0 = Date.now();
  const ackedBefore = status.eventsAckedSinceBoot;
  const commit = resolveNickDeployIdentity(process.env).commitShort ?? "unknown";
  const eventId = captureMessage(`observability-probe ${probeId}`, {
    level: "info",
    tags: { probe: "true", probe_id: probeId, commit },
  });
  const flushed = await flushSentry(5000);
  const after = getSentryStatus();
  const acked = after.eventsAckedSinceBoot > ackedBefore;
  const reason = !eventId
    ? (after.lastCaptureError ?? "captureMessage returned no event id")
    : !flushed
      ? "Sentry.flush() did not drain: the event may not have left the process"
      : !acked
        ? `flushed but no 2xx from Sentry's transport (last status ${after.lastAckStatus ?? "none"})`
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

export async function observabilityProbeHandler(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as { targets?: unknown };
  const requested = Array.isArray(body.targets)
    ? body.targets.filter((t): t is Target => (ALL_TARGETS as unknown[]).includes(t))
    : [];
  const targets = new Set<Target>(requested.length > 0 ? requested : ALL_TARGETS);
  const probeId = randomUUID().slice(0, 10);
  const identity = resolveNickDeployIdentity(process.env);
  res.json({
    probeId,
    startedAt: new Date().toISOString(),
    commit: identity.commitShort,
    targets: [...targets],
    ...(targets.has("sentry") ? { sentry: await probeSentry(probeId) } : {}),
  });
}

/** `auth` is requireAdminApiKey, passed in so this module stays free of adminRoutes' imports. */
export function registerObservabilityRoutes(app: Express, auth: RequestHandler): void {
  app.post("/api/system/observability-probe", auth, observabilityProbeHandler);
}
