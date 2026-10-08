/**
 * Content experiment resolver · doctrine tests.
 *
 * Pins the mechanism that lets experiments conclude: metric-name → snapshot
 * column mapping (an unmapped metric is reported unmeasurable, never guessed),
 * verdict recording per running experiment, and error isolation (one broken
 * experiment cannot take down the resolver run).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  loadRunningExperiments: vi.fn(),
  recordVerdict: vi.fn(),
}));

vi.mock("../../services/contentExperimentStore", () => ({
  loadRunningExperiments: mocks.loadRunningExperiments,
  recordVerdict: mocks.recordVerdict,
}));

import { processContentExperimentResolve } from "./contentExperimentResolve";

const def = (overrides: Record<string, unknown> = {}) => ({
  experimentId: "hook-style-direct-v1",
  primaryVariable: "hook_style",
  objective: "discovery",
  primaryMetric: "shares_per_reach",
  arms: [
    { armId: "hook-control", variantValue: "baseline" },
    { armId: "hook-direct", variantValue: "direct" },
  ],
  startedAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

describe("processContentExperimentResolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no running experiments → quiet one-SELECT no-op that says so", async () => {
    mocks.loadRunningExperiments.mockResolvedValue([]);
    const result = await processContentExperimentResolve();
    expect(result.recordsProcessed).toBe(0);
    expect(result.details).toBe("no running experiments");
    expect(mocks.recordVerdict).not.toHaveBeenCalled();
  });

  it("maps the vocabulary metric to its snapshot column (shares_per_reach → shares)", async () => {
    mocks.loadRunningExperiments.mockResolvedValue([def()]);
    mocks.recordVerdict.mockResolvedValue({ status: "insufficient_data", needed: 4, have: 1, note: "" });
    const result = await processContentExperimentResolve();
    expect(mocks.recordVerdict).toHaveBeenCalledWith(expect.objectContaining({ experimentId: "hook-style-direct-v1" }), "shares", 72);
    expect(result.recordsProcessed).toBe(1);
    expect(result.details).toContain("insufficient_data");
  });

  it("a metric with no snapshot column is reported unmeasurable, never guessed", async () => {
    mocks.loadRunningExperiments.mockResolvedValue([def({ experimentId: "dm-test", primaryMetric: "dms" })]);
    const result = await processContentExperimentResolve();
    expect(mocks.recordVerdict).not.toHaveBeenCalled();
    expect(result.details).toContain("unmeasurable metric dms");
  });

  it("one broken experiment cannot take down the run — error isolated per experiment", async () => {
    mocks.loadRunningExperiments.mockResolvedValue([
      def({ experimentId: "broken" }),
      def({ experimentId: "healthy" }),
    ]);
    mocks.recordVerdict
      .mockRejectedValueOnce(new Error("snapshot table locked"))
      .mockResolvedValueOnce({ status: "winner", armId: "hook-direct", variantValue: "direct", lift: 0.4, note: "" });
    const result = await processContentExperimentResolve();
    expect(result.recordsProcessed).toBe(1);
    expect(result.details).toContain("broken: ERROR");
    expect(result.details).toContain("healthy: winner");
  });
});

describe("skip rate is resolvable (2026-10-08)", () => {
  it("an experiment on skip_rate is gathered from the skipRate column, not reported unmeasurable", async () => {
    vi.clearAllMocks();
    mocks.loadRunningExperiments.mockResolvedValue([def({ experimentId: "hook-skip-v1", primaryMetric: "skip_rate" })]);
    mocks.recordVerdict.mockResolvedValue({ status: "insufficient_data", needed: 4, have: 1, note: "" });
    const r = await processContentExperimentResolve();
    expect(mocks.recordVerdict).toHaveBeenCalledWith(expect.objectContaining({ experimentId: "hook-skip-v1" }), "skipRate", 72);
    expect(r.details).not.toContain("unmeasurable");
  });
});

describe("an unwired preset is never judged (2026-10-08)", () => {
  it("a running exposed preset is reported, not measured, so it cannot conclude a false tie", async () => {
    vi.clearAllMocks();
    mocks.loadRunningExperiments.mockResolvedValue([
      def({ experimentId: "audio-style-v1", primaryVariable: "audio_style", primaryMetric: "avg_watch_time" }),
      def(),
    ]);
    mocks.recordVerdict.mockResolvedValue({ status: "insufficient_data", needed: 4, have: 1, note: "" });
    const r = await processContentExperimentResolve();
    expect(mocks.recordVerdict).toHaveBeenCalledTimes(1);
    expect(mocks.recordVerdict).toHaveBeenCalledWith(expect.objectContaining({ experimentId: "hook-style-direct-v1" }), "shares", 72);
    expect(r.details).toContain("audio-style-v1: not wired, not judged");
  });
});
