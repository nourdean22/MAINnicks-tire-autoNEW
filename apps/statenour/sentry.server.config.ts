import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent, sentryInitOptions, shouldRecordSpanForLangfuse } from "@/lib/observability/sentry";
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
 * AND THE SAMPLER HAS TO SAY YES. With `tracesSampleRate: 0` Sentry's sampler
 * returns `NOT_RECORD`, and OpenTelemetry's Tracer returns a non-recording
 * span BEFORE constructing the real one — so `onStart`/`onEnd` never fire and
 * the attached processor receives nothing.
 *
 * BUT NOT YES TO EVERYTHING. A blanket `tracesSampleRate: 1` would make every
 * HTTP request, render and query Sentry auto-instruments a recording span, and
 * the attached Langfuse processor would export all of them — burning quota and
 * shipping unrelated request telemetry to a vendor that should only see model
 * calls. So the sampler records ONLY `ai.*` spans plus our boot self-check,
 * and `aiOnlySpanProcessor` filters again on the export side. Two gates,
 * because the sampler is cheap and the filter is exact. (Both review findings
 * on #2079 and #2080.)
 *
 * Transactions that do record are dropped before leaving:
 * `beforeSendTransaction: () => null`. Sentry stays errors-only.
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
          tracesSampler: ({ name }: { name?: string }) => (shouldRecordSpanForLangfuse(name) ? 1 : 0),
          beforeSendTransaction: () => null,
        }
      : {}),
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
