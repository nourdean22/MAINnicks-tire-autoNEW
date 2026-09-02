import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent, sentryInitOptions } from "@/lib/observability/sentry";
import type { LangfuseSpanProcessorLike } from "@/lib/observability/langfuse";

/**
 * Node runtime Sentry init. Called from instrumentation.ts — an exported
 * function rather than an import side effect, because the CALLER must build
 * the Langfuse span processor first and pass it in here.
 *
 * Why: `Sentry.init()` registers the global OpenTelemetry tracer provider
 * (@sentry/node initOtel.js), and `@opentelemetry/api` refuses a second
 * registration silently, keeping the first. Anything else that wants spans
 * from the same process — the Vercel AI SDK feeding Langfuse — has to ride on
 * Sentry's provider via the supported `openTelemetrySpanProcessors` option.
 *
 * AND THE SAMPLER HAS TO SAY YES, FOR THE ROOT.
 *
 * `tracesSampleRate: 0` makes the sampler return NOT_RECORD and OpenTelemetry
 * returns a non-recording span before any processor runs — nothing reaches
 * Langfuse. But a name-based `tracesSampler` does not work either, and that
 * cost a deploy to learn: Sentry consults the sampler for ROOT SPANS ONLY
 * (@sentry/opentelemetry sampler, `if (!isRootSpan) return { decision:
 * parentSampled ? RECORD_AND_SAMPLED : NOT_RECORD }`). Children inherit the
 * root's decision verbatim. An `ai.generateText` span is almost always a child
 * of the HTTP request span, so a sampler that rejected "POST /api/…" silently
 * killed every AI span nested inside a request — while the boot self-check,
 * which IS a root, still recorded and reported the pipeline healthy.
 *
 * So the root is sampled, and keeping Langfuse to model calls is the EXPORT
 * side's job: `aiOnlySpanProcessor` (lib/observability/langfuse.ts) forwards
 * only spans whose instrumentation scope is the AI SDK's. Sampling decides
 * what records; the filter decides what leaves. Recorded transactions are
 * dropped before they reach Sentry via `beforeSendTransaction: () => null`, so
 * Sentry stays errors-only.
 *
 * Fails closed with no valid DSN (`enabled: false`), and every event's free
 * text passes the shared secret mask before export.
 */
export function initSentryServer(openTelemetrySpanProcessors: LangfuseSpanProcessorLike[] = []): void {
  const carriesForeignProcessors = openTelemetrySpanProcessors.length > 0;

  Sentry.init({
    ...sentryInitOptions(),
    ...(carriesForeignProcessors
      ? {
          openTelemetrySpanProcessors,
          // Roots must record or their AI children never will.
          tracesSampleRate: 1,
          // ...and none of it is shipped to Sentry.
          beforeSendTransaction: () => null,
        }
      : {}),
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
