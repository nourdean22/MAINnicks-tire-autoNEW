/**
 * Q-10 · the SIGTERM drain, with fake timers and injected dependencies.
 *
 * Positive control (recorded on origin/main ca45b9f, before this change):
 * the module did not exist — the handler was an inline closure in
 * _core/index.ts that force-exited after a fixed 10 s — so every test here
 * failed at import. The runner-side gate ("no job starts after SIGTERM") is
 * pinned against the real cron runner in cron/shutdownDrain.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  createGracefulShutdown,
  resolveShutdownGraceMs,
  trackHttpRequests,
  type DrainSource,
} from "./gracefulShutdown";

/** A drain source backed by a set of named, manually-settled runs. */
function fakeSource(label: string) {
  const runs = new Map<string, () => void>();
  let waiters: Array<() => void> = [];
  const source: DrainSource = {
    label,
    pending: () => [...runs.keys()],
    settled: () => new Promise<void>((resolve) => {
      if (!runs.size) return resolve();
      waiters.push(resolve);
    }),
  };
  return {
    source,
    start(name: string) { runs.set(name, () => undefined); },
    finish(name: string) {
      runs.delete(name);
      if (!runs.size) { const w = waiters; waiters = []; w.forEach((fn) => fn()); }
    },
  };
}

function harness(graceMs = 25_000) {
  const exit = vi.fn();
  const log = { info: vi.fn(), warn: vi.fn() };
  const cron = fakeSource("cron");
  const stopped: string[] = [];
  const shutdown = createGracefulShutdown({
    graceMs,
    exit,
    log,
    stops: [
      { label: "scheduler", run: () => { stopped.push("scheduler"); } },
      { label: "broken", run: () => { throw new Error("boom"); } },
      { label: "sms", run: () => { stopped.push("sms"); } },
    ],
    sources: [cron.source],
  });
  return { exit, log, cron, stopped, shutdown };
}

describe("createGracefulShutdown", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("stops new starts at once, lets an in-flight job finish, then exits 0", async () => {
    const h = harness();
    h.cron.start("reel-pipeline");
    const done = h.shutdown();

    // every stop ran immediately, and one throwing did not block the rest
    expect(h.stopped).toEqual(["scheduler", "sms"]);
    expect(h.log.warn).toHaveBeenCalledWith("[shutdown] broken stop failed", expect.anything());

    // 20 s in: the job is still running, so nothing has exited — the old
    // handler would have force-exited at 10 s
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.exit).not.toHaveBeenCalled();

    h.cron.finish("reel-pipeline");
    await done;
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it("exits 0 immediately when nothing is running", async () => {
    const h = harness();
    await h.shutdown();
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it("abandons a stuck job at the budget, exits 1 and names it in the log", async () => {
    const h = harness(25_000);
    h.cron.start("enrich-customer-data");
    const done = h.shutdown();

    await vi.advanceTimersByTimeAsync(24_999);
    expect(h.exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(1);
    const [msg, meta] = h.log.warn.mock.calls.find(([m]) => String(m).includes("grace budget"))!;
    expect(msg).toContain("cron:enrich-customer-data");
    expect(meta).toMatchObject({ running: ["cron:enrich-customer-data"], errorId: "SHUTDOWN_DRAIN_TIMEOUT" });
  });

  it("ignores a second SIGTERM while draining — no re-run of stops, no second exit, budget not reset", async () => {
    const h = harness(25_000);
    h.cron.start("pulse-job");
    const first = h.shutdown();
    await vi.advanceTimersByTimeAsync(15_000);

    await h.shutdown(); // second signal
    expect(h.stopped).toEqual(["scheduler", "sms"]);
    expect(h.log.info).toHaveBeenCalledWith("[shutdown] signal received again while draining — ignored");

    // the ORIGINAL budget still applies: 10 s more, not 25
    await vi.advanceTimersByTimeAsync(10_000);
    await first;
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(1);
  });
});

describe("createGracefulShutdown · a broken source", () => {
  it("still reaches exit() when a source throws synchronously", async () => {
    const exit = vi.fn();
    const shutdown = createGracefulShutdown({
      graceMs: 25_000,
      exit,
      log: { info: vi.fn(), warn: vi.fn() },
      stops: [],
      sources: [{
        label: "broken",
        pending: () => { throw new Error("module failed to load"); },
        settled: () => { throw new Error("module failed to load"); },
      }],
    });
    await shutdown();
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe("resolveShutdownGraceMs", () => {
  // default 25 s, range 1-120 s
  it("defaults when unset, blank or not a whole number", () => {
    for (const raw of [undefined, "", "  ", "abc", "25s", "-5", "1.5", "1e4"]) {
      expect(resolveShutdownGraceMs(raw)).toBe(25_000);
    }
  });
  it("accepts an in-range value and clamps out-of-range ones", () => {
    expect(resolveShutdownGraceMs("20000")).toBe(20_000);
    expect(resolveShutdownGraceMs(" 20000 ")).toBe(20_000);
    expect(resolveShutdownGraceMs("0")).toBe(1_000);
    expect(resolveShutdownGraceMs("999999999")).toBe(120_000);
  });
});

describe("trackHttpRequests", () => {
  class FakeRes extends EventEmitter {
    headers: Record<string, string> = {};
    getHeader(name: string) { return this.headers[name.toLowerCase()]; }
  }

  it("waits for an open request but not for an event stream", async () => {
    const server = new EventEmitter();
    const drain = trackHttpRequests(server as never);
    const post = new FakeRes();
    const sse = new FakeRes();
    server.emit("request", { method: "POST", url: "/api/vapi/webhook?x=1" }, post);
    server.emit("request", { method: "GET", url: "/api/realtime" }, sse);
    sse.headers["content-type"] = "text/event-stream";

    expect(drain.pending()).toEqual(["POST /api/vapi/webhook"]);
    let settled = false;
    const p = drain.settled().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    post.emit("finish");
    await p;
    expect(settled).toBe(true);
    expect(drain.pending()).toEqual([]);
  });
});
