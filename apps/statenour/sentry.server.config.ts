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
 * AND THE SAMPLER HAS TO SAY YES. With `tracesSampleRate: 0` Sentry's sampler
 * returns `NOT_RECORD`, and OpenTelemetry's Tracer returns a non-recording
 * span BEFORE constructing the real one — so `onStart`/`onEnd` never fire and
 * the attached processor receives nothing. Sharing the provider is necessary
 * but not sufficient; the spans must actually record. (Caught in review on
 * #2079 — the first fix would have left Langfuse just as dead.)
 *
 * So when a processor is attached we sample every span and drop the resulting
 * transactions before they leave: `beforeSendTransaction: () => null`. Sentry
 * stays errors-only, Langfuse gets its spans. With no processor we keep
 * tracing off entirely.
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
          // Spans must RECORD for the attached processor to see them...
          tracesSampleRate: 1,
          // ...but none of them are sent to Sentry. Errors only, as before.
          beforeSendTransaction: () => null,
        }
      : {}),
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
