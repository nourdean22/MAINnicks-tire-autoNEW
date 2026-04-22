/**
 * Sentry integration — opt-in via SENTRY_DSN env var.
 *
 * Design choice: we don't import @sentry/node unless it's actually configured.
 * This keeps the bundle lean when Sentry isn't used (local dev, free tier)
 * and avoids forcing the dep.
 *
 * To enable:
 *   1. `pnpm add @sentry/node`
 *   2. Set SENTRY_DSN=<your-dsn> on Railway
 *   3. Optionally SENTRY_ENVIRONMENT=production (defaults to NODE_ENV)
 *   4. Optionally SENTRY_TRACES_SAMPLE_RATE=0.1 (defaults to 0)
 *
 * Every error recorded via errorTelemetry.record() also goes to Sentry if
 * initialized. Nothing else changes.
 */

import { createLogger } from "./logger";

const log = createLogger("sentry");

let sentryClient: {
  captureException: (e: unknown, ctx?: Record<string, unknown>) => void;
  captureMessage: (msg: string, ctx?: Record<string, unknown>) => void;
  flush: (timeout?: number) => Promise<boolean>;
} | null = null;

/**
 * Initialize Sentry if SENTRY_DSN is set.
 * Silently no-ops if the DSN is missing or the dep isn't installed.
 * Call once at server startup.
 */
export async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    log.info("SENTRY_DSN not set — Sentry disabled");
    return;
  }

  try {
    // Dynamic import so this file compiles even without @sentry/node installed.
    // Cast to `unknown` first so TS doesn't complain about missing types.
    const Sentry = (await import("@sentry/node" as unknown as string).catch(() => null)) as
      | null
      | {
          init: (opts: Record<string, unknown>) => void;
          captureException: (e: unknown, ctx?: Record<string, unknown>) => void;
          captureMessage: (msg: string, ctx?: Record<string, unknown>) => void;
          flush: (timeout?: number) => Promise<boolean>;
        };

    if (!Sentry) {
      log.warn("SENTRY_DSN set but @sentry/node not installed. Run: pnpm add @sentry/node");
      return;
    }

    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0"),
      release: process.env.RAILWAY_DEPLOYMENT_ID || process.env.GIT_COMMIT_SHA,
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

    sentryClient = {
      captureException: Sentry.captureException.bind(Sentry),
      captureMessage: Sentry.captureMessage.bind(Sentry),
      flush: Sentry.flush.bind(Sentry),
    };

    log.info("Sentry initialized", { environment: process.env.NODE_ENV });
  } catch (err) {
    log.warn("Sentry init failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Send an exception to Sentry (no-op if not initialized). */
export function captureException(err: unknown, ctx?: Record<string, unknown>): void {
  sentryClient?.captureException(err, ctx);
}

/** Send a string message to Sentry (no-op if not initialized). */
export function captureMessage(msg: string, ctx?: Record<string, unknown>): void {
  sentryClient?.captureMessage(msg, ctx);
}

/** Flush pending events before shutdown. */
export async function flushSentry(timeoutMs: number = 2000): Promise<void> {
  if (sentryClient) {
    await sentryClient.flush(timeoutMs).catch(() => {});
  }
}

/** Returns true if Sentry is initialized and actively capturing. */
export function isSentryEnabled(): boolean {
  return sentryClient !== null;
}
