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
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const init = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ init }));

import { initSentryServer } from "../../../sentry.server.config";

type InitOptions = {
  enabled: boolean;
  tracesSampleRate: number;
  tracesSampler?: (ctx: { name?: string }) => number;
  openTelemetrySpanProcessors?: unknown[];
  beforeSendTransaction?: () => unknown;
  beforeSend?: (e: unknown) => unknown;
  sendDefaultPii: boolean;
};

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

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
  it("roots must RECORD, or their AI children never will", () => {
    initSentryServer([processor]);
    const opts = optionsOf();
    expect(opts.openTelemetrySpanProcessors).toEqual([processor]);
    expect(
      opts.tracesSampleRate,
      "rate 0 makes the sampler return NOT_RECORD and no processor ever runs",
    ).toBe(1);
  });

  it("THE DEPLOYED REGRESSION: no name-based tracesSampler — Sentry consults it for ROOT SPANS ONLY", () => {
    // @sentry/opentelemetry's sampler:
    //   if (!isRootSpan) return { decision: parentSampled ? RECORD_AND_SAMPLED : NOT_RECORD }
    // Children inherit the root's decision verbatim, so a sampler that
    // rejected "POST /api/..." silently killed every `ai.generateText` nested
    // inside a request — while the BOOT SELF-CHECK, which is a root, still
    // recorded and reported the pipeline healthy. Shipped, probed, caught.
    // Containment is the export filter's job, never the sampler's.
    initSentryServer([processor]);
    expect(
      optionsOf().tracesSampler,
      "a name-based sampler only sees roots and starves the AI children under them",
    ).toBeUndefined();
  });

  it("...and none of those recorded transactions reach Sentry — errors only", () => {
    initSentryServer([processor]);
    expect(typeof optionsOf().beforeSendTransaction).toBe("function");
    expect(optionsOf().beforeSendTransaction?.()).toBeNull();
  });

  it("containment lives on the EXPORT side: the config points at the AI-only filter", () => {
    const config = readFileSync(join(APP_ROOT, "sentry.server.config.ts"), "utf8");
    expect(config, "the reason sampling can be broad must stay written down").toMatch(/aiOnlySpanProcessor/);
    const langfuse = readFileSync(join(APP_ROOT, "lib", "observability", "langfuse.ts"), "utf8");
    expect(langfuse).toMatch(/export function aiOnlySpanProcessor/);
  });

  it("with NO processor, tracing stays off entirely — we do not pay for spans nobody reads", () => {
    initSentryServer();
    const opts = optionsOf();
    expect(opts.tracesSampleRate).toBe(0);
    expect(opts.tracesSampler).toBeUndefined();
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
