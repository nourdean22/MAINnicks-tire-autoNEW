/**
 * The worker's "forward OK" must mean the JOB reported ok, not just HTTP 200
 * (audit 08-F13, 2026-10-10).
 *
 * statenour wraps every cron result as `{ ok: true, data: <result> }`, so a
 * kill-switched job, a feature-off skip and a handler's own `ok:false` all came
 * back 200 and the worker logged "forward OK" for each. Lives here because the
 * worker has no test suite of its own (same as worker-hygiene.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The render loop's heavy deps are irrelevant to forwarding.
vi.mock("@nour/reel-engine", () => ({ renderReelVideo: vi.fn() }));
vi.mock("../../../worker/src/storage", () => ({ storagePut: vi.fn() }));

type Scheduler = typeof import("../../../worker/src/scheduler");

async function loadScheduler(): Promise<Scheduler> {
  vi.resetModules();
  vi.stubEnv("STATENOUR_WEB_URL", "http://web.internal");
  vi.stubEnv("CRON_SECRET", "test-secret");
  return import("../../../worker/src/scheduler");
}

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })),
  );
}

let log: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
const printed = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("worker forwardCronToWeb · reads the body", () => {
  it("CONTROL: a 200 whose job reported success logs OK (with its count) and returns true", async () => {
    const { forwardCronToWeb } = await loadScheduler();
    respondWith({ ok: true, data: { drained: 3, resultCount: 3 } });
    expect(await forwardCronToWeb("outbox-drain")).toBe(true);
    expect(printed(log)).toMatch(/forward OK · outbox-drain .*resultCount=3/);
    expect(error).not.toHaveBeenCalled();
  });

  it("BREAKS: a 200 carrying the job's own ok:false is logged as a FAILURE, not OK", async () => {
    const { forwardCronToWeb } = await loadScheduler();
    respondWith({ ok: true, data: { ok: false, reason: "heartbeat 25h old" } });
    expect(await forwardCronToWeb("inngest-liveness")).toBe(false);
    expect(printed(error)).toMatch(/inngest-liveness .*ok:false .*heartbeat 25h old/);
    expect(printed(log)).not.toMatch(/forward OK/);
  });

  it("BREAKS: a kill-switched job (skipped:true + reason) is logged as SKIPPED, not OK", async () => {
    const { forwardCronToWeb } = await loadScheduler();
    respondWith({ ok: true, data: { skipped: true, reason: "disabled via settings", jobName: "agent-followups" } });
    expect(await forwardCronToWeb("agent-followups")).toBe(true);
    expect(printed(warn)).toMatch(/SKIPPED · agent-followups .*disabled via settings/);
    expect(printed(log)).not.toMatch(/forward OK/);
  });

  it("BREAKS: a feature-off skip (skipped: \"<reason>\") is logged as SKIPPED", async () => {
    const { forwardCronToWeb } = await loadScheduler();
    respondWith({ ok: true, data: { ok: true, skipped: "NICK_AGENT_FOLLOWUPS off" } });
    await forwardCronToWeb("agent-followups");
    expect(printed(warn)).toMatch(/SKIPPED · agent-followups .*NICK_AGENT_FOLLOWUPS off/);
    expect(printed(log)).not.toMatch(/forward OK/);
  });

  it("a 200 with an unreadable body is not called OK", async () => {
    const { forwardCronToWeb } = await loadScheduler();
    respondWith("<html>proxy page</html>");
    expect(await forwardCronToWeb("brain-bus-drain")).toBe(false);
    expect(printed(log)).not.toMatch(/forward OK/);
    expect(printed(warn)).toMatch(/brain-bus-drain/);
  });

  it("a non-200 is still a FAIL (unchanged)", async () => {
    const { forwardCronToWeb } = await loadScheduler();
    respondWith({ ok: false, error: "boom" }, 500);
    expect(await forwardCronToWeb("outbox-drain")).toBe(false);
    expect(printed(error)).toMatch(/forward FAIL · outbox-drain · status=500/);
  });
});
