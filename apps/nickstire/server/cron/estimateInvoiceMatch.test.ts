/**
 * Q-37 · the estimate -> invoice matcher runs on a schedule, before the sends.
 *
 * THE GAP. `backfillMatches()` only ran inside `runEstimateMirror()`, which is
 * reached only through a demand-driven ALG probe (algProbeBudget.ts) AND only
 * past a successful ShopDriver login AND a non-empty estimate fetch. The match
 * itself is purely local (alg_estimates x invoices), so an auth failure or an
 * empty fetch left already-mirrored invoices unmatched — and
 * `alg-declined-work-recovery` reads `matched_invoice_id IS NULL` as "declined".
 *
 * WHAT THIS PINS, read from what the scheduler will actually do (getJobCadences),
 * not from source text:
 *   · the job is in the daily tier and scheduled automatically;
 *   · it comes BEFORE alg-declined-work-recovery in that tier (tier jobs run
 *     sequentially, in order), so every send decision sees that day's matches;
 *   · it calls the matcher over the recovery window, and a zero-match run says why.
 * The recovery job itself is not touched: its flag, cap and templates are the
 * operator's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DECLINED_RECOVERY_WINDOW_DAYS } from "@shared/const";

describe("estimate-invoice-match tier job", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.doUnmock("../services/shopDriverEstimateSync");
    vi.doUnmock("../db");
  });

  it("is a daily, automatically scheduled job that runs before the recovery sends", async () => {
    const { getJobCadences } = await import("./scheduler");
    const cadences = getJobCadences();
    const job = cadences.get("estimate-invoice-match");
    expect(job, "matcher is not registered with the scheduler").toBeTruthy();
    expect(job!.tier).toBe("daily");
    expect(job!.scheduledAutomatically).toBe(true);
    expect(job!.requiresEnv).toEqual([]);

    const daily = [...cadences.entries()].filter(([, c]) => c.tier === "daily").map(([name]) => name);
    const matchAt = daily.indexOf("estimate-invoice-match");
    const sendAt = daily.indexOf("alg-declined-work-recovery");
    expect(sendAt, "recovery job moved out of the daily tier — re-check the ordering premise").toBeGreaterThan(-1);
    expect(matchAt).toBeLessThan(sendAt);
  });

  it("matches over the whole recovery window and reports the counts", async () => {
    const backfillMatches = vi.fn(async () => ({
      matched: 3, scanned: 40, skippedNoPhone: 2, ambiguous: 1, dryRun: false, preview: [],
    }));
    vi.doMock("../services/shopDriverEstimateSync", () => ({ backfillMatches }));
    const { getJobCadences, runTierJobHandlerUnlocked } = await import("./scheduler");
    getJobCadences(); // builds the tiers
    const r = await runTierJobHandlerUnlocked("estimate-invoice-match");
    expect(backfillMatches).toHaveBeenCalledWith({ sinceDays: DECLINED_RECOVERY_WINDOW_DAYS });
    expect(r.recordsProcessed).toBe(3);
    expect(r.details).toMatch(/matched 3 of 40/);
    expect(r.details).toMatch(/ambiguous 1/);
  });

  it("no database fails the run — it is not 'nothing to match'", async () => {
    vi.doMock("../db", () => ({ getDb: async () => null }));
    try {
      const { backfillMatches } = await import("../services/shopDriverEstimateSync");
      await expect(backfillMatches({ sinceDays: 60 })).rejects.toThrow(/database unavailable/i);
    } finally {
      vi.doUnmock("../db");
    }
  });

  it("the match write only claims a row that is STILL unmatched, and counts only a won claim", async () => {
    const { MySqlDialect } = await import("drizzle-orm/mysql-core");
    const whereArgs: unknown[] = [];
    const selects: unknown[][] = [
      [{ id: 11, customerPhone: "(216) 862-0005", estimatedAmount: 40000, estimateDate: new Date("2026-09-01T12:00:00Z") }],
      [{ id: 501 }],
    ];
    const chain = () => {
      const c: Record<string, unknown> = {};
      for (const k of ["from", "where", "orderBy"]) c[k] = () => c;
      c.limit = async () => selects.shift() ?? [];
      return c;
    };
    const fake = {
      select: () => chain(),
      update: () => ({ set: () => ({ where: async (w: unknown) => { whereArgs.push(w); return [{ affectedRows: 0 }]; } }) }),
    };
    vi.doMock("../db", () => ({ getDb: async () => fake }));
    try {
      const { backfillMatches } = await import("../services/shopDriverEstimateSync");
      const r = await backfillMatches({ sinceDays: 60 });
      expect(whereArgs).toHaveLength(1);
      const { sql } = new MySqlDialect().sqlToQuery(whereArgs[0] as never);
      expect(sql).toMatch(/`matched_invoice_id` is null/i);
      // A peer matched it first (0 rows affected): not our match, not counted.
      expect(r.matched).toBe(0);
    } finally {
      vi.doUnmock("../db");
    }
  });

  it("a run with nothing to scan says so rather than logging a bare zero", async () => {
    vi.doMock("../services/shopDriverEstimateSync", () => ({
      backfillMatches: async () => ({ matched: 0, scanned: 0, skippedNoPhone: 0, ambiguous: 0, dryRun: false, preview: [] }),
    }));
    const { getJobCadences, runTierJobHandlerUnlocked } = await import("./scheduler");
    getJobCadences();
    const r = await runTierJobHandlerUnlocked("estimate-invoice-match");
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toMatch(/no unmatched estimates/i);
  });

  it("paginates past 200 permanently-unmatched rows so later estimates cannot starve", async () => {
    const { MySqlDialect } = await import("drizzle-orm/mysql-core");
    const page = (start: number, count: number) => Array.from({ length: count }, (_, i) => ({
      id: start + i,
      customerPhone: "bad",
      estimatedAmount: 10000,
      estimateDate: new Date("2026-09-01T12:00:00Z"),
    }));
    const pages = [page(1, 200), page(201, 5)];
    const whereArgs: unknown[] = [];
    let selects = 0;
    const fake = {
      select: () => {
        selects++;
        const c: Record<string, any> = {};
        c.from = () => c;
        c.where = (w: unknown) => { whereArgs.push(w); return c; };
        c.orderBy = () => c;
        c.limit = async () => pages.shift() ?? [];
        return c;
      },
    };
    vi.doMock("../db", () => ({ getDb: async () => fake }));
    const { backfillMatches } = await import("../services/shopDriverEstimateSync");
    const r = await backfillMatches({ sinceDays: 60 });
    expect(r.scanned).toBe(205);
    expect(r.skippedNoPhone).toBe(205);
    expect(selects).toBe(2);
    const second = new MySqlDialect().sqlToQuery(whereArgs[1] as never);
    expect(second.sql).toMatch(/`id` > \?/i);
    expect(second.params).toContain(200);
  });

  it("runTier never invokes recovery when the matcher throws", async () => {
    vi.doMock("../db", () => ({ getDb: async () => null }));
    const matcher = vi.fn(async () => { throw new Error("matcher broke"); });
    const recovery = vi.fn(async () => ({ recordsProcessed: 1 }));
    const { runTier } = await import("./scheduler");
    await runTier({
      name: "q37-failure-canary",
      intervalMs: 60_000,
      running: false,
      lastRun: null,
      jobs: [
        { name: "estimate-invoice-match", handler: matcher },
        { name: "alg-declined-work-recovery", requiresSuccessfulJobs: ["estimate-invoice-match"], handler: recovery },
      ],
    });
    expect(matcher).toHaveBeenCalledTimes(1);
    expect(recovery).not.toHaveBeenCalled();
  });

  it("runTier never invokes recovery when the matcher times out", async () => {
    vi.doMock("../db", () => ({ getDb: async () => null }));
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const matcher = vi.fn(async () => { await wait; return { recordsProcessed: 0 }; });
    const recovery = vi.fn(async () => ({ recordsProcessed: 1 }));
    const { runTier } = await import("./scheduler");
    await runTier({
      name: "q37-timeout-canary",
      intervalMs: 60_000,
      running: false,
      lastRun: null,
      jobs: [
        { name: "estimate-invoice-match", timeoutMs: 5, handler: matcher },
        { name: "alg-declined-work-recovery", requiresSuccessfulJobs: ["estimate-invoice-match"], handler: recovery },
      ],
    });
    expect(matcher).toHaveBeenCalledTimes(1);
    expect(recovery).not.toHaveBeenCalled();
    release();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
