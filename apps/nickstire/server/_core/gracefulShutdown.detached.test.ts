/**
 * F5 · work a webhook starts AFTER it answered 200 is a drain source.
 *
 * Positive control (origin/main 91ab0048, before this change): the module
 * exported no trackDetached/detachedWork, so every test here failed at import;
 * behaviourally, _core/index.ts drained only cron, the SMS queue cycle and
 * open HTTP requests, so a SIGTERM right after an ack exited 0 with the
 * detached work still running. The route-level proofs are
 * routes/webhooks/vapi.call-end-drain.test.ts and
 * routes/webhooks/smsGateway.answer-drain.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGracefulShutdown, detachedWork, trackDetached } from "./gracefulShutdown";

function deferred() {
  let resolveFn!: () => void;
  let rejectFn!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolveFn = res; rejectFn = rej; });
  return { promise, resolve: () => resolveFn(), reject: (e: Error) => rejectFn(e) };
}

function harness(graceMs = 25_000) {
  const exit = vi.fn();
  const log = { info: vi.fn(), warn: vi.fn() };
  const shutdown = createGracefulShutdown({ graceMs, exit, log, stops: [], sources: [detachedWork] });
  return { exit, log, shutdown };
}

describe("trackDetached · the drain waits for post-ack work", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("CONTROL: no detached work → shutdown exits 0 at once, no timer needed", async () => {
    expect(detachedWork.pending()).toEqual([]);
    const { exit, shutdown } = harness();
    await shutdown();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("post-ack work still running at SIGTERM holds the exit until it finishes, then exits 0", async () => {
    const work = deferred();
    const tracked = trackDetached("vapi:end-of-call", work.promise);
    expect(tracked).toBe(work.promise); // same promise: the call site keeps its own .catch
    expect(detachedWork.pending()).toEqual(["vapi:end-of-call"]);

    const { exit, shutdown } = harness();
    const done = shutdown();
    try {
      await vi.advanceTimersByTimeAsync(10_000);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      work.resolve();
    }
    await done;
    expect(exit).toHaveBeenCalledWith(0);
    expect(detachedWork.pending()).toEqual([]);
  });

  it("work that rejects still counts as settled — the drain never rejects", async () => {
    const work = deferred();
    trackDetached("sms-gateway:answer", work.promise).catch(() => undefined);
    const { exit, shutdown } = harness();
    const done = shutdown();
    work.reject(new Error("provider down"));
    await done;
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("work outliving the budget: exit 1 at the budget, naming it", async () => {
    const work = deferred();
    trackDetached("sms-gateway:answer", work.promise);
    const { exit, log, shutdown } = harness(5_000);
    const done = shutdown();
    try {
      await vi.advanceTimersByTimeAsync(5_000);
      await done;
      expect(exit).toHaveBeenCalledWith(1);
      expect(String(log.warn.mock.calls.at(-1)?.[0])).toContain("detached:sms-gateway:answer");
    } finally {
      work.resolve();
      await work.promise;
    }
  });
});

describe("the production drain includes detachedWork", () => {
  it("_core/index.ts lists detachedWork among the SIGTERM drain sources", () => {
    // The behaviour is pinned above; this pins that the server actually waits
    // on it — a tracker nobody drains is a writer with no reader.
    const src = readFileSync(resolve(__dirname, "index.ts"), "utf8");
    const start = src.indexOf("const shutdownOnSigterm = createGracefulShutdown(");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("\n});", start));
    const sources = block.slice(block.indexOf("sources: ["));
    expect(sources).toMatch(/^\s*detachedWork,\s*$/m);
  });
});
