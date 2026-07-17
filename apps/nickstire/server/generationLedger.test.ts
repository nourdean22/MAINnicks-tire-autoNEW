/**
 * Generation ledger (Long Haul milestone 4) — reserve/settle/release/fail
 * with idempotency and optimistic budget compensation. Spend must come from
 * the ledger, never job-row counts.
 */
import { describe, expect, it, vi, afterEach } from "vitest";

afterEach(() => {
  vi.doUnmock("./db");
  vi.resetModules();
});

function fakeLedgerDb(state: { rows: Array<Record<string, unknown>> }) {
  return {
    select: (_proj?: unknown) => ({
      from: () => {
        const chain = {
          where: (_w?: unknown) => {
            // Two shapes are used: existence check (returns rows) and SUM
            // (returns [{ total }]). Distinguish by projection is overkill for
            // a fake — expose both via a thenable that resolves rows, with
            // .limit for the existence path.
            const p = Promise.resolve(
              state.rows.length && Object.prototype.hasOwnProperty.call(state.rows[0], "total")
                ? state.rows
                : state.rows,
            ) as Promise<unknown> & { limit: (n: number) => Promise<unknown> };
            p.limit = () => Promise.resolve(state.rows);
            return p;
          },
        };
        return chain;
      },
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        state.rows.push(v);
        return Promise.resolve({});
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          Object.assign(state.rows[state.rows.length - 1] ?? {}, patch);
          return Promise.resolve({});
        },
      }),
    }),
  };
}

describe("reserve", () => {
  it("inserts a flagged-estimate reservation and returns it", async () => {
    const state = { rows: [] as Array<Record<string, unknown>> };
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeLedgerDb(state)) }));
    vi.resetModules();
    const { reserve } = await import("./services/generationLedger");

    const row = await reserve({
      actionId: "reel_job_1",
      provider: "higgsfield",
      model: "seedance1_5",
      operation: "reel_clips",
      estimatedCostUsd: 1.5,
    });

    expect(row).not.toBeNull();
    expect(row!.status).toBe("reserved");
    expect(row!.isEstimate).toBe(true);
    expect(state.rows[0].actionId).toBe("reel_job_1");
    expect(state.rows[0].isEstimate).toBe(true);
  });

  it("is idempotent: an existing actionId returns the original, no second insert", async () => {
    const state = {
      rows: [
        { id: "res_x", actionId: "reel_job_1", status: "reserved", estimatedCostUsd: "1.5000", actualCostUsd: null, isEstimate: true },
      ] as Array<Record<string, unknown>>,
    };
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeLedgerDb(state)) }));
    vi.resetModules();
    const { reserve } = await import("./services/generationLedger");

    const row = await reserve({ actionId: "reel_job_1", provider: "p", model: "m", operation: "o", estimatedCostUsd: 9 });
    expect(row!.id).toBe("res_x");
    expect(row!.estimatedCostUsd).toBe(1.5);
    expect(state.rows).toHaveLength(1);
  });

  it("returns null (loud fallback) when the ledger table is unavailable", async () => {
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));
    vi.resetModules();
    const { reserve, dailySpendUsd } = await import("./services/generationLedger");
    expect(await reserve({ actionId: "a", provider: "p", model: "m", operation: "o", estimatedCostUsd: 1 })).toBeNull();
    expect(await dailySpendUsd()).toBeNull();
  });
});

describe("budget compensation", () => {
  it("self-releases and throws when the post-insert re-sum exceeds the daily budget", async () => {
    const state = { rows: [] as Array<Record<string, unknown>> };
    const db = fakeLedgerDb(state);
    // After the insert, the SUM query must report over-budget:
    const origSelect = db.select.bind(db);
    let selectCount = 0;
    db.select = ((proj?: unknown) => {
      selectCount++;
      // 1st select: existence check (empty). 2nd: SUM → over budget.
      if (selectCount >= 2) {
        return { from: () => ({ where: () => Promise.resolve([{ total: "11.00" }]) }) } as never;
      }
      return origSelect(proj);
    }) as typeof db.select;
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(db) }));
    vi.resetModules();
    const { reserve } = await import("./services/generationLedger");

    await expect(
      reserve({ actionId: "over", provider: "p", model: "m", operation: "o", estimatedCostUsd: 2, dailyBudgetUsd: 10 }),
    ).rejects.toThrow(/BUDGET_DAILY_EXCEEDED/);
    // compensation: the inserted row was flipped to released
    expect(state.rows[state.rows.length - 1].status).toBe("released");
  });
});

describe("settle", () => {
  it("marks actuals and clears the estimate flag", async () => {
    const state = {
      rows: [{ id: "res_1", actionId: "reel_job_9", status: "reserved", isEstimate: true }] as Array<Record<string, unknown>>,
    };
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeLedgerDb(state)) }));
    vi.resetModules();
    const { settle } = await import("./services/generationLedger");
    await settle("reel_job_9", 1.25);
    expect(state.rows[0].status).toBe("settled");
    expect(state.rows[0].actualCostUsd).toBe("1.2500");
    expect(state.rows[0].isEstimate).toBe(false);
  });
});
