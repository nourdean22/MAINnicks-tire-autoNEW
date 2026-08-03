/**
 * reelClipCost.test.ts · 2026-08-03
 *
 * The reel cost sites multiplied by COST_ESTIMATES_USD.seedance_clip regardless
 * of which provider rendered the clip, and there was no veo entry at all.
 *
 * reelPipeline had already been fixed once for this exact bug — the comment above
 * its reservation records job 1200003 logging provider="veo" while the ledger held
 * zero veo rows — but that fix corrected the `provider` and `model` columns and
 * left the dollar amount behind. The columns said Veo; the money said Higgsfield.
 *
 * That figure is what reserve() compares against maxGenerationCostPerDayUsd, so
 * the undercount made the daily spend ceiling proportionally too permissive, and
 * made a Fast -> Lite switch record identical cost before and after.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COST_ESTIMATES_USD,
  VEO_DEFAULT_CLIP_SECONDS,
  reelClipCostUsd,
} from "./services/generationLedger";

/**
 * Every case passes an explicit env object rather than mutating process.env.
 * Serial vitest shares ONE process across files, so a leaked REEL_VEO_* value
 * would resurface as a pricing failure in an unrelated suite.
 */
const EMPTY_ENV = {} as NodeJS.ProcessEnv;

afterEach(() => {
  // Nothing is mutated, but assert that stays true: a future case that reaches
  // for process.env would otherwise leak silently into the next file.
  expect(process.env.REEL_VEO_USD_PER_SECOND).toBeUndefined();
  vi.doUnmock("./db");
  vi.resetModules();
});

/**
 * Minimal ledger fake, mirroring server/generationLedger.test.ts. `insert` records
 * the row so the PERSISTED amount can be asserted — a pure-function test on
 * reelClipCostUsd would have passed against the broken code too, because the bug
 * was never in the arithmetic. It was that the arithmetic was never consulted.
 */
function fakeLedgerDb(state: { rows: Array<Record<string, unknown>> }) {
  return {
    select: () => ({
      from: () => ({
        where: () => {
          const p = Promise.resolve(state.rows) as Promise<unknown> & {
            limit: (n: number) => Promise<unknown>;
          };
          p.limit = () => Promise.resolve([]);
          return p;
        },
      }),
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

describe("reelClipCostUsd · the provider decides the price", () => {
  it("prices a Veo clip per second, not at the Higgsfield per-clip rate", () => {
    const cost = reelClipCostUsd("veo", EMPTY_ENV);

    expect(cost).toBeCloseTo(VEO_DEFAULT_CLIP_SECONDS * COST_ESTIMATES_USD.veo_second_720p, 10);
  });

  it("keeps the Seedance per-clip estimate for higgsfield", () => {
    expect(reelClipCostUsd("higgsfield", EMPTY_ENV)).toBe(COST_ESTIMATES_USD.seedance_clip);
  });

  /**
   * The regression this file exists for. Both providers previously returned the
   * same number, so any test asserting only one of them would have passed against
   * the broken code. Assert they DIFFER.
   */
  it("does not charge Veo and Higgsfield the same amount", () => {
    expect(reelClipCostUsd("veo", EMPTY_ENV)).not.toBe(reelClipCostUsd("higgsfield", EMPTY_ENV));
  });

  it("makes a rate change visible, so a provider switch is measurable", () => {
    const fast = reelClipCostUsd("veo", { REEL_VEO_USD_PER_SECOND: "0.10" } as NodeJS.ProcessEnv);
    const lite = reelClipCostUsd("veo", { REEL_VEO_USD_PER_SECOND: "0.05" } as NodeJS.ProcessEnv);

    expect(lite).toBeCloseTo(fast / 2, 10);
  });

  it("honours an explicit clip duration", () => {
    const cost = reelClipCostUsd("veo", { REEL_VEO_DURATION: "4" } as NodeJS.ProcessEnv);

    expect(cost).toBeCloseTo(4 * COST_ESTIMATES_USD.veo_second_720p, 10);
  });
});

/**
 * Trajectory through the service boundary: cost -> reserve() -> policy check ->
 * persisted row. The unit cases above prove the arithmetic; these prove the
 * arithmetic actually reaches the ledger and the budget guard, which is where
 * the original defect lived.
 */
describe("reel spend trajectory · the persisted amount follows the provider", () => {
  async function reserveFor(provider: string, beats: number, dailyBudgetUsd?: number) {
    const state = { rows: [] as Array<Record<string, unknown>> };
    const db = fakeLedgerDb(state);
    // reserve() selects twice: an existence check, then a post-insert re-sum that
    // expects a [{ total }] aggregate. Compute that total from what was actually
    // persisted, so the budget branch is driven by the reserved amount rather than
    // a hard-coded number — otherwise this test could not tell the two prices apart.
    const origSelect = db.select.bind(db);
    let selectCount = 0;
    db.select = ((proj?: unknown) => {
      selectCount++;
      if (selectCount >= 2) {
        const total = state.rows.reduce((sum, r) => sum + Number(r.estimatedCostUsd ?? 0), 0);
        return { from: () => ({ where: () => Promise.resolve([{ total: String(total) }]) }) } as never;
      }
      return origSelect(proj);
    }) as typeof db.select;
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(db) }));
    vi.resetModules();
    const ledger = await import("./services/generationLedger");

    const row = await ledger.reserve({
      actionId: `reel_job_${provider}`,
      provider,
      model: provider === "veo" ? "veo-3.1-fast-generate-preview" : "seedance1_5",
      operation: "reel_clips",
      estimatedCostUsd: beats * ledger.reelClipCostUsd(provider),
      ...(dailyBudgetUsd !== undefined ? { dailyBudgetUsd } : {}),
    });
    return { row, state };
  }

  it("persists a Veo reservation at the Veo rate, not the Seedance rate", async () => {
    const beats = 6;
    const { row } = await reserveFor("veo", beats);

    const seedancePrice = beats * COST_ESTIMATES_USD.seedance_clip;
    expect(row).not.toBeNull();
    expect(row!.estimatedCostUsd).toBeCloseTo(
      beats * VEO_DEFAULT_CLIP_SECONDS * COST_ESTIMATES_USD.veo_second_720p,
      10,
    );
    // The exact assertion the old code would have failed: it booked this number.
    expect(row!.estimatedCostUsd).not.toBeCloseTo(seedancePrice, 10);
  });

  it("still persists a Higgsfield reservation at the Seedance rate", async () => {
    const beats = 6;
    const { row } = await reserveFor("higgsfield", beats);

    expect(row!.estimatedCostUsd).toBeCloseTo(beats * COST_ESTIMATES_USD.seedance_clip, 10);
  });

  /**
   * The consequence that made this a money bug rather than a reporting one:
   * estimatedCostUsd is what reserve() compares against the daily ceiling, so
   * underpricing Veo let a reel through a budget that should have stopped it.
   */
  it("trips the daily ceiling at the Veo price where the Seedance price would have passed", async () => {
    const beats = 6;
    const seedancePrice = beats * COST_ESTIMATES_USD.seedance_clip;
    const veoPrice = beats * VEO_DEFAULT_CLIP_SECONDS * COST_ESTIMATES_USD.veo_second_720p;
    // A ceiling deliberately between the two prices.
    const budget = (seedancePrice + veoPrice) / 2;
    expect(budget).toBeGreaterThan(seedancePrice);
    expect(budget).toBeLessThan(veoPrice);

    await expect(reserveFor("veo", beats, budget)).rejects.toThrow(/BUDGET_DAILY_EXCEEDED/);

    // Same job, same budget, priced as Higgsfield — passes. That gap is exactly
    // how much guard the undercount was giving away.
    const { row } = await reserveFor("higgsfield", beats, budget);
    expect(row).not.toBeNull();
  });
});

describe("reelClipCostUsd · a malformed override never books a zero", () => {
  const junk: Array<[string, string]> = [
    ["empty string", ""],
    ["non-numeric", "abc"],
  ];

  for (const [label, value] of junk) {
    it(`falls back to the default rate on a ${label} REEL_VEO_USD_PER_SECOND`, () => {
      const cost = reelClipCostUsd("veo", { REEL_VEO_USD_PER_SECOND: value } as NodeJS.ProcessEnv);

      // A zero here would be worse than a wrong number: it would report every
      // reel as free and disable the daily ceiling entirely.
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeCloseTo(VEO_DEFAULT_CLIP_SECONDS * COST_ESTIMATES_USD.veo_second_720p, 10);
    });

    it(`falls back to the default duration on a ${label} REEL_VEO_DURATION`, () => {
      const cost = reelClipCostUsd("veo", { REEL_VEO_DURATION: value } as NodeJS.ProcessEnv);

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeCloseTo(VEO_DEFAULT_CLIP_SECONDS * COST_ESTIMATES_USD.veo_second_720p, 10);
    });
  }
});
