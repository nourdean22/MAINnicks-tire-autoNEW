import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent, sentryInitOptions } from "@/lib/observability/sentry";

/**
 * Edge runtime (middleware) Sentry init, called from instrumentation.ts.
 * No Langfuse processor here: `@langfuse/otel` and `@opentelemetry/sdk-node`
 * are Node-only, and the edge pass must compile with neither.
 *
 * Same fail-closed + masking stance as the Node config.
 */
export function initSentryEdge(): void {
  Sentry.init({
    ...sentryInitOptions(),
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
