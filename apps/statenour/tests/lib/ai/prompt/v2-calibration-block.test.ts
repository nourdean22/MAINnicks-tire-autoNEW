/**
 * buildCalibrationBlock · the wire that closed the outcome loop's last mile.
 *
 * buildCalibrationPromptBlock had ZERO production callers between the V2
 * cutover (2026-06-29) and 2026-08-05 while the nightly Brier pipeline kept
 * resolving predictions nobody read. These tests assert the MECHANISM of the
 * wire, not merely exercise it: the block renders from stats, the kill-switch
 * suppresses it, and a broken stats query fails OPEN (empty string, prompt
 * assembly unharmed) rather than throwing into the prompt path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getFlag: vi.fn(),
  getCalibrationStats: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/feature-flags", () => ({
  getFlag: mocks.getFlag,
}));

vi.mock("@/lib/utils/error-log", () => ({
  logError: mocks.logError,
}));

vi.mock("@/lib/ai/outcome-calibration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/outcome-calibration")>();
  return {
    ...actual,
    getCalibrationStats: mocks.getCalibrationStats,
  };
});

import { buildCalibrationBlock } from "@/lib/ai/prompt/v2";

const healthyStats = {
  totalPredictions: 40,
  resolvedCount: 25,
  pendingCount: 15,
  meanErrorPct: 0.18,
  within20PctRate: 0.6,
  within40PctRate: 0.85,
  meanBiasPct: 0.02,
};

describe("buildCalibrationBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFlag.mockReturnValue({ isOn: false });
  });

  it("renders the calibration block from resolved stats", async () => {
    mocks.getCalibrationStats.mockResolvedValue(healthyStats);
    const block = await buildCalibrationBlock();
    expect(block).toContain("PREDICTION CALIBRATION");
    expect(block).toContain("25 resolved");
  });

  it("emits the insufficient-data hedge below 5 resolved (still a block, not empty)", async () => {
    mocks.getCalibrationStats.mockResolvedValue({ ...healthyStats, resolvedCount: 2 });
    const block = await buildCalibrationBlock();
    expect(block).toContain("insufficient data");
  });

  it("kill-switch CALIBRATION_PROMPT_BLOCK_DISABLED suppresses the block", async () => {
    mocks.getFlag.mockReturnValue({ isOn: true });
    const block = await buildCalibrationBlock();
    expect(block).toBe("");
    expect(mocks.getCalibrationStats).not.toHaveBeenCalled();
  });

  it("fails OPEN when the stats query throws — logs, injects nothing, never throws", async () => {
    mocks.getCalibrationStats.mockRejectedValue(new Error("db down"));
    const block = await buildCalibrationBlock();
    expect(block).toBe("");
    expect(mocks.logError).toHaveBeenCalledWith(
      "ai.prompt-v2",
      expect.any(Error),
      expect.objectContaining({ fn: "buildCalibrationBlock" }),
    );
  });
});
