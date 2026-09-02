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
  // Sentry uses the runtime-specific config files so Node and Edge keep their
  // own SDK boundaries. Both configs fail closed when no DSN is configured.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // ORDER IS LOAD-BEARING (2026-09-02). Sentry.init registers the global
    // OpenTelemetry tracer provider, and @opentelemetry/api refuses a second
    // registration SILENTLY (keeping the first). So the Langfuse span
    // processor must be built BEFORE Sentry and handed to it - riding on
    // Sentry's provider - or every AI SDK span is dropped while
    // `langfuse_started` still appears in the boot log. That is exactly what
    // production did between #2074 and this change.
    const { buildLangfuseSpanProcessor, markLangfuseAttachedToHostProvider } = await import(
      "@/lib/observability/langfuse"
    );
    const langfuseProcessor = await buildLangfuseSpanProcessor().catch(() => null);
    const { initSentryServer } = await import("./sentry.server.config");
    initSentryServer(langfuseProcessor ? [langfuseProcessor] : []);
    if (langfuseProcessor) markLangfuseAttachedToHostProvider();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    const { initSentryEdge } = await import("./sentry.edge.config");
    initSentryEdge();
  }

  // 2026-07-22 · EDGE-GRAPH GATE (fixed the Railway build break). Next compiles
  // instrumentation.ts for BOTH runtimes — `export const runtime = "nodejs"` is
  // NOT honored here — so without this guard the edge pass statically bundles
  // every literal dynamic import below (tool-embeddings -> the entire tool
  // universe -> sharp / node:stream), and a node_modules hoisting shift (the
  // stagehand lockfile change) turned that into a FATAL Turbopack error
  // ("sharp: non-ecmascript placeable asset" under Edge Instrumentation).
  //
  // 2026-07-25 · the gate MUST be a wrapped if-BLOCK, not an early return.
  // Turbopack DCEs everything after a constant-false early return, but
  // webpack (`next dev --webpack`) does no flow analysis past a return — it
  // still collected every literal import() below and the edge pass died on
  // bare node builtins ("Can't resolve 'crypto'/'vm'/'fs'", plus
  // worker_threads inside third-party node-domexception, which no source
  // fix can reach). Webpack's ConstPlugin only prunes dependencies inside a
  // compile-time-dead BRANCH, so the imports live inside the if-body — the
  // documented Next.js pattern. NEXT_RUNTIME is a compile-time define, so
  // the edge graph compiles EMPTY under both bundlers.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // truth-substrate audit P0 (#12): FAIL LOUD at boot on missing required
    // env. assertEnvOrDie was defined but never called — a Railway prod boot
    // with a missing AUTH_SECRET / CRON_SECRET / DATABASE_URL silently
    // started a broken server. register() runs once per server-instance
    // start, so this is the canonical boot gate.
    //   · Skipped during `next build` (NEXT_PHASE guard) so CI/build stay
    //     green.
    //   · Safe locally: isProd() is false in dev, so only DATABASE_URL/
    //     DIRECT_URL + one AI provider key are required.
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
    // automatically without a hand-written family). Fire-and-forget: hydrate
    // is ~200ms from VectorEmbedding (well before the first user message),
    // and a failure just defers to the existing request-time warmup. Never
    // blocks boot; never throws.
    //
    // 2026-08-28 · SKIPPED under E2E_HERMETIC. The hermetic e2e job sets
    // OLLAMA_API_KEY to a dummy, so every embedding call 401s: measured
    // `[tool-embeddings] Warm-up complete: 0/181 cached` with 40
    // `embedding.all_failed` warnings, in EVERY sampled run. The cache
    // therefore can never be warm there, and TOOL SELECTION IS UNCHANGED by
    // skipping it. isToolEmbeddingCacheWarm() does flip true -> false (it
    // returns `warmComplete`, which the warm-up sets even after caching 0 of
    // 181), but every consumer is ALSO gated on a non-empty user embedding —
    // chat-mode.ts Tier 5 and app/api/ai/chat/route.ts:738 — and that embedding
    // is empty there for the same dead-provider reason. rankToolsBySimilarity
    // returns [] on an empty cache regardless. So both paths select the same
    // tools; only the doomed work differs.
    //
    // What this saves is EVALUATION, not compilation. A literal import() is
    // collected into the module graph at build time whichever branch runs, so
    // Turbopack still compiles tool-embeddings -> nourTools -> the 7 domain
    // files -> sharp / node:stream (see the edge-graph note above). What is
    // skipped is instantiating all of that at boot, plus 181 doomed embedding
    // calls and the 40 `embedding.all_failed` lines they emit — which is not
    // only noise: it is what filled `tail -40` on failure while the /api/intel
    // wedge went undiagnosed for two days.
    //
    // NOT a fix for that wedge, and not claimed as one — the wedge is in
    // Turbopack's dev compiler (scripts/ci/warm-routes.sh has the evidence).
    // The dev server enters the warm loop at 2729-2990 MB RSS across three
    // sampled runs; the RSS printed at `warm /` is the measurement of whether
    // this moved it, on every run.
    if (process.env.E2E_HERMETIC === "1") {
      console.log(
        "[tool-embeddings] boot warm-up SKIPPED · E2E_HERMETIC=1 (no usable embedding provider; request-time warmup still applies)",
      );
    } else {
      try {
        const { warmToolEmbeddings } = await import("@/lib/ai/tool-embeddings");
        void warmToolEmbeddings().catch(() => {});
      } catch {
        // never let embedding warm-up break server boot
      }
    }

    // 2026-08-25 · Langfuse tracing init. Registers a LangfuseSpanProcessor
    // on the global OTel provider (NodeSDK) so streamText calls carrying
    // `experimental_telemetry` emit gen_ai spans to Langfuse. No-op unless
    // LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY are set; fail-open on init
    // error — observability must never break boot. Same wrapped-if edge-graph
    // rules as everything above: literal dynamic import inside the if-body.
    try {
      const { initLangfuseTracing } = await import("@/lib/observability/langfuse");
      await initLangfuseTracing();
    } catch {
      // never let tracing init break server boot
    }

    // 2026-07-28 cron-truth hardening · Inngest deploy-time self-sync.
    // Railway has no Inngest deploy hook, so the Cloud function manifest
    // only updated on MANUAL PUTs — and drifted for weeks, leaving ~16
    // scheduled functions (incl. the cron-heartbeat watchdog) invisible
    // to the scheduler. Every boot now self-syncs once (~20s after
    // listen), so the manifest can never drift past a single deploy.
    // Fire-and-forget + fail-open; prod-gated inside the module.
    // See docs/audits/2026-07-28-cron-truth.md, Finding 1.
    try {
      const { scheduleInngestSelfSync } = await import("@/lib/inngest/self-sync");
      scheduleInngestSelfSync();
    } catch {
      // never let the sync scheduler break server boot
    }
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
  request: NextRequest | { path: string; method: string },
  context?: unknown,
): Promise<void> {
  // Same edge-graph gate as register() — wrapped if-block, not early return,
  // so webpack also drops the import() from the edge pass.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { captureRequestError } = await import("@sentry/nextjs");
      await captureRequestError(err, request as never, context as never);
    } catch {
      // never let Sentry reporting break the app
    }

    try {
      const { recordTrace } = await import("@/lib/observability/tracer");
      recordTrace({
        at: new Date().toISOString(),
        method: request.method ?? "GET",
        path: "path" in request ? request.path ?? "/" : request.nextUrl.pathname ?? "/",
        status: 500,
        durationMs: 0, // can't measure here · sentinel
        errorClass: (err as Error)?.name ?? "UnknownError",
      });
    } catch {
      // never let observability break the app
    }
  }
}
