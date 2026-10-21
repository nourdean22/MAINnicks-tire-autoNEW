/**
 * algProbeBudget: what a probe's outcome MEANS, when it STARTED, and the one recorder for syncs
 * that do not go through the budget.
 *
 * The sales card decides "synced" from the newest `success` row in alg_probe_log, so `success`
 * must mean the invoices were actually read:
 *   - runFullMirror returns `{ recordsProcessed: 0, details: "0 invoices fetched ..." }` when
 *     the invoice fetch fails, and the old runProbe only knew the string "Auth failed", so that
 *     became `empty` (or `success` when estimates happened to process rows).
 *   - writeProbeLog never set startedAt, so the column default stamped it AFTER the work; a
 *     fetch begun at 11:59 PM that logged at 12:01 AM looked like a probe on the next day.
 *   - forceSyncNow and the two bridge refreshes ran the mirror outside the budget, leaving
 *     no row and no in-process stamp.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const m = vi.hoisted(() => ({
  inserted: [] as Array<Record<string, unknown>>,
  insertThrows: false,
  runFullMirror: vi.fn(),
  runEstimateMirror: vi.fn(),
}));

vi.mock("../lib/db-helper", () => ({
  db: async () => ({
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        if (m.insertThrows) throw new Error("insert failed");
        m.inserted.push(v);
      },
    }),
  }),
}));
vi.mock("./shopDriverMirror", () => ({ runFullMirror: m.runFullMirror }));
vi.mock("./shopDriverEstimateSync", () => ({ runEstimateMirror: m.runEstimateMirror }));

const NOW = new Date("2026-10-21T15:59:00Z"); // 11:59 ET

const mirrorOk = (over: Record<string, unknown> = {}) => ({
  recordsProcessed: 0, invoicesFetched: 40, details: "Customers: 0 new | Invoices: 0 new, 0 updated, 40 unchanged (40 fetched)", ...over,
});
const mirrorNoInvoices = (over: Record<string, unknown> = {}) => ({
  recordsProcessed: 0, invoicesFetched: 0, details: "0 invoices fetched — session invalidated (fail #1)", ...over,
});
const mirrorAuthFailed = () => ({
  recordsProcessed: 0, invoicesFetched: 0, details: "Auth failed — no credentials or login rejected",
});

async function load() {
  vi.resetModules();
  return import("./algProbeBudget");
}

/** The pieces of a drizzle `sql` template: strings and bound params, in order. */
const chunks = (q: unknown): unknown[] =>
  ((q as { queryChunks?: Array<{ value?: string[] } | unknown> }).queryChunks ?? []).map((c) =>
    c && typeof c === "object" && Array.isArray((c as { value?: string[] }).value) ? (c as { value: string[] }).value.join("") : c,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  m.inserted = [];
  m.insertThrows = false;
  m.runFullMirror.mockReset();
  m.runFullMirror.mockResolvedValue(mirrorOk());
  m.runEstimateMirror.mockReset();
  m.runEstimateMirror.mockResolvedValue({ recordsProcessed: 0, details: "" });
});
afterEach(() => vi.useRealTimers());

describe("success means the invoices were read", () => {
  it("invoices fetched but nothing changed (a quiet, healthy read) is success", async () => {
    const { requestAlgProbe } = await load();
    const r = await requestAlgProbe("manual_refresh", { force: true });
    expect(r.outcome).toBe("success");
    expect(m.inserted[0]).toMatchObject({ outcome: "success", reason: "manual_refresh" });
  });

  it("an invoice fetch that returned 0 is an error, even when estimates processed rows", async () => {
    const { requestAlgProbe } = await load();
    m.runFullMirror.mockResolvedValue(mirrorNoInvoices());
    m.runEstimateMirror.mockResolvedValue({ recordsProcessed: 7, details: "7 estimates" });
    const r = await requestAlgProbe("manual_refresh", { force: true });
    expect(r.outcome).toBe("error");
    expect(r.errorMessage).toMatch(/0 invoices fetched/);
    expect(m.inserted[0]).toMatchObject({ outcome: "error" });
  });

  it("an invoice fetch that returned 0 with nothing else is an error, never 'empty'", async () => {
    const { requestAlgProbe } = await load();
    m.runFullMirror.mockResolvedValue(mirrorNoInvoices());
    const r = await requestAlgProbe("manual_refresh", { force: true });
    expect(r.outcome).toBe("error");
  });

  it("a rejected login is still auth_failed", async () => {
    const { requestAlgProbe } = await load();
    m.runFullMirror.mockResolvedValue(mirrorAuthFailed());
    expect((await requestAlgProbe("manual_refresh", { force: true })).outcome).toBe("auth_failed");
  });

  it("a thrown mirror is an error row", async () => {
    const { requestAlgProbe } = await load();
    m.runFullMirror.mockRejectedValue(new Error("socket hang up"));
    const r = await requestAlgProbe("manual_refresh", { force: true });
    expect(r.outcome).toBe("error");
    expect(m.inserted[0]).toMatchObject({ outcome: "error" });
  });

  it("a failed read does not start the 5 min 'fresh data' skip: the next request still probes", async () => {
    const { requestAlgProbe } = await load();
    m.runFullMirror.mockResolvedValueOnce(mirrorNoInvoices());
    await requestAlgProbe("manual_refresh", { force: true });
    vi.setSystemTime(new Date(NOW.getTime() + 60_000)); // past the 30 s dedup, inside the 5 min TTL
    const second = await requestAlgProbe("chat_query");
    expect(second.outcome).toBe("success");
    expect(m.runFullMirror).toHaveBeenCalledTimes(2);
  });

  it("runFullMirror itself reports how many invoices it fetched on every path", () => {
    const src = readFileSync(resolve(process.cwd(), "server/services/shopDriverMirror.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function runFullMirror"), src.indexOf("// ─── ALERT HELPER"));
    const returns = body.match(/return \{ recordsProcessed[^}]*\}/g) ?? [];
    expect(returns.length).toBe(3);
    for (const r of returns) expect(r, r).toMatch(/invoicesFetched/);
  });
});

describe("startedAt is the real start, written by the database clock", () => {
  it("the row's startedAt is NOW() minus the probe's duration, with no JS Date bound", async () => {
    const { requestAlgProbe } = await load();
    m.runFullMirror.mockImplementation(async () => {
      vi.setSystemTime(new Date(NOW.getTime() + 90_000)); // the fetch takes 90 s
      return mirrorOk();
    });
    await requestAlgProbe("manual_refresh", { force: true });
    const startedAt = m.inserted[0]!.startedAt;
    expect(startedAt).not.toBeInstanceOf(Date);
    const parts = chunks(startedAt);
    expect(parts.filter((p) => typeof p === "string").join("?")).toMatch(/DATE_SUB\(NOW\(\), INTERVAL \? MICROSECOND\)/);
    expect(parts.filter((p) => typeof p === "number")).toEqual([90_000 * 1000]);
  });

  it("a request that ran nothing (skipped as fresh) is stamped at NOW(): zero duration", async () => {
    const { requestAlgProbe } = await load();
    await requestAlgProbe("manual_refresh", { force: true });
    m.inserted = [];
    await requestAlgProbe("chat_query");
    expect(m.inserted[0]).toMatchObject({ outcome: "skipped_recent" });
    expect(chunks(m.inserted[0]!.startedAt).filter((p) => typeof p === "number")).toEqual([0]);
  });
});

describe("recordExternalSync: syncs that bypass the budget still leave a row and a stamp", () => {
  it("stamps lastProbeStartedAt when it STARTS, before the sync runs", async () => {
    const { recordExternalSync, getProbeBudgetState } = await load();
    let seen: ReturnType<typeof getProbeBudgetState> | null = null;
    await recordExternalSync("force_sync", async () => {
      seen = getProbeBudgetState();
      return mirrorOk();
    });
    expect(seen!.lastProbeStartedAt).toBe(NOW.toISOString());
    expect(seen!.inFlight).toBe(true);
    expect(getProbeBudgetState().inFlight).toBe(false);
  });

  it("writes a row with the caller's reason and the same outcome rules", async () => {
    const { recordExternalSync } = await load();
    await recordExternalSync("force_sync", async () => mirrorOk());
    await recordExternalSync("bridge_mirror", async () => mirrorNoInvoices());
    await recordExternalSync("bridge_full_sync", async () => mirrorAuthFailed());
    expect(m.inserted.map((r) => [r.reason, r.outcome])).toEqual([
      ["force_sync", "success"],
      ["bridge_mirror", "error"],
      ["bridge_full_sync", "auth_failed"],
    ]);
    expect(String(chunks(m.inserted[0]!.startedAt).join("?"))).toMatch(/DATE_SUB\(NOW\(\)/);
  });

  it("is not refused by the budget: a manual sync-now right after another still runs", async () => {
    const { recordExternalSync } = await load();
    const fn = vi.fn(async () => mirrorOk());
    await recordExternalSync("force_sync", fn);
    await recordExternalSync("force_sync", fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("returns the sync's result untouched", async () => {
    const { recordExternalSync } = await load();
    const result = mirrorOk({ recordsProcessed: 12 });
    expect(await recordExternalSync("force_sync", async () => result)).toBe(result);
  });

  it("a thrown sync is logged as an error row and rethrown to its caller", async () => {
    const { recordExternalSync, getProbeBudgetState } = await load();
    await expect(recordExternalSync("bridge_mirror", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(m.inserted[0]).toMatchObject({ reason: "bridge_mirror", outcome: "error" });
    expect(getProbeBudgetState().inFlight).toBe(false);
  });

  it("a log insert that fails neither breaks the sync nor un-stamps the start", async () => {
    const { recordExternalSync, getProbeBudgetState } = await load();
    m.insertThrows = true;
    const result = mirrorOk();
    expect(await recordExternalSync("force_sync", async () => result)).toBe(result);
    expect(getProbeBudgetState().lastProbeStartedAt).toBe(NOW.toISOString());
  });

  it("every caller that ran the mirror outside the budget now goes through it", () => {
    for (const file of ["server/routers/shopdriver.ts", "server/_core/bridge-routes.ts"]) {
      const lines = readFileSync(resolve(process.cwd(), file), "utf8")
        .split("\n")
        .filter((l) => /runFullMirror\(\)/.test(l) && !/^\s*(\/\/|\*)/.test(l));
      expect(lines.length, file).toBeGreaterThan(0);
      for (const l of lines) expect(l, `${file}: ${l.trim()}`).toMatch(/recordExternalSync\(/);
    }
  });

  it("a partial ticket pull (syncInvoices) only stamps the start: no log row, so it never counts as a sync", async () => {
    const { noteAuthAttemptStarted, getProbeBudgetState } = await load();
    noteAuthAttemptStarted();
    expect(getProbeBudgetState().lastProbeStartedAt).toBe(NOW.toISOString());
    expect(m.inserted).toHaveLength(0);
    const router = readFileSync(resolve(process.cwd(), "server/routers/shopdriver.ts"), "utf8");
    expect(router).toMatch(/syncInvoices: adminProcedure[\s\S]*?noteAuthAttemptStarted\(\)/);
  });

  it("the new reasons fit the alg_probe_log.reason column (varchar 32)", async () => {
    const src = readFileSync(resolve(process.cwd(), "server/services/algProbeBudget.ts"), "utf8");
    for (const reason of ["force_sync", "bridge_mirror", "bridge_full_sync"]) {
      expect(src).toContain(`"${reason}"`);
      expect(reason.length).toBeLessThanOrEqual(32);
    }
  });
});
