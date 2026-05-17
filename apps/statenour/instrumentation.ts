/**
 * Next.js instrumentation hook · v10.0.377
 *
 * Registers a per-request tracer that captures method + path + status +
 * duration into an in-memory ring buffer. Read via /api/system/
 * observability and rendered on /system/observability.
 *
 * Per /observability-engineer skill · the Next.js instrumentation hook
 * is the canonical extension point for cross-request observability.
 * No vendor lock-in · no OTel SDK dependency · just lightweight
 * timestamp + status capture.
 *
 * Runtime · 'nodejs' (instrumentation hooks don't run in Edge runtime).
 */

import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function register() {
  // Module-load side effects · the tracer is already set up as a
  // singleton in lib/observability/tracer.ts. Nothing to do at register
  // time other than ensure the module is loaded (so it's hot when
  // onRequestError fires).
  await import("@/lib/observability/tracer");
}

/**
 * onRequestError · fires on uncaught errors. We use it to capture
 * error class for slow / failing routes. Successful traces are
 * captured by the route-level instrumentation in
 * `lib/utils/with-tracing.ts` (the wrapped pattern).
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
): Promise<void> {
  try {
    const { recordTrace } = await import("@/lib/observability/tracer");
    recordTrace({
      at: new Date().toISOString(),
      method: request.method ?? "GET",
      path: request.path ?? "/",
      status: 500,
      durationMs: 0, // can't measure here · sentinel
      errorClass: (err as Error)?.name ?? "UnknownError",
    });
  } catch {
    // never let observability break the app
  }
}
