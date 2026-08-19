import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { nanoid } from "nanoid";

import { ServiceError } from "@/lib/utils/service-error";
import { logger } from "@/lib/logger";
import { prisma, resetQueryCount, getQueryCount } from "@/lib/prisma";
import { requireCronAuth, requireSyncAuth, requireSession } from "@/lib/auth-guard";
import { isQuotaError, markQuotaExhausted, isQuotaExhausted } from "@/lib/db/safe-prisma";
import { cronJobName } from "@/lib/utils/cron-job-name";
// Note: cronJobName is NOT re-exported here. New callers should import
// directly from @/lib/utils/cron-job-name — keeps http.ts focused.

// ── Legacy helpers (preserved for backward compatibility) ──────────────

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    {
      error: message,
      details,
    },
    { status }
  );
}

export async function readRequestJson<T>(request: Request): Promise<T> {
  // Validate Content-Type to prevent smuggling via text/plain or other types
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("application/json") && !ct.includes("text/json")) {
    throw new ServiceError("Content-Type must be application/json.", 415);
  }
  try {
    return (await request.json()) as T;
  } catch (error) {
    throw new ServiceError("Invalid JSON body.", 400, error);
  }
}

const httpLog = logger.withSurface("utils/http");

export function handleRouteError(error: unknown) {
  if (error instanceof ServiceError) {
    return jsonError(error.message, error.status, error.details);
  }

  if (error instanceof ZodError) {
    return jsonError("Validation failed.", 400, error.flatten());
  }

  // v10.0.57 · structured logger replaces bare console.error so the
  // 500 path lands in /system/errors with surface attribution
  // (utils/http) instead of being a plain stderr line.
  httpLog.error("unexpected_route_error", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  return jsonError("Unexpected server error.", 500);
}

// AI-route safe-parse + error helpers live in a sibling module so
// they can be unit-tested without dragging auth-guard's next-auth
// imports through vitest's loader. Re-exported here for back-compat.
export { safeParseBody, aiRouteError, type SafeParseBodyResult } from "./http-parse";

// ── Response Envelope ──────────────────────────────────────────────────

export interface ApiMeta {
  duration_ms: number;
  timestamp: string;
  request_id: string;
  queries?: number;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  details?: unknown;
  meta: ApiMeta;
}

function envelope<T>(
  ok: boolean,
  meta: ApiMeta,
  data?: T,
  error?: string,
  details?: unknown
): ApiResponse<T> {
  return { ok, ...(data !== undefined ? { data } : {}), ...(error ? { error } : {}), ...(details ? { details } : {}), meta };
}

/**
 * Fire-and-forget a telemetry write so it can NEVER take down the request
 * it is describing.
 *
 * 2026-08-19 · every telemetry site below dereferences `prisma.<model>`
 * SYNCHRONOUSLY. A trailing `.catch()` covers only the promise that call
 * returns — it cannot cover a call that never produced one. That gap had
 * teeth in two places at once:
 *
 *   1. The success-path write is SAMPLED (`duration_ms > 1000 ||
 *      Math.random() < 0.01`). When the deref throws, the throw lands in
 *      apiHandler's own catch — which repeats the IDENTICAL deref and
 *      throws again, now with nothing left to catch it. The route rejects
 *      instead of returning its 500 envelope, and the caller sees a raw
 *      TypeError from the logging code rather than the real failure.
 *   2. Because the trigger is a 1% coin flip, it surfaced as an
 *      unreproducible CI flake (tests/api/today-compound.test.ts on
 *      PR #1697) rather than as a bug anyone could bisect. Nine test
 *      files mock `@/lib/prisma` without `apiRequestLog`, so each of
 *      their apiHandler calls was a 1-in-100 red.
 *
 * Telemetry is best-effort by contract, so a broken writer is logged and
 * dropped — never propagated.
 */
function fireAndForgetTelemetry(write: () => Promise<unknown>, site: string): void {
  try {
    void write().catch((e) => {
      if (isQuotaError(e)) markQuotaExhausted();
    });
  } catch (e) {
    httpLog.warn("telemetry_write_unavailable", {
      site,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ── API Handler Wrapper ────────────────────────────────────────────────

type RouteHandler = (
  req: Request,
  ctx: { params?: Promise<Record<string, string>>; requestId: string }
) => Promise<Response | unknown>;

interface ApiHandlerOptions {
  auth?: "cron" | "sync" | "owner" | "none";
  rateLimit?: "general" | "ai" | "auth" | "sync";
}

/**
 * Wraps any API route with:
 * - Request ID generation + X-Request-Id header
 * - Automatic timing + structured logging
 * - Try/catch with proper error responses
 * - Standard response envelope { ok, data, error, meta }
 * - Query count tracking (N+1 detection)
 */
export function apiHandler(handler: RouteHandler, options: ApiHandlerOptions = {}) {
  // Next 15's generated .next/types/validator.ts requires every route handler to
  // accept `context: { params: Promise<unknown> }`. Match that contract here so
  // `tsc --noEmit` (which type-checks the generated validator) stays green; the
  // richer Record<string,string> shape is restored at the single boundary below.
  return async (req: Request, routeCtx?: { params: Promise<unknown> }) => {
    const requestId = nanoid(12);
    const start = Date.now();
    const url = new URL(req.url);
    const route = url.pathname;
    const method = req.method;

    resetQueryCount();

    const log = logger.withContext({ route, method, requestId });
    log.info("start");

    try {
      // Auth guard
      if (options.auth === "cron") requireCronAuth(req);
      if (options.auth === "sync") requireSyncAuth(req);
      if (options.auth === "owner") await requireSession(req);

      // Rate limiting
      if (options.rateLimit) {
        const { checkRateLimit, getClientIp, RATE_LIMITS } = await import("@/lib/rate-limit");
        const ip = getClientIp(req);
        const config = RATE_LIMITS[options.rateLimit];
        const rl = checkRateLimit(`${route}:${ip}`, config);
        if (!rl.allowed) {
          return NextResponse.json(
            envelope(false, { duration_ms: Date.now() - start, timestamp: new Date().toISOString(), request_id: requestId }, undefined, "Rate limit exceeded"),
            { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)), "X-Request-Id": requestId } }
          );
        }
      }

      // v7.8 · Apr 29 · Universal audit. Resolve the actor for this
      // request and run the handler inside its async-context scope.
      // Any chatMessage / Mission / Task / etc write that lifts off
      // `currentActor()` will tag rows correctly:
      //   · auth=owner (Nour browser session)         → "user"
      //   · auth=cron + cronHandler wraps              → "cron:<jobName>"
      //   · auth=sync (bridge inbound)                 → "bridge:nickstire"
      //   · unauthed public surface                    → "system"
      // cronHandler wraps a tighter scope on top, so its actor wins.
      const { resolveActor, withActor } = await import("@/lib/db/actor");
      const actor =
        options.auth === "cron"
          ? "system" // cronHandler will narrow to cron:<jobName>
          : options.auth === "sync"
            ? "bridge:nickstire"
            : options.auth === "owner"
              ? "user"
              : resolveActor(req);
      const result = await withActor(actor, () =>
        handler(req, { params: routeCtx?.params as Promise<Record<string, string>> | undefined, requestId }),
      );

      const duration_ms = Date.now() - start;
      const meta: ApiMeta = {
        duration_ms,
        timestamp: new Date().toISOString(),
        request_id: requestId,
        queries: getQueryCount(),
      };

      log.info("done", { ms: duration_ms, queries: meta.queries });

      // Fire-and-forget request log — sample to reduce write load
      // Always log slow (>1s). Otherwise 10% sample in prod, 1% in dev.
      // Skip entirely during quota exhaustion — don't burn more calls
      // on telemetry when the DB is already tapped out.
      const sampleRate = process.env.NODE_ENV === "production" ? 0.1 : 0.01;
      const shouldLog = duration_ms > 1000 || Math.random() < sampleRate;
      if (shouldLog && !isQuotaExhausted()) {
        fireAndForgetTelemetry(() => prisma.apiRequestLog.create({
          data: { method, path: route, statusCode: 200, durationMs: duration_ms, requestId, userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null },
        }), "apiRequestLog:success");
      }

      // Cron observability — write to CronJobLog so the system-audit
      // can see which crons ran + their duration. Before this, only
      // two crons (review-fetch + follow-up-reminders) ever logged
      // because they went through a different path. Every cronHandler
      // call now auto-logs.
      //
      // 2026-04-22 fix · cronJobName() now includes the ?slot=X query
      // param so /api/cron/mega?slot=morning logs as "mega-morning"
      // instead of "mega". Without this, every mega slot shared a
      // single jobName row, and the settings/crons panel (which looks
      // up by "mega-morning" etc) got empty stats for every job.
      // v9.1.16 · removed apiHandler's success-path cronJobLog write.
      // Code-review surfaced this as a DOUBLE-LOG: every cron route
      // wraps via `cronHandler(handler)`, which calls
      // `logCronRun(jobName, ...)` (lib/services/cron-manager.ts) on
      // BOTH success and failure. logCronRun ALREADY persists the
      // CronJobLog row. Adding a second row here from apiHandler's
      // post-success path doubled every cron's row count and skewed
      // the success-rate calculation in getCronStatus(). With 34
      // active crons, that's roughly half of the cron-log table
      // shaved off going forward.
      // (Failure path below also removed for the same reason.)

      // If handler returned a raw Response, add request ID header and return
      if (result instanceof Response) {
        result.headers.set("X-Request-Id", requestId);
        return result;
      }

      // Otherwise wrap in envelope
      return NextResponse.json(envelope(true, meta, result), {
        headers: { "X-Request-Id": requestId },
      });
    } catch (error) {
      const duration_ms = Date.now() - start;
      const meta: ApiMeta = {
        duration_ms,
        timestamp: new Date().toISOString(),
        request_id: requestId,
      };

      // Detect Neon compute-quota exhaustion. Mark the sticky flag so
      // subsequent calls skip DB entirely. Return a 503 with an
      // explicit dbQuotaExhausted flag so the UI can render a banner
      // instead of cascading 500s across every page.
      if (isQuotaError(error)) {
        markQuotaExhausted();
        log.warn("db_quota_exhausted", { ms: duration_ms });
        return NextResponse.json(
          envelope(false, meta, undefined, "Database compute quota exhausted.", { dbQuotaExhausted: true }),
          { status: 503, headers: { "X-Request-Id": requestId, "Retry-After": "60" } }
        );
      }

      // Log errors to ApiRequestLog — skip during quota outage so the
      // telemetry writes don't re-trigger the same quota error.
      const errorStatus = error instanceof ServiceError ? error.status : error instanceof ZodError ? 400 : 500;
      if (!isQuotaExhausted()) {
        fireAndForgetTelemetry(() => prisma.apiRequestLog.create({
          data: { method, path: route, statusCode: errorStatus, durationMs: duration_ms, requestId, error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error" },
        }), "apiRequestLog:failure");
      }

      // v9.1.16 · removed apiHandler's failure-path cronJobLog write
      // (was double-logging — cronHandler→logCronRun handles failure
      // already). See success-path note above.

      // Error log — for 500-class failures only (skip 4xx client errors
      // and validation errors which are ApiRequestLog territory).
      if (errorStatus >= 500 && !isQuotaExhausted()) {
        // Prefix the route (every logError row carries `[source] ` — these
        // were the only rows without one). Two different routes throwing
        // the same generic message used to collapse into ONE health-page
        // pattern with the route buried in `context`, which the pattern
        // grouping never reads.
        const bareMsg = error instanceof Error ? error.message : "Unknown error";
        fireAndForgetTelemetry(() => prisma.errorLog.create({
          data: {
            level: "error",
            message: `[${route}] ${bareMsg}`.slice(0, 500),
            stack: error instanceof Error ? error.stack?.slice(0, 4000) ?? null : null,
            context: { method, path: route, requestId, duration_ms } as any,
          },
        }), "errorLog:failure");
      }

      if (error instanceof ServiceError) {
        log.warn(`error: ${error.message}`, { ms: duration_ms, status: error.status });
        return NextResponse.json(
          envelope(false, meta, undefined, error.message, error.details),
          { status: error.status, headers: { "X-Request-Id": requestId } }
        );
      }

      if (error instanceof ZodError) {
        log.warn("validation_error", { ms: duration_ms });
        return NextResponse.json(
          envelope(false, meta, undefined, "Validation failed.", error.flatten()),
          { status: 400, headers: { "X-Request-Id": requestId } }
        );
      }

      const msg = error instanceof Error ? error.message : "Unexpected server error.";
      log.error(`unhandled: ${msg}`, {
        ms: duration_ms,
        stack: error instanceof Error ? error.stack?.split("\n").slice(0, 3).join(" | ") : undefined,
      });

      return NextResponse.json(
        envelope(false, meta, undefined, "Unexpected server error."),
        { status: 500, headers: { "X-Request-Id": requestId } }
      );
    }
  };
}

/**
 * apiHandler pre-configured with cron auth + kill-switch gate.
 *
 * The kill switch is stored as a BrainMemory row (see lib/services/
 * cron-control.ts). Default state = enabled. When disabled via the
 * Settings UI, the route short-circuits with a 200 + `{skipped:true}`
 * so the scheduler doesn't treat it as a failure and the cron-job
 * log stays clean.
 *
 * The job name is inferred from the URL path: `/api/cron/foo` → "foo",
 * `/api/cron/mega?slot=...` → "mega". Falls back to "unknown" only if
 * the URL shape is weird; in that case the switch can't apply and the
 * job runs as usual (fail-open).
 */
export function cronHandler(handler: RouteHandler) {
  return apiHandler(
    async (req, ctx) => {
      const url = new URL(req.url);
      const match = url.pathname.match(/\/api\/cron\/([^/?]+)/);
      const jobName = match?.[1] ?? null;

      if (jobName) {
        const { isCronEnabled } = await import("@/lib/services/cron-control");
        const enabled = await isCronEnabled(jobName).catch(() => true);
        if (!enabled) {
          return { skipped: true, reason: "disabled via settings", jobName };
        }
      }

      // Wrap the handler so every cron run persists a CronJobLog row.
      // This is what powers /system/crons. Logging failures silently
      // swallow so a broken log DB never takes down a cron.
      if (!jobName) {
        return handler(req, ctx);
      }

      const { logCronRun } = await import("@/lib/services/cron-manager");
      // v7.8 · Apr 29 · Universal audit. Tag every write that happens
      // inside the cron run with the actor "cron:<jobName>" so DB rows
      // record exactly which scheduled job created/updated them.
      const { withActor, actorFromCron } = await import("@/lib/db/actor");
      const run = await logCronRun(jobName, async () =>
        withActor(actorFromCron(jobName), () => handler(req, ctx)),
      );
      // v10.0.152 · log policy fire so AutomationPolicy.fireCount and
      // lastFiredAt become live data on /system/policies. Fire-and-
      // forget — logPolicyFire swallows DB errors internally so the
      // cron path stays unaffected if the policy registry is down.
      // Maps jobName → "cron.<jobName>" because the seed uses that id
      // shape; mega slot crons are also registered (cron.mega +
      // cron.mega-evening) so the lookup hits.
      {
        const { logPolicyFire } = await import("@/lib/automation/policy");
        // A handler that resolved while reporting ok:false is a failure for
        // policy-fire purposes too — otherwise fireCount records it green.
        void logPolicyFire(
          `cron.${jobName}`,
          run.success && !run.reportedFailure ? "success" : "failure",
        );
      }
      if (!run.success) {
        // Re-throw so apiHandler can surface the error in the HTTP
        // response as normal. The row is already persisted.
        throw new Error(run.error ?? "cron failed");
      }
      return run.result;
    },
    { auth: "cron" },
  );
}

/** apiHandler pre-configured with sync auth */
export function syncHandler(handler: RouteHandler) {
  return apiHandler(handler, { auth: "sync" });
}
