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
  reactionCounts,
} from "@/components/system/judge-calibration-panel-metrics";
import { computeCalibration } from "@/lib/services/judge-calibration";

const base = { kappa: null, falsePassRate: null, falseFailRate: null, thumbsUp: 0, thumbsDown: 0, preliminary: false };

describe("formatters", () => {
  it("null is unknown, never 0 or a dash", () => {
    expect(formatKappa(null)).toBe("unknown");
    expect(formatRate(null)).toBe("unknown");
  });

  it("CONTROL: real values, including a real zero, still print as numbers", () => {
    expect(formatKappa(0.53)).toBe("0.53");
    expect(formatKappa(0)).toBe("0.00");
    expect(formatKappa(-0.001)).toBe("0.00");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(1)).toBe("100%");
    expect(formatRate(10 / 30)).toBe("33%");
  });

  it("kappa prints the same 2-place value the verdict bands compare", () => {
    expect(formatKappa(0.597)).toBe("0.60");
    expect(formatKappa(0.595)).toBe("0.59");
  });
});

describe("JudgeCalibrationMetrics", () => {
  it("renders unknown for all three when everything is null", () => {
    const html = renderToStaticMarkup(<JudgeCalibrationMetrics {...base} />);
    expect((html.match(/unknown/g) ?? []).length).toBe(3);
    expect(html).not.toContain("0%");
    expect(html).not.toContain("0.00");
  });

  it("CONTROL: renders the numbers beside their labels when present", () => {
    const html = renderToStaticMarkup(
      <JudgeCalibrationMetrics {...base} kappa={0.53} falsePassRate={1} falseFailRate={0} thumbsUp={5} thumbsDown={3} />,
    );
    expect(html).toContain("0.53");
    expect(html).toContain("100%");
    expect(html).toContain("0%");
    expect(html).not.toContain("unknown");
    expect(html.toLowerCase()).toContain("kappa");
    expect(html.toLowerCase()).toContain("false pass");
    expect(html.toLowerCase()).toContain("false fail");
  });

  it("names the denominator of each rate", () => {
    const html = renderToStaticMarkup(
      <JudgeCalibrationMetrics {...base} falsePassRate={0.25} falseFailRate={0.5} thumbsUp={12} thumbsDown={8} />,
    );
    expect(html).toContain("of 8 thumbs-downs");
    expect(html).toContain("of 12 thumbs-ups");
  });

  it("uses the singular for one reaction", () => {
    const html = renderToStaticMarkup(<JudgeCalibrationMetrics {...base} thumbsUp={1} thumbsDown={1} />);
    expect(html).toContain("of 1 thumbs-down,");
    expect(html).toContain("of 1 thumbs-up,");
  });

  it("is labelled preliminary only when the verdict is preliminary", () => {
    expect(renderToStaticMarkup(<JudgeCalibrationMetrics {...base} preliminary />)).toContain("preliminary");
    expect(renderToStaticMarkup(<JudgeCalibrationMetrics {...base} />)).not.toContain("preliminary");
  });
});

describe("a report flows to the rendered tile", () => {
  type Row = { winner: "v1" | "v2"; sourceMessageId: string; feedbackScore: number };
  const rows = (v2Up: number, v1Up: number): Row[] => [
    ...Array.from({ length: v2Up }, (_, i): Row => ({ winner: "v2", sourceMessageId: `a${i}`, feedbackScore: 1 })),
    ...Array.from({ length: v1Up }, (_, i): Row => ({ winner: "v1", sourceMessageId: `b${i}`, feedbackScore: 1 })),
  ];

  it("one-class reactions (all thumbs-up, mixed judge) render kappa as unknown, not 0.00", () => {
    const r = computeCalibration(rows(20, 20), 30);
    const { thumbsUp, thumbsDown } = reactionCounts(r.matrix);
    const html = renderToStaticMarkup(
      <JudgeCalibrationMetrics
        kappa={r.kappa}
        falsePassRate={r.falsePassRate}
        falseFailRate={r.falseFailRate}
        thumbsUp={thumbsUp}
        thumbsDown={thumbsDown}
        preliminary={r.verdict === "preliminary"}
      />,
    );
    expect(r.verdict).toBe("preliminary");
    expect(html).not.toContain("0.00");
    expect((html.match(/unknown/g) ?? []).length).toBe(2); // kappa and false pass (no thumbs-down); false fail is 50%
    expect(html).toContain("50%");
    expect(html).toContain("of 40 thumbs-ups");
    expect(html).toContain("of 0 thumbs-downs");
    expect(html).toContain("preliminary");
  });

  it("reactionCounts sums both judge rows per operator reaction", () => {
    const r = computeCalibration(
      [
        { winner: "v2", sourceMessageId: "1", feedbackScore: 1 },
        { winner: "v1", sourceMessageId: "2", feedbackScore: 1 },
        { winner: "v2", sourceMessageId: "3", feedbackScore: -1 },
      ],
      30,
    );
    expect(reactionCounts(r.matrix)).toEqual({ thumbsUp: 2, thumbsDown: 1 });
    expect(reactionCounts([])).toEqual({ thumbsUp: 0, thumbsDown: 0 });
  });
});
