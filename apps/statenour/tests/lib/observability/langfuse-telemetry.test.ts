/**
 * tests/lib/observability/langfuse-telemetry.test.ts · 2026-09-02
 *
 * The per-call telemetry helper and the processor options added in the
 * Langfuse best-practice pass. What the mapping relies on (verified against
 * @langfuse/otel's attribute mapping, not remembered): the AI SDK forwards
 * `experimental_telemetry.metadata.{sessionId,userId,tags}` and `functionId`
 * as the span attributes Langfuse turns into session / user / tags / name.
 * So the helper must spell exactly those keys, and must NOT emit a sessionId
 * key when there is none (an empty string would create a phantom session).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctorArgs = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock("@langfuse/otel", () => ({
  LangfuseSpanProcessor: class {
    constructor(...args: unknown[]) {
      ctorArgs.calls.push(args);
    }
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
    start() {}
  },
}));

const ENV_KEYS = [
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_TRACING_ENVIRONMENT",
  "LANGFUSE_RELEASE",
  "RAILWAY_ENVIRONMENT_NAME",
  "RAILWAY_GIT_COMMIT_SHA",
] as const;
const saved: Record<string, string | undefined> = {};

async function fresh() {
  vi.resetModules();
  const mod = await import("@/lib/observability/langfuse");
  mod.__resetLangfuseForTests();
  return mod;
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  ctorArgs.calls.length = 0;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("langfuseTelemetry()", () => {
  it("is disabled with no started processor, and never enabled for a private-mode turn", async () => {
    const m = await fresh();
    expect(m.langfuseTelemetry({ functionId: "x" }).isEnabled).toBe(false);
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    await m.initLangfuseTracing();
    expect(m.langfuseTelemetry({ functionId: "x" }).isEnabled).toBe(true);
    expect(m.langfuseTelemetry({ functionId: "x", privateMode: true }).isEnabled).toBe(false);
  });

  it("spells the mapped keys: functionId, userId (operator default), sessionId, tags", async () => {
    const m = await fresh();
    const t = m.langfuseTelemetry({ functionId: "nick-chat", sessionId: "conv-1", tags: ["nick-chat", "standard"] });
    expect(t.functionId).toBe("nick-chat");
    expect(t.metadata.userId).toBe("operator");
    expect(t.metadata.sessionId).toBe("conv-1");
    expect(t.metadata.tags).toEqual(["nick-chat", "standard"]);
  });

  it("emits NO sessionId / tags keys when there are none (a blank session id would create a phantom session)", async () => {
    const m = await fresh();
    const t = m.langfuseTelemetry({ functionId: "x", sessionId: undefined, tags: [] });
    expect("sessionId" in t.metadata).toBe(false);
    expect("tags" in t.metadata).toBe(false);
  });

  it("flattens metadata to OTel attribute values: primitives pass, nested objects are JSON-stringified, null/undefined dropped", async () => {
    const m = await fresh();
    const t = m.langfuseTelemetry({
      functionId: "x",
      metadata: { mode: "standard", attempt: 2, ok: true, nested: { a: 1 }, list: ["a", "b"], gone: undefined, nil: null },
    });
    expect(t.metadata.mode).toBe("standard");
    expect(t.metadata.attempt).toBe(2);
    expect(t.metadata.ok).toBe(true);
    expect(t.metadata.nested).toBe('{"a":1}');
    expect(t.metadata.list).toEqual(["a", "b"]);
    expect("gone" in t.metadata).toBe(false);
    expect("nil" in t.metadata).toBe(false);
  });
});

describe("processor options", () => {
  it("constructs LangfuseSpanProcessor with environment, release and a mask (was a bare constructor before 2026-09-02)", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    process.env.RAILWAY_ENVIRONMENT_NAME = "Production";
    process.env.RAILWAY_GIT_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
    const m = await fresh();
    await m.initLangfuseTracing();
    expect(ctorArgs.calls).toHaveLength(1);
    const opts = ctorArgs.calls[0][0] as { environment: string; release: string; mask: (p: { data: unknown }) => unknown };
    expect(opts.environment).toBe("production");
    expect(opts.release).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(typeof opts.mask).toBe("function");
    expect(opts.mask({ data: "key sk-lf-00000000-0000-4000-8000-000000000000 here" })).toBe("key sk-[REDACTED] here");
  });

  it("resolveLangfuseEnvironment: LANGFUSE_TRACING_ENVIRONMENT wins, illegal values collapse to 'default' instead of dropping spans", async () => {
    const m = await fresh();
    expect(m.resolveLangfuseEnvironment({ LANGFUSE_TRACING_ENVIRONMENT: "staging", RAILWAY_ENVIRONMENT_NAME: "production" } as NodeJS.ProcessEnv)).toBe("staging");
    expect(m.resolveLangfuseEnvironment({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe("development");
    expect(m.resolveLangfuseEnvironment({ RAILWAY_ENVIRONMENT_NAME: "PR #12 / preview" } as NodeJS.ProcessEnv)).toBe("pr-12-preview");
    // Langfuse reserves the `langfuse` prefix.
    expect(m.resolveLangfuseEnvironment({ LANGFUSE_TRACING_ENVIRONMENT: "langfuse-prod" } as NodeJS.ProcessEnv)).toBe("default");
    expect(m.resolveLangfuseEnvironment({ LANGFUSE_TRACING_ENVIRONMENT: "x".repeat(60) } as NodeJS.ProcessEnv)).toHaveLength(40);
    expect(m.resolveLangfuseEnvironment({} as NodeJS.ProcessEnv)).toBe("default");
  });

  it("resolveLangfuseRelease: explicit release wins over the Railway SHA; nothing set means undefined", async () => {
    const m = await fresh();
    expect(m.resolveLangfuseRelease({ LANGFUSE_RELEASE: "v1.2.3", RAILWAY_GIT_COMMIT_SHA: "abc" } as NodeJS.ProcessEnv)).toBe("v1.2.3");
    expect(m.resolveLangfuseRelease({ RAILWAY_GIT_COMMIT_SHA: "abc123" } as NodeJS.ProcessEnv)).toBe("abc123");
    expect(m.resolveLangfuseRelease({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("maskLangfuseData: keys and bearer tokens are redacted, ordinary text and non-strings pass through", async () => {
    const m = await fresh();
    expect(m.maskLangfuseData("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123")).toBe("Authorization: Bearer [REDACTED]");
    expect(m.maskLangfuseData("pk-lf-11111111-1111-4111-8111-111111111111")).toBe("pk-[REDACTED]");
    expect(m.maskLangfuseData("the desk-lamp task-list is fine")).toBe("the desk-lamp task-list is fine");
    expect(m.maskLangfuseData(42)).toBe(42);
    expect(m.maskLangfuseData(undefined)).toBeUndefined();
  });
});
