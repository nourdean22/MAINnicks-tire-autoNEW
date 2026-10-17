/**
 * Judge calibration metrics row (deep scout v2 item 7, scout 7).
 *
 * Kappa and the two error rates are null when they cannot be computed (no data, one class,
 * an empty denominator). A null must read "unknown", never 0 and never a bare dash: 0 would
 * say "no chance-corrected agreement" or "the judge never errs", which is a claim.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  JudgeCalibrationMetrics,
  formatKappa,
  formatRate,
} from "@/components/system/judge-calibration-panel-metrics";

describe("formatters", () => {
  it("null is unknown, never 0 or a dash", () => {
    expect(formatKappa(null)).toBe("unknown");
    expect(formatRate(null)).toBe("unknown");
  });

  it("CONTROL: real values, including a real zero, still print as numbers", () => {
    expect(formatKappa(0.53)).toBe("0.53");
    expect(formatKappa(0)).toBe("0.00");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(1)).toBe("100%");
    expect(formatRate(10 / 30)).toBe("33%");
  });
});

describe("JudgeCalibrationMetrics", () => {
  it("renders unknown for all three when everything is null", () => {
    const html = renderToStaticMarkup(
      <JudgeCalibrationMetrics kappa={null} falsePassRate={null} falseFailRate={null} />,
    );
    expect((html.match(/unknown/g) ?? []).length).toBe(3);
    expect(html).not.toContain("0%");
    expect(html).not.toContain("0.00");
  });

  it("CONTROL: renders the numbers beside their labels when present", () => {
    const html = renderToStaticMarkup(
      <JudgeCalibrationMetrics kappa={0.53} falsePassRate={1} falseFailRate={0} />,
    );
    expect(html).toContain("0.53");
    expect(html).toContain("100%");
    expect(html).toContain("0%");
    expect(html).not.toContain("unknown");
    expect(html.toLowerCase()).toContain("kappa");
    expect(html.toLowerCase()).toContain("false pass");
    expect(html.toLowerCase()).toContain("false fail");
  });
});
