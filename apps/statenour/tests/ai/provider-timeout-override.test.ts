/**
 * Upgrade 5 (background brains finish), 2026-11-01. aiChat's per-attempt ceiling was a
 * flat 45 s (fast) / 100 s (reason) for every caller. Langfuse prod, 7 days: every aborted
 * brain call died exactly AT that ceiling (session-distiller 37 of 70 at 45.0 s,
 * memory-consolidation 29 at 100.0 s, thinking-engine 14 of 21 at 100.0 s), and the
 * successes crowded up against it (consolidation ok max 99.1 s). A caller that runs
 * off-peak needs its own ceiling; chat callers keep the old one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();
vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return { ...actual, generateText: (...args: unknown[]) => generateTextMock(...args) };
});
vi.mock("@/lib/prisma", () => ({ prisma: { aiGeneration: { groupBy: vi.fn().mockResolvedValue([]) } } }));

/** generateText that never answers and records when its signal aborted. */
function hangUntilAbort(abortAfterMs: number[]) {
  generateTextMock.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) => {
    const started = Date.now();
    return new Promise((_, reject) => {
      abortSignal.addEventListener("abort", () => {
        abortAfterMs.push(Date.now() - started);
        reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
      });
    });
  });
}

beforeEach(() => {
  vi.resetModules();
  generateTextMock.mockReset();
  vi.useFakeTimers();
  vi.stubEnv("OLLAMA_API_KEY", "test-ollama-key-is-sufficiently-long-for-validation");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in tests"); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("aiChat · per-call timeoutMs", () => {
  it("CONTROL: a reason call with no override aborts at the 100 s default", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    const aborts: number[] = [];
    hangUntilAbort(aborts);
    const pending = aiChat([{ role: "user", content: "x" }], "reason");
    await vi.advanceTimersByTimeAsync(400_000);
    await pending;
    expect(aborts[0]).toBe(100_000);
  });

  it("timeoutMs replaces the default ceiling for that call", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    const aborts: number[] = [];
    hangUntilAbort(aborts);
    const pending = aiChat([{ role: "user", content: "x" }], "reason", { timeoutMs: 180_000 });
    await vi.advanceTimersByTimeAsync(800_000);
    await pending;
    expect(aborts[0]).toBe(180_000);
  });

  it("a non-positive timeoutMs falls back to the default instead of aborting at once", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    const aborts: number[] = [];
    hangUntilAbort(aborts);
    const pending = aiChat([{ role: "user", content: "x" }], "reason", { timeoutMs: 0 });
    await vi.advanceTimersByTimeAsync(400_000);
    await pending;
    expect(aborts[0]).toBe(100_000);
  });

  it("timeoutMs also lifts the fast lane's 45 s ceiling", async () => {
    const { aiChat } = await import("@/lib/ai/provider");
    const aborts: number[] = [];
    hangUntilAbort(aborts);
    const pending = aiChat([{ role: "user", content: "x" }], "fast", { timeoutMs: 90_000 });
    await vi.advanceTimersByTimeAsync(400_000);
    await pending;
    expect(aborts[0]).toBe(90_000);
  });
});
