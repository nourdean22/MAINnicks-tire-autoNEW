import { describe, expect, it } from "vitest";
import { resolveSentryDsn } from "@/lib/observability/sentry";

describe("resolveSentryDsn", () => {
  it("accepts a valid DSN", () => {
    const dsn = "https://public@example.ingest.sentry.io/123";
    expect(resolveSentryDsn({ NEXT_PUBLIC_SENTRY_DSN: dsn })).toBe(dsn);
  });

  it("fails closed for missing or placeholder configuration", () => {
    expect(resolveSentryDsn({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(resolveSentryDsn({ SENTRY_DSN: "<paste-sentry-dsn>" })).toBeUndefined();
    expect(resolveSentryDsn({ SENTRY_DSN: "https://public@example.com/123" })).toBeUndefined();
  });
});
