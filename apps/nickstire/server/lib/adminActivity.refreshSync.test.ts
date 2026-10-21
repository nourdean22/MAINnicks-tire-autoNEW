/**
 * Refresh-triggered ALG sync (Nour, 2026-10-21): "Refresh syncs anytime" -- a full admin page load
 * or refresh syncs ShopDriver, at most every 30 minutes, any hour, accepting that each sync
 * re-authenticates and logs the shop counter out. This replaces the 6 h "resume edge" rule.
 *
 * What is pinned:
 *   - the LOAD signal (maybeFireAdminRefreshProbe) fires when the last AUTH-ATTEMPTING probe in
 *     alg_probe_log is 30 min old or older, and not before; the check is the DB row, so it
 *     survives a restart;
 *   - an ordinary adminProcedure touch (every click) never nominates a probe;
 *   - an in-flight probe is not doubled; a failed probe never throws into the request;
 *   - the interval is real elapsed time, not wall-clock digits, across both DST changes.
 *
 * Time is mocked with fake Date; instants are written as UTC and labelled with their ET reading.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const m = vi.hoisted(() => ({
  rows: [] as Array<{ startedAt: Date }>,
  selects: 0,
  getDb: vi.fn(),
  requestAlgProbe: vi.fn(),
  refreshCustomerMetrics: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: m.getDb }));
vi.mock("../services/algProbeBudget", () => ({ requestAlgProbe: m.requestAlgProbe }));
vi.mock("../services/customerMetricsRefresh", () => ({ refreshCustomerMetrics: m.refreshCustomerMetrics }));

const MIN = 60 * 1000;
const NOW = new Date("2026-10-21T15:59:00Z"); // 11:59 ET, Wed 2026-10-21

async function load() {
  vi.resetModules();
  return import("./adminActivity");
}

const lastAttemptAgo = (ms: number, at: Date = NOW) => {
  m.rows = [{ startedAt: new Date(at.getTime() - ms) }];
};

// Date is faked but timers are real: let any background work the code under test started settle.
const flush = () => new Promise<void>((r) => setTimeout(r, 20));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  m.rows = [];
  m.selects = 0;
  m.getDb.mockReset();
  m.getDb.mockImplementation(async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => {
              m.selects++;
              return m.rows;
            },
          }),
        }),
      }),
    }),
  }));
  m.requestAlgProbe.mockReset();
  m.requestAlgProbe.mockResolvedValue({ outcome: "success", recordsProcessed: 3, durationMs: 10, reason: "admin_refresh" });
  m.refreshCustomerMetrics.mockReset();
  m.refreshCustomerMetrics.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a page load syncs when the last auth attempt is 30 min old or older", () => {
  it("fires at 31 min, logging the distinct admin_refresh reason", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    lastAttemptAgo(31 * MIN);
    const r = await maybeFireAdminRefreshProbe("page-load");
    await r.done;
    expect(r.started).toBe(true);
    expect(m.requestAlgProbe).toHaveBeenCalledTimes(1);
    expect(m.requestAlgProbe.mock.calls[0]![0]).toBe("admin_refresh");
    expect(String(m.requestAlgProbe.mock.calls[0]![1].detail)).toContain("page-load");
  });

  it("does NOT fire at 29 min", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    lastAttemptAgo(29 * MIN);
    const r = await maybeFireAdminRefreshProbe("page-load");
    await r.done;
    expect(r.started).toBe(false);
    expect(m.requestAlgProbe).not.toHaveBeenCalled();
  });

  it("the boundary: exactly 30 min fires, one second short does not", async () => {
    const { maybeFireAdminRefreshProbe, REFRESH_PROBE_MIN_INTERVAL_MS } = await load();
    expect(REFRESH_PROBE_MIN_INTERVAL_MS).toBe(30 * MIN);
    lastAttemptAgo(30 * MIN - 1000);
    expect((await maybeFireAdminRefreshProbe("page-load")).started).toBe(false);
    lastAttemptAgo(30 * MIN);
    expect((await maybeFireAdminRefreshProbe("page-load")).started).toBe(true);
  });

  it("fires when the log holds no auth attempt at all", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    m.rows = [];
    const r = await maybeFireAdminRefreshProbe("page-load");
    await r.done;
    expect(r.started).toBe(true);
    expect(m.requestAlgProbe).toHaveBeenCalledTimes(1);
  });

  it("any hour: 03:00 ET and 14:00 ET behave the same, there is no business-hours gate", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    for (const iso of ["2026-10-21T07:00:00Z", "2026-10-21T18:00:00Z"]) {
      vi.setSystemTime(new Date(iso));
      lastAttemptAgo(45 * MIN, new Date(iso));
      const r = await maybeFireAdminRefreshProbe("page-load");
      await r.done;
      expect(r.started, iso).toBe(true);
    }
  });

  it("counts elapsed time, not wall-clock digits, across fall-back (2026-11-01 01:10 EST is 31 min after 01:39 EDT)", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    const now = new Date("2026-11-01T06:10:00Z"); // 01:10 EST (second pass through 1 AM)
    vi.setSystemTime(now);
    lastAttemptAgo(31 * MIN, now); // 05:39Z = 01:39 EDT: the wall clock reads LATER than now
    expect((await maybeFireAdminRefreshProbe("page-load")).started).toBe(true);
  });

  it("counts elapsed time across spring-forward (01:45 EST to 03:14 EDT is only 29 min)", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    const now = new Date("2026-03-08T07:14:00Z"); // 03:14 EDT
    vi.setSystemTime(now);
    lastAttemptAgo(29 * MIN, now); // 06:45Z = 01:45 EST: the wall clock says 89 min
    expect((await maybeFireAdminRefreshProbe("page-load")).started).toBe(false);
  });
});

describe("only the load signal syncs; ordinary admin activity never does", () => {
  it("an adminProcedure touch does not read the log and does not nominate a probe", async () => {
    const { touchAdminActivity } = await load();
    lastAttemptAgo(5 * 60 * MIN); // a stale log: the old resume rule would have fired here
    touchAdminActivity("trpc:controlCenter.shopSales");
    touchAdminActivity("trpc:customers.list");
    await flush();
    expect(m.getDb).not.toHaveBeenCalled();
    expect(m.requestAlgProbe).not.toHaveBeenCalled();
  });

  it("the first touch after a long silence is still not a sync trigger", async () => {
    const { touchAdminActivity } = await load();
    lastAttemptAgo(24 * 60 * MIN);
    touchAdminActivity("trpc:x");
    vi.setSystemTime(new Date(NOW.getTime() + 7 * 60 * MIN));
    touchAdminActivity("trpc:x");
    await flush();
    expect(m.requestAlgProbe).not.toHaveBeenCalled();
  });

  it("the 6 h resume-edge rule is gone, not left as dead code", () => {
    const src = readFileSync(resolve(process.cwd(), "server/lib/adminActivity.ts"), "utf8");
    expect(src).not.toMatch(/isResumeEdge|RESUME_GAP_MS|maybeFireSessionResumeProbe/);
    expect(src).toMatch(/Nour, 2026-10-21/);
  });
});

describe("one probe at a time, and a failure stays out of the request", () => {
  it("a second load while a probe is running does not start another", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    lastAttemptAgo(31 * MIN);
    let finish!: (v: unknown) => void;
    m.requestAlgProbe.mockReturnValueOnce(new Promise((res) => { finish = res; }));

    const first = await maybeFireAdminRefreshProbe("page-load");
    const second = await maybeFireAdminRefreshProbe("page-load");
    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    await flush(); // the probe starts behind the response
    expect(m.requestAlgProbe).toHaveBeenCalledTimes(1);

    finish({ outcome: "success", recordsProcessed: 1, durationMs: 1, reason: "admin_refresh" });
    await first.done;
  });

  it("two loads that race on the same stale read start exactly one probe", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    lastAttemptAgo(31 * MIN);
    const [a, b] = await Promise.all([maybeFireAdminRefreshProbe("a"), maybeFireAdminRefreshProbe("b")]);
    await Promise.all([a.done, b.done]);
    expect([a.started, b.started].sort()).toEqual([false, true]);
    expect(m.requestAlgProbe).toHaveBeenCalledTimes(1);
  });

  it("a probe that rejects does not throw into the caller, and the next load can fire again", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    lastAttemptAgo(31 * MIN);
    m.requestAlgProbe.mockRejectedValueOnce(new Error("ShopDriver login refused"));
    const r = await maybeFireAdminRefreshProbe("page-load");
    await expect(r.done).resolves.toBeUndefined();
    expect(r.started).toBe(true);
    expect(m.refreshCustomerMetrics).not.toHaveBeenCalled();

    lastAttemptAgo(31 * MIN);
    expect((await maybeFireAdminRefreshProbe("page-load")).started).toBe(true);
  });

  it("an unreadable log means no probe (unknown is not 'due'), and no throw", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    m.getDb.mockRejectedValueOnce(new Error("pool exhausted"));
    const r = await maybeFireAdminRefreshProbe("page-load");
    expect(r.started).toBe(false);
    expect(m.requestAlgProbe).not.toHaveBeenCalled();
    m.getDb.mockResolvedValueOnce(null);
    expect((await maybeFireAdminRefreshProbe("page-load")).started).toBe(false);
  });

  it("customer metrics refresh only after a SUCCESSFUL probe", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    lastAttemptAgo(31 * MIN);
    m.requestAlgProbe.mockResolvedValueOnce({ outcome: "auth_failed", recordsProcessed: 0, durationMs: 5, reason: "admin_refresh" });
    await (await maybeFireAdminRefreshProbe("page-load")).done;
    expect(m.refreshCustomerMetrics).not.toHaveBeenCalled();

    lastAttemptAgo(31 * MIN);
    await (await maybeFireAdminRefreshProbe("page-load")).done;
    expect(m.refreshCustomerMetrics).toHaveBeenCalledTimes(1);
  });
});

describe("the reason, the door and the consumer exist", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  it("admin_refresh is a ProbeReason, so the probe log names why it fired", () => {
    expect(read("server/services/algProbeBudget.ts")).toMatch(/\|\s*"admin_refresh"/);
  });

  it("the auth-attempt definition is still shared and unchanged", async () => {
    const { AUTH_ATTEMPTING_OUTCOMES } = await load();
    expect([...AUTH_ATTEMPTING_OUTCOMES]).toEqual(["success", "empty", "auth_failed", "error"]);
  });

  it("shopdriver.syncOnAdminLoad calls the throttled function and returns only whether it started", () => {
    const router = read("server/routers/shopdriver.ts");
    expect(router).toMatch(/syncOnAdminLoad: adminProcedure/);
    expect(router).toMatch(/maybeFireAdminRefreshProbe\(/);
  });

  it("the Today page's Billed card is the consumer: it calls the door once per document and refetches", () => {
    const card = read("client/src/pages/admin/SalesCard.tsx");
    expect(card).toMatch(/shopdriver\.syncOnAdminLoad\.useMutation/);
    expect(card).toMatch(/refetchInterval/);
  });
});
