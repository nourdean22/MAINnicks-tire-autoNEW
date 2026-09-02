import * as Sentry from "@sentry/nextjs";

// Next.js loads this file in the browser before the application mounts.
import "./sentry.client.config";

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
