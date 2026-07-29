import { describe, it, expect } from "vitest";
import {
  precisionAtK,
  runRecallEval,
  SEED_CASES,
  type RecallEvalCase,
} from "@/lib/brain/recall-eval";

describe("precisionAtK — the metric math", () => {
  it("full hit inside top-k = 1", () => {
    expect(precisionAtK(["a", "b", "c"], ["a", "b"], 5)).toBe(1);
  });
  it("half the relevant found = 0.5", () => {
    expect(precisionAtK(["a", "x", "y"], ["a", "b"], 5)).toBe(0.5);
  });
  it("relevant beyond k does not count", () => {
    expect(precisionAtK(["x", "y", "z", "a"], ["a"], 3)).toBe(0);
  });
  it("no relevant keys declared = vacuous 1 (case scores on forbidden only)", () => {
    expect(precisionAtK(["x"], [], 5)).toBe(1);
  });
});

describe("runRecallEval — harness aggregation", () => {
  const cases: RecallEvalCase[] = [
    { id: "c1", query: "q1", relevantKeys: ["good"], forbiddenKeys: [], kind: "exact_fact", provenance: "t" },
    { id: "c2", query: "q2", relevantKeys: ["a", "b"], forbiddenKeys: ["stale"], kind: "temporal", provenance: "t" },
  ];

  it("aggregates precision, full-recall and injection rates", async () => {
    const retriever = async (query: string) =>
      query === "q1" ? [{ key: "good" }] : [{ key: "a" }, { key: "stale" }];
    const report = await runRecallEval(cases, retriever, 5);
    expect(report.casesRun).toBe(2);
    expect(report.cases[0].precisionAtK).toBe(1);
    expect(report.cases[1].precisionAtK).toBe(0.5);
    expect(report.meanPrecisionAtK).toBe(0.75);
    expect(report.fullRecallRate).toBe(0.5); // only c1 found everything
    expect(report.contradictionInjectionRate).toBe(0.5); // c2 surfaced 'stale'
  });

  it("a forbidden key surfacing is counted even when precision is perfect", async () => {
    const retriever = async () => [{ key: "a" }, { key: "b" }, { key: "stale" }];
    const report = await runRecallEval([cases[1]], retriever, 5);
    expect(report.cases[0].precisionAtK).toBe(1);
    expect(report.contradictionInjectionRate).toBe(1);
  });

  it("seed corpus is honest about being synthetic", () => {
    for (const c of SEED_CASES) expect(c.provenance).toBe("synthetic-seed");
  });
});

// Wave-4 (2026-07-29): abstention metrics — false-premise queries pass
// only when no forbidden distractor surfaces.
describe("abstention scoring", () => {
  const abstainCase: RecallEvalCase = {
    id: "abst-1",
    query: "when is the flight to Tokyo",
    relevantKeys: [],
    forbiddenKeys: ["tokyo_trip_itinerary"],
    kind: "abstention",
    provenance: "synthetic-seed",
    acceptableAbstention: true,
  };

  it("clean abstention: no distractor surfaced → abstentionCleanRate 1", async () => {
    const report = await runRecallEval([abstainCase], async () => [{ key: "unrelated" }], 5);
    expect(report.abstentionCases).toBe(1);
    expect(report.abstentionCleanRate).toBe(1);
  });

  it("distractor surfaced → abstention dirty AND contradiction rate counts it", async () => {
    const report = await runRecallEval(
      [abstainCase],
      async () => [{ key: "tokyo_trip_itinerary" }],
      5,
    );
    expect(report.abstentionCleanRate).toBe(0);
    expect(report.contradictionInjectionRate).toBe(1);
  });

  it("corpus now seeds abstention and knowledge_update kinds", () => {
    expect(SEED_CASES.some((c) => c.kind === "abstention")).toBe(true);
    expect(SEED_CASES.some((c) => c.kind === "knowledge_update")).toBe(true);
  });
});
