/**
 * Topic miner + experiment registry.
 *
 * The assertions that matter here are the REFUSALS. A miner that emits recall
 * topics it cannot source, or an evaluator that names a winner from four posts
 * and a pile of zeros, is worse than neither existing — both produce confident
 * output that reads as a finding.
 */
import { describe, it, expect } from "vitest";
import {
  mineTopicCandidates,
  autoRenderable,
  uncoveredFranchises,
  isNearDuplicate,
  rotationPenalty,
  franchiseForSource,
} from "../../../shared/contentTopicMiner";
import {
  evaluateExperiment,
  assignArm,
  findConfounds,
  armRates,
  DECISION_LOOKS,
  MIN_SAMPLES_PER_ARM,
  type ExperimentDefinition,
  type ArmObservation,
} from "../../../shared/contentExperiments";

describe("topic miner — honest about what it cannot source", () => {
  it("surfaces government-evidence topics but marks them NOT auto-renderable", () => {
    // Recall Radar / E-Check need government_source, and NHTSA + Ohio E-Check
    // block automated fetching (proven by the repo's URL truth audit).
    const c = mineTopicCandidates({ customerQuestions: ["is my car under a recall"] });
    const gov = c.filter((x) => x.requiredEvidence.includes("government_source"));
    for (const g of gov) {
      expect(g.blockedReason, `${g.franchiseId} must declare why it cannot auto-render`).toBeTruthy();
      expect(g.blockedReason).toMatch(/NHTSA|government/i);
    }
  });

  it("autoRenderable excludes everything that needs hand-attached evidence", () => {
    const c = mineTopicCandidates({
      topThemes: ["brake noise"],
      seasonalConditions: ["first hard freeze"],
    });
    for (const r of autoRenderable(c)) expect(r.blockedReason).toBeUndefined();
  });

  it("suppresses a topic already covered recently, even reworded", () => {
    const c = mineTopicCandidates({
      topThemes: ["what grinding brakes actually mean"],
      recentTopics: ["grinding brakes — what that sound actually means"],
    });
    expect(c).toHaveLength(0);
  });

  it("near-duplicate detection tolerates rewording but not unrelated topics", () => {
    expect(isNearDuplicate("cold weather drops tire pressure", ["tire pressure drops in cold weather"])).toBe(true);
    expect(isNearDuplicate("wheel bearing noise diagnosis", ["cabin air filter replacement"])).toBe(false);
  });

  it("ranks performance and verified-review signals above coverage guesses", () => {
    const c = mineTopicCandidates({
      topThemes: ["brake noise"],
      underCoveredServices: ["exhaust work"],
    });
    const perf = c.find((x) => x.source === "performance_signal");
    const gap = c.find((x) => x.source === "coverage_gap");
    expect(perf!.score).toBeGreaterThan(gap!.score);
  });

  it("rotates franchises — a recently used show is penalised, and the penalty decays", () => {
    expect(rotationPenalty("tire_autopsy", ["tire_autopsy"])).toBeGreaterThan(
      rotationPenalty("tire_autopsy", ["pothole_court", "rust_files", "tire_autopsy"]),
    );
    expect(rotationPenalty("tire_autopsy", [])).toBe(0);
  });

  it("routes verified review themes to Review Reconstructed", () => {
    expect(franchiseForSource("verified_review_theme", [])).toBe("review_reconstructed");
  });

  it("reports which franchises got no candidate — the coverage gap", () => {
    const c = mineTopicCandidates({ topThemes: ["brake noise"] });
    expect(uncoveredFranchises(c).length).toBeGreaterThan(0);
  });

  it("every candidate carries its reasons — a ranked list with no rationale is unauditable", () => {
    for (const c of mineTopicCandidates({ topThemes: ["a"], customerQuestions: ["b"] })) {
      expect(c.reasons.length).toBeGreaterThan(0);
    }
  });
});

const arms = [
  { armId: "a", variantValue: "send", ctaType: "send" as const, provider: "veo", franchiseId: "tire_autopsy" as const },
  { armId: "b", variantValue: "none", ctaType: "none" as const, provider: "veo", franchiseId: "tire_autopsy" as const },
];
const def: ExperimentDefinition = {
  experimentId: "exp1",
  primaryVariable: "cta_type",
  objective: "discovery",
  primaryMetric: "shares_per_reach",
  arms,
  startedAt: "2026-07-31T00:00:00Z",
};
const obs = (armId: string, n: number, metricValue: number | null, reach = 1000): ArmObservation[] =>
  Array.from({ length: n }, (_, i) => ({
    armId, mediaId: `${armId}-${i}`, horizonHours: 72 as const, reach, metricValue,
  }));

describe("experiment registry — refuses to manufacture a verdict", () => {
  it("rejects a design whose arms differ on more than the primary variable", () => {
    const confounded: ExperimentDefinition = {
      ...def,
      arms: [{ ...arms[0] }, { ...arms[1], provider: "higgsfield" }],
    };
    expect(findConfounds(confounded)).toContain("provider");
    const v = evaluateExperiment(confounded, [...obs("a", 10, 5), ...obs("b", 10, 2)]);
    expect(v.status).toBe("invalid_design");
  });

  it("does not confound on the field the experiment is legitimately varying", () => {
    expect(findConfounds(def)).not.toContain("ctaType");
  });

  it(`returns insufficient_data below ${MIN_SAMPLES_PER_ARM} per arm — n=1 is not a finding`, () => {
    const v = evaluateExperiment(def, [...obs("a", 1, 9), ...obs("b", 1, 1)]);
    expect(v.status).toBe("insufficient_data");
    if (v.status === "insufficient_data") expect(v.have).toBe(1);
  });

  it("returns no_signal when every arm measures zero — the account's actual cold start", () => {
    // saved = 0.00 across every reel ever posted. Ranking zeros yields a
    // confident arbitrary winner, which is the failure this guards.
    const v = evaluateExperiment(def, [...obs("a", 8, 0), ...obs("b", 8, 0)]);
    expect(v.status).toBe("no_signal");
  });

  it("treats an unreported metric as absent, NOT as zero", () => {
    const rates = armRates(def, [...obs("a", 6, null), ...obs("b", 6, 3)]);
    expect(rates.get("a")!.reported).toBe(0);
    expect(rates.get("a")!.rate).toBeNull();
    // and with no reported values it cannot reach a verdict
    expect(evaluateExperiment(def, [...obs("a", 6, null), ...obs("b", 6, 3)]).status).toBe("insufficient_data");
  });

  // Verdicts are issued only at the planned looks (DECISION_LOOKS per arm,
  // 2026-10-08): a tie from the 48-per-arm look, a winner from the first.
  it("calls a tie when the margin is inside noise, from the 48-per-arm look", () => {
    const v = evaluateExperiment(def, [...obs("a", 48, 100), ...obs("b", 48, 96)]);
    expect(v.status).toBe("tie");
  });

  it("between looks a real margin is 'not yet', naming the next look", () => {
    const v = evaluateExperiment(def, [...obs("a", 8, 90), ...obs("b", 8, 30)]);
    expect(v.status).toBe("insufficient_data");
    if (v.status === "insufficient_data") expect(v.needed).toBe(DECISION_LOOKS[0]);
  });

  it("names a winner on a real margin at the first decision look", () => {
    const v = evaluateExperiment(def, [...obs("a", DECISION_LOOKS[0], 90), ...obs("b", DECISION_LOOKS[0], 30)]);
    expect(v.status).toBe("winner");
    if (v.status === "winner") {
      expect(v.armId).toBe("a");
      expect(v.variantValue).toBe("send");
      expect(v.lift).toBeGreaterThan(0.1);
    }
  });

  it("normalises by reach — more reach alone is not a better arm", () => {
    // b has triple the raw metric but triple the reach; the rates are equal.
    const v = evaluateExperiment(def, [...obs("a", 48, 10, 1000), ...obs("b", 48, 30, 3000)]);
    expect(v.status).toBe("tie");
  });

  it("assigns arms deterministically so a retry cannot silently reassign", () => {
    expect(assignArm(def, "episode-42").armId).toBe(assignArm(def, "episode-42").armId);
  });

  it("rejects a single-arm experiment", () => {
    expect(evaluateExperiment({ ...def, arms: [arms[0]] }, obs("a", 9, 5)).status).toBe("invalid_design");
  });
});
