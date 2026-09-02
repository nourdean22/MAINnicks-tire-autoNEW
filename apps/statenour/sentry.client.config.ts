import * as Sentry from "@sentry/nextjs";
import { resolveSentryDsn } from "@/lib/observability/sentry";

const dsn = resolveSentryDsn({ NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN });

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  sendDefaultPii: false,
  tracesSampleRate: 0,
});
