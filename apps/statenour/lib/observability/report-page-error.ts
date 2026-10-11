import * as Sentry from "@sentry/nextjs";
import { reportClientError } from "@/components/ui/client-error-telemetry";

/**
 * The one call `app/(mastery)/error.tsx` makes. That file is the inner Next boundary, so it catches every page
 * render error under (mastery) before the layout's <ErrorBoundary> can; without this the error reached only the
 * browser console. Same two sinks as the other boundaries: /api/errors (via recordClientError) and Sentry.
 */
export function reportPageError(error: Error & { digest?: string }): void {
  reportClientError(error, { boundary: "mastery.error" });
  Sentry.captureException(error, {
    tags: { boundary: "mastery.error" },
    ...(error.digest ? { extra: { digest: error.digest } } : {}),
  });
}
