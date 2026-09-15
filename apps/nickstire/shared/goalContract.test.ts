import { describe, expect, it } from "vitest";
import { ALL_ROUTES } from "./routes";
import { authorityFor, contractHash, gradeSatisfies, type GoalContract } from "./goalContract";
import { WEB_EXPERIMENTS } from "./webExperiments";
import { FLAG_DEFINITIONS } from "../server/services/featureFlags";
import { WEB_EXPERIMENT_FLAGS } from "../server/services/webExperimentFlags";
import { findConfoundsIn } from "./experimentKernel";
import { GOAL_CONTRACTS, goalContractFor } from "../goals";

const registered = new Set(ALL_ROUTES.map((r) => r.path));

describe("goal contracts", () => {
  it("at least one contract exists and every one parsed (the registry parses on import)", () => {
    expect(GOAL_CONTRACTS.length).toBeGreaterThan(0);
    expect(new Set(GOAL_CONTRACTS.map((c) => c.goalId)).size).toBe(GOAL_CONTRACTS.length);
  });
  it("every surface is a registered route", () => {
    for (const c of GOAL_CONTRACTS) for (const s of c.surfaces) expect(registered.has(s), `${c.goalId}: ${s}`).toBe(true);
  });
  it("hash is stable across key order and changes when any field changes", () => {
    const c = GOAL_CONTRACTS[0];
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(c).reverse()))) as GoalContract;
    expect(contractHash(reordered)).toBe(contractHash(c));
    expect(contractHash({ ...c, primaryMetric: `${c.primaryMetric}_x` })).not.toBe(contractHash(c));
  });
  it("evidence thermostat never grants merge authority", () => {
    for (const g of ["H0", "H1", "H2", "H3", "H4", "H5"] as const) expect(authorityFor(g)).not.toMatch(/merge|deploy/);
    expect(gradeSatisfies("H3", "randomized")).toBe(false);
    expect(gradeSatisfies("H4", "randomized")).toBe(true);
  });
});

describe("web experiments are contract-bound and flag-gated", () => {
  it("every experiment has an owning contract (surfaces + primary metric), its guardrails are the contract's, and its arms differ only on the primary variable", () => {
    for (const e of WEB_EXPERIMENTS) {
      const owning = goalContractFor(e);
      expect(owning, `${e.experimentId} has no goal contract covering ${e.surfaces.join(",")} on ${e.primaryMetric}`).not.toBeNull();
      expect(owning!.hash).toMatch(/^[0-9a-f]{16}$/);
      for (const g of e.guardrails) expect(owning!.contract.guardrails, `${e.experimentId} guardrail ${g.metric} not in contract`).toContain(g.metric);
      const controlled = Object.keys(Object.assign({}, ...e.arms)).filter((k) => k !== "armId" && k !== "variantValue");
      expect(findConfoundsIn(e.arms, controlled, e.primaryVariable)).toEqual([]);
      expect(e.arms.map((a) => a.armId)).toContain("control");
    }
  });
  it("an experiment on an uncovered surface or metric has no contract (positive control)", () => {
    expect(goalContractFor({ surfaces: ["/tires"], primaryMetric: "nonexistent_metric" })).toBeNull();
    expect(goalContractFor({ surfaces: ["/nowhere"], primaryMetric: "page_cta_primary_clicked" })).toBeNull();
  });
  it("every experiment has a literal flag that is a defined flag (off by default)", () => {
    const keys = new Set(FLAG_DEFINITIONS.map((f) => f.key as string));
    for (const e of WEB_EXPERIMENTS) {
      const flag = WEB_EXPERIMENT_FLAGS[e.experimentId as keyof typeof WEB_EXPERIMENT_FLAGS];
      expect(flag, `${e.experimentId} has no literal flag`).toBeDefined();
      expect(keys.has(flag), flag).toBe(true);
    }
  });
});
