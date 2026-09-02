/**
 * tests/lib/observability/sentry-server-init.test.ts · 2026-09-02
 *
 * The second half of the provider-conflict fix, and the one review caught.
 *
 * Sharing Sentry's tracer provider is NECESSARY BUT NOT SUFFICIENT. With
 * `tracesSampleRate: 0` Sentry's sampler returns `NOT_RECORD`; OpenTelemetry's
 * Tracer then returns a non-recording span BEFORE constructing the real one
 * (`sdk-trace-base/Tracer.js`: the NOT_RECORD branch returns
 * `wrapSpanContext(...)` above `new SpanImpl(...)`), so `onStart`/`onEnd`
 * never fire and the attached Langfuse processor receives nothing. The first
 * version of this fix would have left Langfuse exactly as dead.
 *
 * So: when a processor is attached, spans must be sampled — and the resulting
 * transactions must NOT be shipped to Sentry, which stays errors-only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ init }));

import { initSentryServer } from "../../../sentry.server.config";

type InitOptions = {
  enabled: boolean;
  tracesSampleRate: number;
  openTelemetrySpanProcessors?: unknown[];
  beforeSendTransaction?: () => unknown;
  beforeSend?: (e: unknown) => unknown;
  sendDefaultPii: boolean;
};

const processor = { forceFlush: async () => {}, onStart() {}, onEnd() {}, shutdown: async () => {} };
const optionsOf = () => init.mock.calls[0][0] as InitOptions;

const saved = process.env.SENTRY_DSN;
beforeEach(() => {
  init.mockClear();
  process.env.SENTRY_DSN = "https://public@o1.ingest.us.sentry.io/2";
});
afterEach(() => {
  if (saved === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = saved;
});

describe("initSentryServer · sampling when a foreign processor rides along", () => {
  it("THE REVIEW FINDING: with a processor attached, spans must RECORD (rate > 0)", () => {
    initSentryServer([processor]);
    const opts = optionsOf();
    expect(opts.openTelemetrySpanProcessors).toEqual([processor]);
    expect(
      opts.tracesSampleRate,
      "rate 0 makes the sampler return NOT_RECORD and the attached processor never sees a span",
    ).toBeGreaterThan(0);
  });

  it("...but none of those transactions are shipped to Sentry — errors only", () => {
    initSentryServer([processor]);
    const opts = optionsOf();
    expect(typeof opts.beforeSendTransaction).toBe("function");
    expect(opts.beforeSendTransaction?.(), "every sampled transaction is dropped before export").toBeNull();
  });

  it("with NO processor, tracing stays off entirely — we do not pay for spans nobody reads", () => {
    initSentryServer();
    const opts = optionsOf();
    expect(opts.tracesSampleRate).toBe(0);
    expect("openTelemetrySpanProcessors" in opts).toBe(false);
    expect(opts.beforeSendTransaction).toBeUndefined();
  });

  it("keeps the fail-closed and privacy stance in both shapes", () => {
    initSentryServer([processor]);
    expect(optionsOf().sendDefaultPii).toBe(false);
    expect(optionsOf().enabled).toBe(true);
    expect(typeof optionsOf().beforeSend).toBe("function");

    init.mockClear();
    delete process.env.SENTRY_DSN;
    initSentryServer([processor]);
    expect(optionsOf().enabled, "no DSN still disables the SDK entirely").toBe(false);
  });
});
