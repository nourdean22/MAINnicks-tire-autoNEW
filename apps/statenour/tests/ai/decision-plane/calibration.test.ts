import { describe, expect, it } from "vitest";
import {
  categoricalLogLoss,
  expectedCalibrationError,
  multiclassBrier,
} from "@/lib/ai/decision-plane/calibration";

describe("decision calibration math", () => {
  it("gives a perfect multiclass forecast zero Brier", () => {
    expect(multiclassBrier({ a: 1, b: 0 }, "a")).toBe(0);
  });

  it("rejects invalid distributions instead of scoring garbage", () => {
    expect(multiclassBrier({ a: 0.2, b: 0.2 }, "a")).toBeNull();
    expect(multiclassBrier({ a: 0.5, b: 0.5 }, "missing")).toBeNull();
  });

  it("computes categorical log loss from the observed label", () => {
    expect(categoricalLogLoss({ a: 0.8, b: 0.2 }, "a")).toBeCloseTo(
      -Math.log(0.8),
    );
  });

  it("reports top-label ECE over resolved samples", () => {
    const result = expectedCalibrationError(
      [
        { probabilities: { yes: 0.9, no: 0.1 }, observed: "yes" },
        { probabilities: { yes: 0.8, no: 0.2 }, observed: "yes" },
        { probabilities: { yes: 0.9, no: 0.1 }, observed: "no" },
      ],
      5,
    );

    expect(result.ece).not.toBeNull();
    expect(result.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(3);
  });
});
