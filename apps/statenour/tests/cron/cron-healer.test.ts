import { describe, it, expect, vi, beforeEach } from "vitest";

// Define mock functions so vitest can track calls and control outputs
const mocks = {
  buildCronCommandDeck: vi.fn(),
  runManifestCron: vi.fn(),
  recordCoachEvent: vi.fn(),
};

// Mock dependencies
vi.mock("@/lib/services/system-pages", () => ({
  buildCronCommandDeck: () => mocks.buildCronCommandDeck(),
}));

vi.mock("@/lib/services/cron-control", () => ({
  runManifestCron: (name: string) => mocks.runManifestCron(name),
}));

vi.mock("@/lib/services/coach-events", () => ({
  recordCoachEvent: (input: unknown) => mocks.recordCoachEvent(input),
}));

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: unknown) => h,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { GET } from "@/app/api/cron/cron-healer/route";

const baseReq = new Request("http://test/api/cron/cron-healer");
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cron/cron-healer", () => {
  it("does nothing when all crons are healthy and active", async () => {
    mocks.buildCronCommandDeck.mockResolvedValueOnce({
      rows: [
        {
          name: "ingest-gmail",
          enabled: true,
          mode: "active",
          lastStatus: "success",
          lastRunAt: "2026-06-13T10:00:00Z",
          success14d: 14,
          fail14d: 0,
        },
        {
          name: "stale-tasks",
          enabled: true,
          mode: "active",
          lastStatus: "success",
          lastRunAt: "2026-06-13T10:00:00Z",
          success14d: 1,
          fail14d: 0,
        },
      ],
    });

    const result = await GET();
    expect(result).toEqual({
      status: "ok",
      healed: [],
      errors: [],
    });
    expect(mocks.runManifestCron).not.toHaveBeenCalled();
    expect(mocks.recordCoachEvent).not.toHaveBeenCalled();
  });

  it("skips retired, disabled, or self cron-healer even if they are failing", async () => {
    mocks.buildCronCommandDeck.mockResolvedValueOnce({
      rows: [
        {
          name: "stale-tasks",
          enabled: false,
          mode: "active",
          lastStatus: "failed",
          fail14d: 1,
        },
        {
          name: "retired-cron",
          enabled: true,
          mode: "retired",
          lastStatus: "failed",
          fail14d: 5,
        },
        {
          name: "cron-healer",
          enabled: true,
          mode: "folded",
          lastStatus: "failed",
          fail14d: 2,
        },
      ],
    });

    const result = await GET();
    expect(result).toEqual({
      status: "ok",
      healed: [],
      errors: [],
    });
    expect(mocks.runManifestCron).not.toHaveBeenCalled();
  });

  it("heals failing crons and logs a P0 coach event", async () => {
    mocks.buildCronCommandDeck.mockResolvedValueOnce({
      rows: [
        {
          name: "ingest-gmail",
          enabled: true,
          mode: "active",
          lastStatus: "failed",
          lastRunAt: "2026-06-13T10:00:00Z",
          success14d: 10,
          fail14d: 2,
        },
      ],
    });
    mocks.runManifestCron.mockResolvedValueOnce({
      ok: true,
      status: 200,
      durationMs: 120,
    });

    const result = await GET();
    expect(result).toEqual({
      status: "ok",
      healed: ["ingest-gmail"],
      errors: [],
    });
    expect(mocks.runManifestCron).toHaveBeenCalledWith("ingest-gmail");
    expect(mocks.recordCoachEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "system-alert",
        subjectId: "cron-heal:ingest-gmail",
        priority: "P0",
        title: expect.stringContaining("Cron Healer: Rescued ingest-gmail"),
      })
    );
  });

  it("heals never-run crons and logs a P1 coach event", async () => {
    mocks.buildCronCommandDeck.mockResolvedValueOnce({
      rows: [
        {
          name: "predict",
          enabled: true,
          mode: "active",
          lastStatus: null,
          lastRunAt: null,
          success14d: 0,
          fail14d: 0,
        },
      ],
    });
    mocks.runManifestCron.mockResolvedValueOnce({
      ok: true,
      status: 200,
      durationMs: 400,
    });

    const result = await GET();
    expect(result).toEqual({
      status: "ok",
      healed: ["predict"],
      errors: [],
    });
    expect(mocks.runManifestCron).toHaveBeenCalledWith("predict");
    expect(mocks.recordCoachEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "system-alert",
        subjectId: "cron-heal:predict",
        priority: "P1",
        title: expect.stringContaining("Cron Healer: Rescued predict"),
      })
    );
  });

  it("limits healing to MAX_HEAL_PER_RUN (3) jobs in a single run", async () => {
    mocks.buildCronCommandDeck.mockResolvedValueOnce({
      rows: [
        { name: "cron1", enabled: true, mode: "active", lastRunAt: null, success14d: 0, fail14d: 0 },
        { name: "cron2", enabled: true, mode: "active", lastRunAt: null, success14d: 0, fail14d: 0 },
        { name: "cron3", enabled: true, mode: "active", lastRunAt: null, success14d: 0, fail14d: 0 },
        { name: "cron4", enabled: true, mode: "active", lastRunAt: null, success14d: 0, fail14d: 0 },
      ],
    });
    mocks.runManifestCron.mockResolvedValue({
      ok: true,
      status: 200,
      durationMs: 50,
    });

    const result = await GET();
    expect(result.healed.length).toBe(3);
    expect(result.healed).toEqual(["cron1", "cron2", "cron3"]);
    expect(mocks.runManifestCron).toHaveBeenCalledTimes(3);
  });

  it("captures errors in errors list if a trigger throws without stopping execution of remaining crons", async () => {
    mocks.buildCronCommandDeck.mockResolvedValueOnce({
      rows: [
        { name: "cron1", enabled: true, mode: "active", lastStatus: "failed", fail14d: 1 },
        { name: "cron2", enabled: true, mode: "active", lastStatus: "failed", fail14d: 1 },
      ],
    });
    mocks.runManifestCron
      .mockRejectedValueOnce(new Error("Timeout failure"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        durationMs: 80,
      });

    const result = await GET();
    expect(result).toEqual({
      status: "ok",
      healed: ["cron2"],
      errors: ["cron1: Timeout failure"],
    });
    expect(mocks.runManifestCron).toHaveBeenCalledTimes(2);
    expect(mocks.recordCoachEvent).toHaveBeenCalledTimes(1); // Only for cron2
  });
});
