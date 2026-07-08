/**
 * prediction-outcomes-resolve · unit corpus · 2026-07-07
 *
 * The job is the missing writer for the service-affinity closed loop.
 * These tests pin the contract: two INSERT passes (early-match first,
 * then window-closed misses), affectedRows summed into recordsProcessed,
 * per-arm split in the details string, and a graceful no-DB path.
 * SQL correctness against real TiDB is a post-deploy verification
 * (cron_log details on the first prod run), not claimed here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getDbMock, executeMock } = vi.hoisted(() => {
  const executeMock = vi.fn();
  return { executeMock, getDbMock: vi.fn(async () => ({ execute: executeMock })) };
});
vi.mock("../../db", () => ({ getDb: getDbMock }));

import { processPredictionOutcomesResolve } from "./predictionOutcomesResolve";

beforeEach(() => {
  vi.clearAllMocks();
  getDbMock.mockImplementation(async () => ({ execute: executeMock }));
});

describe("processPredictionOutcomesResolve", () => {
  it("runs match pass, miss pass, then arm readout — and sums inserts", async () => {
    executeMock
      .mockResolvedValueOnce([{ affectedRows: 3 }]) // pass 1 · early matches
      .mockResolvedValueOnce([{ affectedRows: 5 }]) // pass 2 · closed-window misses
      .mockResolvedValueOnce([
        [
          { arm: "treatment", resolved: 40, matched: 6 },
          { arm: "control", resolved: 38, matched: 2 },
        ],
      ]);

    const r = await processPredictionOutcomesResolve();

    expect(executeMock).toHaveBeenCalledTimes(3);
    expect(r.recordsProcessed).toBe(8);
    expect(r.details).toContain("matched=3 misses=5");
    expect(r.details).toContain("treatment=6/40 (15%)");
    expect(r.details).toContain("control=2/38 (5.3%)");
  });

  it("reports 'no resolved rows yet' when the outcomes table is empty", async () => {
    executeMock
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([[]]);

    const r = await processPredictionOutcomesResolve();

    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toContain("no resolved rows yet");
  });

  it("arm-readout failure is non-fatal — inserts still count", async () => {
    executeMock
      .mockResolvedValueOnce([{ affectedRows: 2 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockRejectedValueOnce(new Error("boom"));

    const r = await processPredictionOutcomesResolve();

    expect(r.recordsProcessed).toBe(3);
    expect(r.details).toContain("no resolved rows yet");
  });

  it("is a graceful no-op when the DB is unavailable", async () => {
    getDbMock.mockImplementation(async () => null);

    const r = await processPredictionOutcomesResolve();

    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toBe("db unavailable");
    expect(executeMock).not.toHaveBeenCalled();
  });
});
