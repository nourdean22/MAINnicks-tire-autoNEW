/**
 * calibration-generator keys "today" in ET (audit 03-F12, 2026-10-11).
 *
 * It runs at 03:00 UTC, which is the previous evening in ET; a UTC slice made
 * predictions due "tomorrow" (ET) count as due tonight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/utils/http", () => ({ cronHandler: (fn: unknown) => fn }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { updateMany: async () => ({ count: 0 }) },
    prediction: { findMany: h.findMany },
    task: { findMany: async () => [] },
    calibrationReviewItem: { upsert: async () => ({}), findMany: async () => [] },
  },
}));
vi.mock("@/lib/brain/calibration-engine", () => ({
  proposeTaskRoi: vi.fn(),
  proposePredictionOutcome: vi.fn(),
}));

import { GET } from "@/app/api/cron/calibration-generator/route";

const run = () => (GET as unknown as () => Promise<unknown>)();
const targetLte = () => (h.findMany.mock.calls[0][0] as { where: { targetDate: { lte: string } } }).where.targetDate.lte;

beforeEach(() => {
  h.findMany.mockReset();
  h.findMany.mockResolvedValue([]);
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("calibration-generator: ET today", () => {
  it("at 03:00 UTC (23:00 ET the day before) predictions are due through the ET date", async () => {
    vi.setSystemTime(new Date("2026-10-10T03:00:00Z"));
    await run();
    expect(targetLte()).toBe("2026-10-09");
  });

  it("CONTROL: at 16:00 UTC the ET and UTC dates agree", async () => {
    vi.setSystemTime(new Date("2026-10-10T16:00:00Z"));
    await run();
    expect(targetLte()).toBe("2026-10-10");
  });
});
