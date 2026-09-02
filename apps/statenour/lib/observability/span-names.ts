/**
 * lib/observability/span-names.ts · 2026-09-02
 *
 * Two string constants shared by the Langfuse processor and the Sentry
 * sampler. They live in their own module with ZERO imports on purpose.
 *
 * `lib/observability/sentry.ts` is loaded by `sentry.client.config.ts`, so it
 * ends up in the BROWSER bundle. Importing these from `langfuse.ts` instead
 * dragged that module's Node-only `@opentelemetry/sdk-node` reference into the
 * client graph and broke `next build` with module-not-found — caught by the
 * pre-push build gate. Keep this file dependency-free.
 */

/** The tracer name the Vercel AI SDK uses (`trace.getTracer("ai")`, ai@6 dist:2362). */
export const AI_SDK_TRACER_NAME = "ai";

/** Our own boot probe span, emitted on that same tracer — never exported to Langfuse. */
export const LANGFUSE_SELFCHECK_SPAN_NAME = "langfuse.selfcheck";
