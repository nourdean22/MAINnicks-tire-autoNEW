import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = {
  runAutonomicOrchestrator: vi.fn(),
};

// Mock the autonomic orchestrator service
vi.mock("@/lib/services/autonomic-orchestrator", () => ({
  runAutonomicOrchestrator: () => mocks.runAutonomicOrchestrator(),
}));

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: unknown) => h,
}));

import { GET } from "@/app/api/cron/cron-healer/route";

describe("cron/cron-healer route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls runAutonomicOrchestrator and returns its results", async () => {
    const mockResult = {
      healedCrons: ["test-cron"],
      cronErrors: [],
      vacuumedTables: ["CronJobLog"],
      indexReindexed: false,
      avgLatencyMs: 45,
      ollamaQuotaTripped: false,
      rescuedWorkItems: [],
      prunedLogsCount: 150,
      archivedTasksCount: 5,
    };

    mocks.runAutonomicOrchestrator.mockResolvedValueOnce(mockResult);

    const result = await GET();

    expect(mocks.runAutonomicOrchestrator).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "ok",
      ...mockResult,
    });
  });
});
