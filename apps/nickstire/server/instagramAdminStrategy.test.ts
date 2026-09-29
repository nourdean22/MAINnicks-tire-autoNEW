import { describe, expect, it } from "vitest";
import {
  chooseProfileCandidates,
  judgeOutcomeAlignment,
  recommendedSlateOrder,
  structureHypothesesFromComparisons,
} from "./services/instagramAdminStrategy";

describe("Instagram admin strategy", () => {
  it("orders an active slate by transparent editorial evidence, not an invented viral score", () => {
    const rows = [
      { slug: "repeat", packDate: "2026-09-27", productionTwin: false, noveltySimilarity: 0.05, publishedCount: 1, outcome: { reach: 1000, saved: 100, shares: 20, skipRate: 0.2 } },
      { slug: "fresh-twin", packDate: "2026-09-26", productionTwin: true, noveltySimilarity: 0.1, publishedCount: 0, outcome: null },
      { slug: "fresh-novel", packDate: "2026-09-25", productionTwin: false, noveltySimilarity: 0.4, publishedCount: 0, outcome: null },
      { slug: "fresh-more-novel", packDate: "2026-09-24", productionTwin: false, noveltySimilarity: 0.2, publishedCount: 0, outcome: null },
    ];
    expect(recommendedSlateOrder(rows).map((r) => r.slug)).toEqual([
      "fresh-more-novel",
      "fresh-novel",
      "fresh-twin",
      "repeat",
    ]);
  });

  it("uses current demand/timeliness before novelty when the stronger editorial constraints tie", () => {
    const rows = [
      { slug: "novel-low-demand", packDate: "2026-09-27", productionTwin: false, noveltySimilarity: 0.1, publishedCount: 0, demandScore: 15, outcome: null },
      { slug: "less-novel-high-demand", packDate: "2026-09-26", productionTwin: false, noveltySimilarity: 0.5, publishedCount: 0, demandScore: 34, outcome: null },
    ];
    expect(recommendedSlateOrder(rows).map((r) => r.slug)).toEqual([
      "less-novel-high-demand",
      "novel-low-demand",
    ]);
  });

  it("uses exact-pack saves/reach only as a later tie-break after freshness/twin/demand/novelty", () => {
    const rows = [
      { slug: "weak", packDate: "2026-09-25", productionTwin: false, noveltySimilarity: 0.2, publishedCount: 1, outcome: { reach: 100, saved: 1, shares: 0, skipRate: null } },
      { slug: "strong", packDate: "2026-09-24", productionTwin: false, noveltySimilarity: 0.2, publishedCount: 1, outcome: { reach: 100, saved: 8, shares: 0, skipRate: null } },
    ];
    expect(recommendedSlateOrder(rows).map((r) => r.slug)).toEqual(["strong", "weak"]);
  });
  it("turns sufficient correlations into explicitly non-causal testable priors", () => {
    const hypotheses = structureHypothesesFromComparisons([
      { family: "hook", signal: "opensWithQuestion", metric: "skipRate", withN: 6, withoutN: 7, withAvg: 0.3, withoutAvg: 0.6, delta: -0.3, sufficient: true },
      { family: "beatStructure", signal: "hasFiveBeats", metric: "savesPerReach", withN: 5, withoutN: 5, withAvg: 0.04, withoutAvg: 0.01, delta: 0.03, sufficient: true },
      { family: "hook", signal: "opensWithMotion", metric: "sharesPerReach", withN: 2, withoutN: 8, withAvg: 0.02, withoutAvg: 0.01, delta: 0.01, sufficient: false },
    ] as any);

    expect(hypotheses).toHaveLength(2);
    expect(hypotheses[0].statement).toContain("testable prior, not a causal rule");
    expect(hypotheses.map((h) => h.direction)).toEqual(["beneficial_in_sample", "beneficial_in_sample"]);
  });

  it("refuses hard-gate promotion when judge-blocked Reels outperform clear Reels downstream", () => {
    const result = judgeOutcomeAlignment(
      { n: 9, avgSkipRateRaw: 57.45, avgSavesPerReach: 0.000665, avgSharesPerReach: 0.00305 },
      { n: 16, avgSkipRateRaw: 60.67, avgSavesPerReach: 0.00025, avgSharesPerReach: 0.00249 },
    );
    expect(result.status).toBe("not_supported_by_current_outcomes");
    expect(result.contrary).toBe(3);
    expect(result.consistent).toBe(0);
    expect(result.hardGateSupported).toBe(false);
    expect(result.note).toContain("Keep the judge in shadow mode");
  });

  it("still refuses an automatic gate flip when observational directions align", () => {
    const result = judgeOutcomeAlignment(
      { n: 8, avgSkipRateRaw: 70, avgSavesPerReach: 0.001, avgSharesPerReach: 0.001 },
      { n: 12, avgSkipRateRaw: 50, avgSavesPerReach: 0.004, avgSharesPerReach: 0.003 },
    );
    expect(result.status).toBe("directionally_aligned_needs_controlled_validation");
    expect(result.hardGateSupported).toBe(false);
  });

  it("does not fabricate profile winners from unreported save/share metrics", () => {
    const picks = chooseProfileCandidates([
      { postId: "reach", caption: "reach", reach: 1000, saved: null, shares: null, skipRate: 0.5 },
      { postId: "save", caption: "save", reach: 500, saved: 10, shares: null, skipRate: 0.2 },
      { postId: "share", caption: "share", reach: 400, saved: 1, shares: 20, skipRate: 0.4 },
      { postId: "retention", caption: "retention", reach: 300, saved: 1, shares: 1, skipRate: 0.1 },
    ]);

    expect(picks.map((p) => [p.role, p.row.postId])).toEqual([
      ["discovery", "reach"],
      ["save_value", "save"],
      ["share_value", "share"],
      ["retention", "retention"],
    ]);
    expect(picks.find((p) => p.role === "save_value")?.evidence).not.toContain("0.0000");
  });
});
