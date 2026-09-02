import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent, sentryInitOptions } from "@/lib/observability/sentry";

// Browser. Next inlines only NEXT_PUBLIC_* variables, so the client sees its
// own view of env; the release is injected at build time by withSentryConfig
// (next.config.ts), not resolved here. Fails closed without a valid DSN.
Sentry.init({
  ...sentryInitOptions({
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  }),
  beforeSend: (event) => scrubSentryEvent(event),
});
