import * as Sentry from "@sentry/nextjs";
import { resolveSentryDsn } from "@/lib/observability/sentry";

const dsn = resolveSentryDsn();

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  sendDefaultPii: false,
  tracesSampleRate: 0,
});
