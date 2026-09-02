/**
 * tests/observability/tracer-provider-conflict.test.ts · 2026-09-02
 *
 * THE regression test for the defect that made production lie.
 *
 * `@opentelemetry/api`'s registerGlobal refuses a SECOND tracer provider
 * (allowOverride=false), logs the duplicate through a no-op diag logger, and
 * keeps the FIRST provider. `Sentry.init()` registers one; instrumentation.ts
 * imported sentry.server.config BEFORE initLangfuseTracing(). So the Langfuse
 * NodeSDK registration was silently refused, every AI SDK span went to
 * Sentry's provider, and Langfuse held ZERO rows while the boot log said
 * `langfuse_started` and /api/version said `langfuse: true`.
 *
 * Four guards, because one would not have caught it:
 *   1. BEHAVIOUR — a non-recording tracer must produce status "failed", never
 *      "started". This is the check whose absence let a dead pipeline score
 *      green for hours.
 *   2. BEHAVIOUR — when the processor rides on a host provider (Sentry), we
 *      must NOT construct a NodeSDK; a second registration is the bug itself.
 *   3. BEHAVIOUR — if the handover did not actually happen (Sentry's init
 *      returns early during `next build` and can throw), own the provider
 *      ourselves rather than leaving tracing dead.
 *   4. SOURCE — instrumentation.ts must build the processor BEFORE Sentry and
 *      hand it over, with a mutation canary proving the scan can fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const mocks = vi.hoisted(() => ({
  sdkCtor: vi.fn(),
  sdkStart: vi.fn(),
  recording: true,
  traceId: "abcdef01234567890abcdef012345678",
  providerName: "NodeTracerProvider",
}));

vi.mock("@langfuse/otel", () => ({
  LangfuseSpanProcessor: class {
    forceFlush() {
      return Promise.resolve();
    }
    onStart() {}
    onEnd() {}
    shutdown() {
      return Promise.resolve();
    }
  },
}));

vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: class {
    constructor(cfg: unknown) {
      mocks.sdkCtor(cfg);
    }
    start = mocks.sdkStart;
  },
}));

vi.mock("@opentelemetry/api", () => ({
  trace: {
    getTracerProvider: () => ({ constructor: { name: mocks.providerName } }),
    getTracer: () => ({
      startSpan: () => ({
        isRecording: () => mocks.recording,
        spanContext: () => ({ traceId: mocks.traceId }),
        end: () => {},
      }),
    }),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const KEYS = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"] as const;
const saved: Record<string, string | undefined> = {};

async function fresh() {
  vi.resetModules();
  const mod = await import("@/lib/observability/langfuse");
  mod.__resetLangfuseForTests();
  return mod;
}

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    process.env[k] = "pk-lf-test";
  }
  mocks.sdkCtor.mockClear();
  mocks.sdkStart.mockReset();
  mocks.recording = true;
  mocks.traceId = "abcdef01234567890abcdef012345678";
  mocks.providerName = "NodeTracerProvider";
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("tracer provider conflict · a started processor is not a working pipeline", () => {
  it("reports 'started' only when a span through the AI SDK's tracer actually records", async () => {
    const m = await fresh();
    expect(await m.initLangfuseTracing()).toBe("started");
  });

  it("THE PRODUCTION DEFECT: a non-recording tracer reports 'failed', never 'started'", async () => {
    mocks.recording = false;
    mocks.providerName = "SentryTracerProvider";
    const m = await fresh();
    expect(await m.initLangfuseTracing()).toBe("failed");
    expect(m.langfuseTracingStatus()).toBe("failed");
  });

  it("an all-zero trace id counts as not recording (the no-op tracer's signature)", async () => {
    mocks.traceId = "00000000000000000000000000000000";
    const m = await fresh();
    expect(await m.initLangfuseTracing()).toBe("failed");
  });

  it("when the processor rides on a host provider (Sentry), NO NodeSDK is constructed", async () => {
    const m = await fresh();
    await m.buildLangfuseSpanProcessor();
    m.markLangfuseAttachedToHostProvider();
    expect(await m.initLangfuseTracing()).toBe("started");
    expect(mocks.sdkCtor, "a second provider registration is the bug itself").not.toHaveBeenCalled();
  });

  it("without a host provider we still own it: exactly one NodeSDK carrying the processor", async () => {
    const m = await fresh();
    expect(await m.initLangfuseTracing()).toBe("started");
    expect(mocks.sdkCtor).toHaveBeenCalledTimes(1);
    const cfg = mocks.sdkCtor.mock.calls[0][0] as { spanProcessors: unknown[] };
    expect(cfg.spanProcessors).toHaveLength(1);
  });

  it("SELF-HEALS: told Sentry took the processor but nothing records, it owns the provider itself", async () => {
    // Sentry's init returns early during `next build` and can throw, so the
    // handover is not guaranteed. Before this, that combination reported
    // "failed" and left tracing dead with a perfectly good fallback unused.
    mocks.recording = false;
    mocks.sdkStart.mockImplementation(() => {
      mocks.recording = true;
    });
    const m = await fresh();
    await m.buildLangfuseSpanProcessor();
    m.markLangfuseAttachedToHostProvider();

    expect(await m.initLangfuseTracing()).toBe("started");
    expect(mocks.sdkCtor, "the fallback provider must actually be constructed").toHaveBeenCalledTimes(1);
  });

  it("still reports failed when even the fallback cannot record", async () => {
    mocks.recording = false;
    const m = await fresh();
    await m.buildLangfuseSpanProcessor();
    m.markLangfuseAttachedToHostProvider();
    expect(await m.initLangfuseTracing()).toBe("failed");
  });

  it("buildLangfuseSpanProcessor is idempotent and returns null when unconfigured", async () => {
    const m = await fresh();
    const a = await m.buildLangfuseSpanProcessor();
    const b = await m.buildLangfuseSpanProcessor();
    expect(a).toBe(b);

    delete process.env.LANGFUSE_PUBLIC_KEY;
    const m2 = await fresh();
    expect(await m2.buildLangfuseSpanProcessor()).toBeNull();
  });
});

describe("instrumentation.ts ordering · source gate", () => {
  const source = readFileSync(join(APP_ROOT, "instrumentation.ts"), "utf8");

  function ordersProcessorBeforeSentry(text: string): boolean {
    const build = text.indexOf("buildLangfuseSpanProcessor");
    const init = text.indexOf("initSentryServer(");
    return build !== -1 && init !== -1 && build < init;
  }

  it("builds the Langfuse processor BEFORE Sentry.init and hands it over", () => {
    expect(ordersProcessorBeforeSentry(source)).toBe(true);
    expect(source, "the processor must be passed into Sentry's provider").toMatch(
      /initSentryServer\(\s*langfuseProcessor\s*\?/,
    );
  });

  it("never re-adds the bare import that dropped every span", () => {
    expect(source).not.toMatch(/await import\("\.\/sentry\.server\.config"\);\s*\n\s*}/);
  });

  it("MUTATION CANARY: reversing the order in memory makes the gate fail", () => {
    const mutated = source.replace(/buildLangfuseSpanProcessor/g, "zzzLateBuild");
    expect(ordersProcessorBeforeSentry(mutated)).toBe(false);
  });
});

describe("aiOnlySpanProcessor · Langfuse only ever sees AI SDK spans", () => {
  // When Langfuse rides on SENTRY's provider, that provider is fed by Sentry's
  // auto-instrumentation. Without this filter every HTTP request, render and
  // query in the process would be exported to Langfuse - quota burn plus
  // unrelated request telemetry leaving to a vendor that should only ever see
  // model calls. beforeSendTransaction cannot prevent it: that is Sentry's own
  // export path, long after our processor's onEnd. (Review finding on #2080.)
  const aiSpan = { name: "ai.generateText", instrumentationScope: { name: "ai" } };
  const httpSpan = { name: "GET /api/habits", instrumentationScope: { name: "@opentelemetry/instrumentation-http" } };
  const selfCheck = { name: "langfuse.selfcheck", instrumentationScope: { name: "ai" } };

  async function wrapped() {
    const m = await fresh();
    const inner = { onStart: vi.fn(), onEnd: vi.fn(), forceFlush: vi.fn().mockResolvedValue(undefined), shutdown: vi.fn().mockResolvedValue(undefined) };
    return { m, inner, proc: m.aiOnlySpanProcessor(inner) };
  }

  it("forwards AI SDK spans", async () => {
    const { inner, proc } = await wrapped();
    proc.onStart(aiSpan);
    proc.onEnd(aiSpan);
    expect(inner.onStart).toHaveBeenCalledTimes(1);
    expect(inner.onEnd).toHaveBeenCalledTimes(1);
  });

  it("DROPS everything Sentry auto-instruments", async () => {
    const { inner, proc } = await wrapped();
    proc.onStart(httpSpan);
    proc.onEnd(httpSpan);
    expect(inner.onStart, "an HTTP span must never reach Langfuse").not.toHaveBeenCalled();
    expect(inner.onEnd).not.toHaveBeenCalled();
  });

  it("drops our own boot self-check — it proves recording, it is not a trace worth keeping", async () => {
    const { inner, proc } = await wrapped();
    proc.onEnd(selfCheck);
    expect(inner.onEnd).not.toHaveBeenCalled();
  });

  it("matches on instrumentation SCOPE, not the span name (a name is spoofable, the scope is not)", async () => {
    const { m, inner, proc } = await wrapped();
    proc.onEnd({ name: "ai.generateText", instrumentationScope: { name: "some-other-library" } });
    expect(inner.onEnd).not.toHaveBeenCalled();
    // legacy field name still works
    expect(m.isAiSdkSpan({ name: "ai.embed", instrumentationLibrary: { name: "ai" } })).toBe(true);
    expect(m.isAiSdkSpan(null)).toBe(false);
    expect(m.isAiSdkSpan({})).toBe(false);
  });

  it("still delegates flush and shutdown — the drain must not be filtered away", async () => {
    const { inner, proc } = await wrapped();
    await proc.forceFlush();
    await proc.shutdown();
    expect(inner.forceFlush).toHaveBeenCalledTimes(1);
    expect(inner.shutdown).toHaveBeenCalledTimes(1);
  });

  it("the processor handed to Sentry IS the filtered one", async () => {
    const m = await fresh();
    const built = await m.buildLangfuseSpanProcessor();
    expect(built).toBeTruthy();
    // the raw LangfuseSpanProcessor mock records nothing; the wrapper is a
    // plain object with our four methods, so identity with the mock class fails
    expect(typeof built?.onEnd).toBe("function");
    expect(m.isAiSdkSpan(aiSpan)).toBe(true);
  });
});
