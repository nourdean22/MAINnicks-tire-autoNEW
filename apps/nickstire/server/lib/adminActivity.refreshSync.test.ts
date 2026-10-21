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
 * The 30 min age is the database's (TIMESTAMPDIFF against NOW()), never a JS subtraction on a
 * driver-parsed Date: see "the 30 min decision is the database's age" below.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const m = vi.hoisted(() => ({
  rows: [] as Array<{ ageSeconds?: unknown; startedAt?: Date }>,
  selects: 0,
  getDb: vi.fn(),
  requestAlgProbe: vi.fn(),
  getProbeBudgetState: vi.fn(),
  refreshCustomerMetrics: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: m.getDb }));
vi.mock("../services/algProbeBudget", () => ({
  requestAlgProbe: m.requestAlgProbe,
  getProbeBudgetState: m.getProbeBudgetState,
}));
vi.mock("../services/customerMetricsRefresh", () => ({ refreshCustomerMetrics: m.refreshCustomerMetrics }));

const MIN = 60 * 1000;
const NOW = new Date("2026-10-21T15:59:00Z"); // 11:59 ET, Wed 2026-10-21

async function load() {
  vi.resetModules();
  return import("./adminActivity");
}

// The age the DATABASE computed (TIMESTAMPDIFF(SECOND, startedAt, NOW())): the only number the
// code may decide on. The row carries no startedAt on purpose; a JS comparison would find nothing.
const lastAttemptAgo = (ms: number) => {
  m.rows = [{ ageSeconds: ms / 1000 }];
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
  m.getProbeBudgetState.mockReset();
  m.getProbeBudgetState.mockReturnValue({ lastProbeStartedAt: null }); // this process has started no probe
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
      lastAttemptAgo(45 * MIN);
      const r = await maybeFireAdminRefreshProbe("page-load");
      await r.done;
      expect(r.started, iso).toBe(true);
    }
  });
});

/**
 * apps/nickstire/AGENTS.md > Time: a driver-parsed TiDB timestamp comes back shifted by the ET
 * offset, so an age computed in JS (Date.now() - startedAt) can be hours off in either direction.
 * The decision must come from the number SQL computed (TIMESTAMPDIFF against NOW(), the same
 * clock that wrote startedAt via the column default). Each case below hands the code a row whose
 * driver-parsed Date disagrees with the SQL age and asserts the SQL age wins.
 */
describe("the 30 min decision is the database's age, never a JS subtraction", () => {
  const HOURS_4 = 4 * 60 * MIN;

  it("a Date 4 h in the past but a SQL age of 10 min does NOT fire (the shifted-read case)", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    m.rows = [{ ageSeconds: 10 * 60, startedAt: new Date(NOW.getTime() - HOURS_4) }];
    const r = await maybeFireAdminRefreshProbe("page-load");
    expect(r.started).toBe(false);
    expect(m.requestAlgProbe).not.toHaveBeenCalled();
  });

  it("a Date 4 h in the future (negative JS age) but a SQL age of 45 min DOES fire", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    m.rows = [{ ageSeconds: 45 * 60, startedAt: new Date(NOW.getTime() + HOURS_4) }];
    const r = await maybeFireAdminRefreshProbe("page-load");
    await r.done;
    expect(r.started).toBe(true);
  });

  it("the SQL age arrives as a string from some drivers and still decides", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    m.rows = [{ ageSeconds: "600" }];
    expect((await maybeFireAdminRefreshProbe("page-load")).started).toBe(false);
    m.rows = [{ ageSeconds: "1900" }];
    expect((await maybeFireAdminRefreshProbe("page-load")).started).toBe(true);
  });

  it("an age the database could not compute is UNKNOWN, not due: no probe", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    for (const bad of [null, undefined, "n/a"]) {
      m.rows = [{ ageSeconds: bad, startedAt: new Date(NOW.getTime() - HOURS_4) }];
      expect((await maybeFireAdminRefreshProbe("page-load")).started, String(bad)).toBe(false);
    }
    expect(m.requestAlgProbe).not.toHaveBeenCalled();
  });

  it("the query asks SQL for the age; the module never subtracts a driver Date", () => {
    const src = readFileSync(resolve(process.cwd(), "server/lib/adminActivity.ts"), "utf8");
    expect(src).toMatch(/TIMESTAMPDIFF\(SECOND, \$\{algProbeLog\.startedAt\}, NOW\(\)\)/);
    expect(src).not.toMatch(/Date\.now\(\) - new Date\(lastAuthAttempt/);
  });
});

/**
 * writeProbeLog swallows its insert errors, so a probe that authenticated but failed to log
 * leaves NO durable row, and the SQL age alone would call the next load "due" straight away
 * (and the budget's own success TTL is 5 min; empty / auth_failed / error have none). The
 * floor is in memory: every auth attempt THIS process started, stamped when it starts, not when
 * it logs (algProbeBudget's lastProbeStartedAt). Both ages must be 30 min or more to fire.
 */
describe("a probe that could not log still holds off the next one", () => {
  // A budget stand-in that behaves like the real one: stamps the start, then "fails to log".
  function budgetThatLosesItsLogRow(outcome: string) {
    let startedAtMs: number | null = null;
    m.getProbeBudgetState.mockImplementation(() => ({
      lastProbeStartedAt: startedAtMs === null ? null : new Date(startedAtMs).toISOString(),
    }));
    m.requestAlgProbe.mockImplementation(async () => {
      startedAtMs = Date.now(); // set when the probe STARTS
      return { outcome, recordsProcessed: 0, durationMs: 5, reason: "admin_refresh" };
    });
  }

  it("the log insert throws, then a load 6 min later does not fire", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    budgetThatLosesItsLogRow("success");
    m.rows = []; // the insert failed: the database knows nothing about the first probe
    const first = await maybeFireAdminRefreshProbe("page-load");
    await first.done;
    expect(first.started).toBe(true);

    vi.setSystemTime(new Date(NOW.getTime() + 6 * MIN));
    const second = await maybeFireAdminRefreshProbe("page-load");
    expect(second.started).toBe(false);
    expect(m.requestAlgProbe).toHaveBeenCalledTimes(1);
  });

  it("an auth_failed probe that could not log holds off the next load too (no success TTL covers it)", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    budgetThatLosesItsLogRow("auth_failed");
    m.rows = [];
    await (await maybeFireAdminRefreshProbe("page-load")).done;
    vi.setSystemTime(new Date(NOW.getTime() + 6 * MIN));
    expect((await maybeFireAdminRefreshProbe("page-load")).started).toBe(false);
  });

  it("any auth attempt this process started counts, whoever asked for it (cron, OAuth, chat)", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    m.getProbeBudgetState.mockReturnValue({ lastProbeStartedAt: new Date(NOW.getTime() - 10 * MIN).toISOString() });
    m.rows = [];
    expect((await maybeFireAdminRefreshProbe("page-load")).started).toBe(false);
    expect(m.getDb).not.toHaveBeenCalled(); // the memory check alone settles it
  });

  it("after 30 min of memory and a stale log, the next load fires", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    budgetThatLosesItsLogRow("success");
    m.rows = [];
    await (await maybeFireAdminRefreshProbe("page-load")).done;
    vi.setSystemTime(new Date(NOW.getTime() + 31 * MIN));
    lastAttemptAgo(31 * MIN);
    const third = await maybeFireAdminRefreshProbe("page-load");
    await third.done;
    expect(third.started).toBe(true);
  });

  it("both must agree: a recent LOGGED attempt still blocks when memory is empty (restart-proof)", async () => {
    const { maybeFireAdminRefreshProbe } = await load();
    m.getProbeBudgetState.mockReturnValue({ lastProbeStartedAt: null }); // fresh process after a deploy
    lastAttemptAgo(10 * MIN);
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
