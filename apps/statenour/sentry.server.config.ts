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
 * Without this, `langfuse_started` logs happily and Langfuse receives nothing.
 *
 * Fails closed with no valid DSN (`enabled: false`), and every event's free
 * text passes the shared secret mask before export.
 */
export function initSentryServer(openTelemetrySpanProcessors: LangfuseSpanProcessorLike[] = []): void {
  Sentry.init({
    ...sentryInitOptions(),
    ...(openTelemetrySpanProcessors.length > 0 ? { openTelemetrySpanProcessors } : {}),
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
