/**
 * `withLangfuseTraceName` — the one identity `langfuseTelemetry()` cannot set.
 *
 * WHY THIS EXISTS. `functionId` names the OBSERVATION
 * (`memory-consolidation:ai.generateText`), never the trace. Measured against
 * `GET /api/public/traces` on production 2026-09-17: **0 of 50 traces carried
 * a name**, while `userId` landed 50/50, `tags` 47/50 and `metadata` on every
 * row. Three of four identity channels worked; one specific mapping claim —
 * written in two separate docstrings — was false.
 *
 * ⚠⚠ THE LOAD-BEARING TEST HERE IS THE DOUBLE-EXECUTION ONE. This wrapper sits
 * around every brain/chat LLM call. A naive `catch { return fn(); }` would
 * re-issue a request that had ALREADY been sent whenever the tracing SDK threw
 * late — duplicate spend and duplicate side effects, caused by code whose only
 * job is to attach a label. Cheap to get wrong, expensive to notice.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  propagateAttributes: vi.fn(),
  status: { value: "started" as string },
}));

// The module resolves `@langfuse/tracing` through a local const specifier so
// tsc survives a checkout without the package; the mock matches that module id.
vi.mock("@langfuse/tracing", () => ({
  propagateAttributes: mocks.propagateAttributes,
}));

vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { withLangfuseTraceName, langfuseTracingStatus } from "@/lib/observability/langfuse";

/** Put the module-global tracing state into "started" so the wrapper engages. */
function forceStarted() {
  const g = globalThis as typeof globalThis & { __langfuseTracing?: { status: string; processor: null } };
  g.__langfuseTracing = { status: "started", processor: null };
}
function forceUninitialized() {
  const g = globalThis as typeof globalThis & { __langfuseTracing?: { status: string; processor: null } };
  g.__langfuseTracing = { status: "uninitialized", processor: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: behave like the real thing — run the callback inside the context.
  mocks.propagateAttributes.mockImplementation((_params: unknown, cb: () => unknown) => cb());
  forceStarted();
});

describe("withLangfuseTraceName", () => {
  // POSITIVE CONTROL — if the wrapper silently stopped calling through, every
  // assertion about *what* it passes would still pass on a never-invoked spy.
  it("returns the callback's value and calls it exactly once", async () => {
    const fn = vi.fn(async () => "answer");
    const out = await withLangfuseTraceName({ traceName: "coach-goal" }, fn);
    expect(out).toBe("answer");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mocks.propagateAttributes).toHaveBeenCalledTimes(1);
  });

  it("sets traceName — the field that was missing in production", async () => {
    await withLangfuseTraceName(
      { traceName: "memory-consolidation", tags: ["brain"], metadata: { source: "brain" } },
      async () => "ok",
    );
    const params = mocks.propagateAttributes.mock.calls[0][0];
    expect(params.traceName).toBe("memory-consolidation");
    expect(params.tags).toEqual(["brain"]);
    expect(params.metadata).toEqual({ source: "brain" });
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // THE EXPENSIVE ONE. If propagateAttributes throws AFTER running the
  // callback, the callback must NOT run again — that would re-issue a paid LLM
  // request. The error belongs to the caller and is rethrown untouched.
  it("CANARY — never re-runs the callback when the failure came from inside it", async () => {
    const fn = vi.fn(async () => {
      throw new Error("provider exploded");
    });
    mocks.propagateAttributes.mockImplementation((_p: unknown, cb: () => unknown) => cb());

    await expect(withLangfuseTraceName({ traceName: "x" }, fn)).rejects.toThrow("provider exploded");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // The other half: a failure BEFORE the callback ran (bad params, missing
  // package) must still produce an answer — naming a trace cannot cost a turn.
  it("falls back to a bare call when the tracing SDK fails before invoking it", async () => {
    const fn = vi.fn(async () => "answer");
    mocks.propagateAttributes.mockImplementation(() => {
      throw new Error("tracing sdk unavailable");
    });

    const out = await withLangfuseTraceName({ traceName: "x" }, fn);
    expect(out).toBe("answer");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("skips the wrapper entirely when tracing never started — zero overhead", async () => {
    forceUninitialized();
    expect(langfuseTracingStatus()).toBe("uninitialized");
    const fn = vi.fn(async () => "answer");
    const out = await withLangfuseTraceName({ traceName: "x" }, fn);
    expect(out).toBe("answer");
    expect(mocks.propagateAttributes).not.toHaveBeenCalled();
  });

  it("skips when the name is empty rather than propagating a blank trace name", async () => {
    const fn = vi.fn(async () => "answer");
    await withLangfuseTraceName({ traceName: "" }, fn);
    expect(mocks.propagateAttributes).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // Propagated metadata is string-only and capped by the SDK; non-strings are
  // dropped with a warning, so they are coerced here instead of going missing.
  it("coerces non-string metadata and caps long values", async () => {
    await withLangfuseTraceName(
      { traceName: "x", metadata: { n: 42, obj: { a: 1 }, long: "z".repeat(500), skip: null } },
      async () => "ok",
    );
    const md = mocks.propagateAttributes.mock.calls[0][0].metadata as Record<string, string>;
    expect(md.n).toBe("42");
    expect(md.obj).toBe('{"a":1}');
    expect(md.long).toHaveLength(200);
    expect("skip" in md).toBe(false);
  });

  it("caps the trace name at the SDK's 200-character limit", async () => {
    await withLangfuseTraceName({ traceName: "a".repeat(400) }, async () => "ok");
    expect(mocks.propagateAttributes.mock.calls[0][0].traceName).toHaveLength(200);
  });
});
