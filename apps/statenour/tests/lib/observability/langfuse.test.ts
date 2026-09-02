/**
 * 2026-08-25 · Langfuse init gating canaries.
 *
 * The braintrust-wrap precedent: a status helper that reported
 * key-presence instead of real outcome, and a wrapper nothing called.
 * These tests pin the OPPOSITE contract on the replacement:
 *   · no keys → skipped, telemetry gate closed
 *   · keys + clean start → started, gate open, private turns still closed
 *   · init failure → failed (fail-open for chat, gate CLOSED — never
 *     "active" on a dead pipeline)
 *   · idempotent init, flush reaches the processor
 *
 * @langfuse/otel + @opentelemetry/sdk-node are vi.mocked: the worktree
 * cannot install (junctioned node_modules), and the REAL wire behavior
 * is proven separately by scripts/probe-langfuse-trace.ts (7/7 checks,
 * receipt in PR).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  forceFlush: vi.fn().mockResolvedValue(undefined),
  processorCtor: vi.fn(),
  sdkStart: vi.fn(),
  sdkCtor: vi.fn(),
}));

vi.mock("@langfuse/otel", () => ({
  LangfuseSpanProcessor: class {
    constructor() {
      mocks.processorCtor();
    }
    forceFlush = mocks.forceFlush;
  },
}));

vi.mock("@opentelemetry/api", () => ({
  // 2026-09-02 · initLangfuseTracing now PROVES a span records before it
  // reports "started" (the production defect: Sentry owned the global tracer
  // provider, our NodeSDK registration was silently refused, and Langfuse got
  // nothing while the boot log said started). A recording tracer here is what
  // the happy path looks like; tests/observability/tracer-provider-conflict.test.ts
  // owns the non-recording case.
  trace: {
    getTracerProvider: () => ({ constructor: { name: "NodeTracerProvider" } }),
    getTracer: () => ({
      startSpan: () => ({
        isRecording: () => true,
        spanContext: () => ({ traceId: "abcdef01234567890abcdef012345678" }),
        end: () => {},
      }),
    }),
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

import {
  initLangfuseTracing,
  isLangfuseConfigured,
  isLangfuseTelemetryEnabled,
  langfuseTracingStatus,
  flushLangfuseTraces,
  __resetLangfuseForTests,
} from "@/lib/observability/langfuse";

const ENV_KEYS = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  __resetLangfuseForTests();
  mocks.forceFlush.mockClear();
  mocks.processorCtor.mockClear();
  mocks.sdkStart.mockClear();
  mocks.sdkCtor.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetLangfuseForTests();
});

describe("initLangfuseTracing", () => {
  it("skips with no keys — gate closed, nothing constructed", async () => {
    expect(isLangfuseConfigured()).toBe(false);
    expect(await initLangfuseTracing()).toBe("skipped");
    expect(isLangfuseTelemetryEnabled(false)).toBe(false);
    expect(mocks.processorCtor).not.toHaveBeenCalled();
    expect(mocks.sdkStart).not.toHaveBeenCalled();
  });

  it("starts with keys — gate open for normal turns, CLOSED for private turns", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    expect(await initLangfuseTracing()).toBe("started");
    expect(langfuseTracingStatus()).toBe("started");
    expect(mocks.processorCtor).toHaveBeenCalledTimes(1);
    expect(mocks.sdkStart).toHaveBeenCalledTimes(1);
    expect(isLangfuseTelemetryEnabled(false)).toBe(true);
    expect(isLangfuseTelemetryEnabled(undefined)).toBe(true);
    // Privacy gate: spans carry prompt + completion content; a private
    // turn must never be traceable no matter how healthy the pipeline is.
    expect(isLangfuseTelemetryEnabled(true)).toBe(false);
  });

  it("is idempotent — a second init returns the settled status without re-constructing", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    await initLangfuseTracing();
    expect(await initLangfuseTracing()).toBe("started");
    expect(mocks.processorCtor).toHaveBeenCalledTimes(1);
    expect(mocks.sdkStart).toHaveBeenCalledTimes(1);
  });

  it("fails OPEN on init error — status 'failed', gate stays closed, no throw", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    mocks.sdkStart.mockImplementationOnce(() => {
      throw new Error("boot-time OTel conflict");
    });
    expect(await initLangfuseTracing()).toBe("failed");
    // The isBraintrustActive() bug class: key presence must NOT read as
    // active when the pipeline never came up.
    expect(isLangfuseTelemetryEnabled(false)).toBe(false);
  });

  it("blank-string keys count as unconfigured", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "   ";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    expect(isLangfuseConfigured()).toBe(false);
    expect(await initLangfuseTracing()).toBe("skipped");
  });
});

describe("SIGTERM drain survives a torn-down processor (the 4-red-PRs defect)", () => {
  it("the handler must not throw when forceFlush() returns undefined (synthetic teardown)", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    const before = process.listeners("SIGTERM");
    await initLangfuseTracing();
    const added = process.listeners("SIGTERM").filter((l) => !before.includes(l));
    expect(added.length).toBe(1);
    try {
      // Synthetic teardown: vitest's afterEach mockClear/teardown leaves
      // the captured mock returning undefined — the exact state the
      // process-level handler sees when SIGTERM arrives after the test
      // that registered it. A bare `.catch` on that call THROWS
      // (deterministic `Errors 1 error` across four sibling PRs);
      // Promise.resolve() must absorb it.
      mocks.forceFlush.mockReturnValueOnce(undefined as never);
      expect(() => (added[0] as () => void)()).not.toThrow();
      // Positive control: the same handler DID reach forceFlush — the
      // no-throw above is about absorbing the return, not about the
      // handler being an inert stub.
      expect(mocks.forceFlush).toHaveBeenCalledTimes(1);
    } finally {
      // The accumulation of stale SIGTERM handlers across tests is the
      // defect's delivery vector — never leak this one.
      process.removeListener("SIGTERM", added[0] as () => void);
    }
  });
});

describe("cross-bundle status visibility", () => {
  it("a FRESH module instance reads the status an earlier instance set (the instrumentation-vs-app-bundle split)", async () => {
    // Prod bug this pins (found on /system the day the module shipped):
    // Next compiles instrumentation.ts as its own entry, so this module
    // exists twice; module-level state left healthSummary reading
    // "uninitialized" while boot logs said "skipped". State lives on
    // globalThis now — a re-imported instance must see the settled
    // status WITHOUT running init itself.
    await initLangfuseTracing(); // no keys in env → "skipped"
    expect(langfuseTracingStatus()).toBe("skipped");
    vi.resetModules(); // simulate the second bundle: fresh module scope
    const fresh = await import("@/lib/observability/langfuse");
    expect(fresh.langfuseTracingStatus()).toBe("skipped");
  });
});

describe("flushLangfuseTraces", () => {
  it("drains the live processor, and is a no-op before init", async () => {
    await flushLangfuseTraces();
    expect(mocks.forceFlush).not.toHaveBeenCalled();
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    await initLangfuseTracing();
    await flushLangfuseTraces();
    expect(mocks.forceFlush).toHaveBeenCalledTimes(1);
  });
});
