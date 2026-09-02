import * as Sentry from "@sentry/nextjs";

/**
 * The one call `app/global-error.tsx` makes. Split out so a unit test can pin
 * the wiring (the root boundary is a client component whose effect does not
 * run under the SSR render the component tests use).
 *
 * Returns the Sentry event id (undefined when the SDK is disabled).
 */
export function reportGlobalError(error: Error & { digest?: string }): string | undefined {
  return Sentry.captureException(error, {
    tags: { boundary: "global-error" },
    ...(error.digest ? { extra: { digest: error.digest } } : {}),
  });
}
