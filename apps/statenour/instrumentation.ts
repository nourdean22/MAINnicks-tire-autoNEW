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
  // truth-substrate audit P0 (#12): FAIL LOUD at boot on missing required env.
  // assertEnvOrDie was defined but never called — a Railway prod boot with a
  // missing AUTH_SECRET / CRON_SECRET / DATABASE_URL silently started a broken
  // server. register() runs once per server-instance start, so this is the
  // canonical boot gate.
  //   · Skipped during `next build` (NEXT_PHASE guard) so CI/build stay green.
  //   · Safe locally: isProd() is false in dev, so only DATABASE_URL/DIRECT_URL
  //     + one AI provider key are required.
  //   · NOT wrapped in try/catch — the throw MUST propagate to abort boot.
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const { assertEnvOrDie } = await import("@/lib/env");
    assertEnvOrDie();
  }

  // Module-load side effects · the tracer is already set up as a
  // singleton in lib/observability/tracer.ts. Nothing to do at register
  // time other than ensure the module is loaded (so it's hot when
  // onRequestError fires).
  await import("@/lib/observability/tracer");

  // v10.0.532 · warm the tool-embedding cache at BOOT, not lazily on the
  // first chat request. The chat route (app/api/ai/chat/route.ts) kicks off
  // warmToolEmbeddings() fire-and-forget, so the FIRST message after a
  // restart/deploy raced an un-warmed cache → isToolEmbeddingCacheWarm() was
  // false → semantic tool-ranking OFF → the keyword-family fallback → any
  // tool without a keyword family got pruned and the model hallucinated
  // "no tool" (the whole class the v10.0.531 audit patched by hand).
  // statenour-web is a persistent container, so ONE boot-time warm keeps the
  // cache hot for every subsequent request — making semantic ranking the
  // PRIMARY path (keyword families become the backup, and NEW tools attach
  // automatically without a hand-written family). Fire-and-forget: hydrate is
  // ~200ms from VectorEmbedding (well before the first user message), and a
  // failure just defers to the existing request-time warmup. Never blocks
  // boot; never throws.
  try {
    const { warmToolEmbeddings } = await import("@/lib/ai/tool-embeddings");
    void warmToolEmbeddings().catch(() => {});
  } catch {
    // never let embedding warm-up break server boot
  }
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
