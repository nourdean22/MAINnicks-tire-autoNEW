/**
 * The calibration block tells Nick how to phrase a shop forecast, and the phrasing it teaches must be
 * exactly what extractPredictions scores (assert the consumer): otherwise the prompt asks for
 * predictions the loop can never resolve.
 */
import { describe, expect, it } from "vitest";
import { BUSINESS_FORECAST_RULE, buildCalibrationPromptBlock, extractPredictions } from "@/lib/ai/outcome-calibration";

const empty = { resolvedCount: 0, within20PctRate: null, within40PctRate: null, meanErrorPct: null, meanBiasPct: null } as never;
const calibrated = { resolvedCount: 40, within20PctRate: 0.5, within40PctRate: 0.8, meanErrorPct: 0.25, meanBiasPct: 0.05 } as never;

describe("calibration block teaches a scoreable forecast", () => {
  it("both branches carry the rule", () => {
    expect(buildCalibrationPromptBlock(empty)).toContain(BUSINESS_FORECAST_RULE);
    expect(buildCalibrationPromptBlock(calibrated)).toContain(BUSINESS_FORECAST_RULE);
  });

  it("the rule's own examples extract as a clicks and a revenue prediction with a window", () => {
    const examples = BUSINESS_FORECAST_RULE.match(/"[^"]+"/g)!.map((q) => q.slice(1, -1));
    const at = new Date("2026-10-14T15:00:00Z");
    const metrics = examples.flatMap((e) => extractPredictions(e, at)).filter((p) => p.metric === "clicks" || p.metric === "revenue");
    expect(metrics.map((p) => p.metric).sort()).toEqual(["clicks", "revenue"]);
    for (const p of metrics) expect((p as { window?: unknown }).window).toBeTruthy();
  });

  it("control: the vague example it warns against extracts nothing scoreable", () => {
    const vague = extractPredictions("more clicks than usual", new Date("2026-10-14T15:00:00Z"));
    expect(vague.filter((p) => p.metric === "clicks" || p.metric === "revenue")).toEqual([]);
  });
});
