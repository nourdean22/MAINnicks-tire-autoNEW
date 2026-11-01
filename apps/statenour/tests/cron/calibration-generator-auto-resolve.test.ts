/**
 * The calibration-generator tick runs the allowlist auto-resolver and reports
 * its summary; a resolver failure is reported, never thrown out of the tick
 * (job 2026-10-31-self-learning-statenour W1).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("@/lib/utils/http", () => ({ cronHandler: (fn: unknown) => fn }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { updateMany: async () => ({ count: 0 }) },
    prediction: { findMany: async () => [] },
    task: { findMany: async () => [] },
    calibrationReviewItem: { upsert: async () => ({}) },
  },
}));
vi.mock("@/lib/brain/calibration-engine", () => ({ proposeTaskRoi: vi.fn(), proposePredictionOutcome: vi.fn() }));
vi.mock("@/lib/services/calibration-auto-resolve", () => ({ runCalibrationAutoResolve: h.run }));

import { GET } from "@/app/api/cron/calibration-generator/route";

const run = () => (GET as unknown as () => Promise<Record<string, any>>)();

// Braces matter: a function returned from beforeEach runs as teardown, which would call the mock again.
beforeEach(() => {
  h.run.mockReset();
});

describe("calibration-generator: auto-resolve step", () => {
  it("runs the resolver once per tick and returns its summary", async () => {
    h.run.mockResolvedValue({ armed: false, scanned: 3, shadowed: 2, held: 1 });
    const res = await run();
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(res.autoResolve).toEqual({ armed: false, scanned: 3, shadowed: 2, held: 1 });
  });

  it("a resolver failure is reported in the result, the tick still returns", async () => {
    h.run.mockImplementation(async () => {
      throw new Error("db down");
    });
    const res = await run();
    expect(res.autoResolve).toEqual({ error: "db down" });
    expect(res.predictions).toMatchObject({ errors: 0 });
  });
});
