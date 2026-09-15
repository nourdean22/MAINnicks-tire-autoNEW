import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_ROUTES } from "./routes";
import { authorityFor, contractHash, gradeSatisfies, parseGoalContract, type GoalContract } from "./goalContract";
import { WEB_EXPERIMENTS, webExperimentFlagKey } from "./webExperiments";
import { FLAG_DEFINITIONS } from "../server/services/featureFlags";
import { findConfoundsIn } from "./experimentKernel";

const GOALS_DIR = join(__dirname, "..", "goals");
const files = readdirSync(GOALS_DIR).filter((f) => f.endsWith(".json"));
const contracts: GoalContract[] = files.map((f) => parseGoalContract(JSON.parse(readFileSync(join(GOALS_DIR, f), "utf8"))));
const registered = new Set(ALL_ROUTES.map((r) => r.path));

describe("goal contracts", () => {
  it("at least one contract exists and every one parses", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(contracts.length).toBe(files.length);
  });
  it("every surface is a registered route", () => {
    for (const c of contracts) for (const s of c.surfaces) expect(registered.has(s), `${c.goalId}: ${s}`).toBe(true);
  });
  it("hash is stable across key order and changes when any field changes", () => {
    const c = contracts[0];
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
  it("every experiment's surfaces belong to a goal contract, and its arms differ only on the primary variable", () => {
    for (const e of WEB_EXPERIMENTS) {
      // The owning contract is the one that covers every surface AND is judged on
      // the same primary metric — an experiment measured on a metric no contract
      // declared is an experiment nobody pre-registered.
      const owning = contracts.find((c) => e.surfaces.every((s) => c.surfaces.includes(s)) && c.primaryMetric === e.primaryMetric);
      expect(owning, `${e.experimentId} has no goal contract covering ${e.surfaces.join(",")} on ${e.primaryMetric}`).toBeDefined();
      for (const g of e.guardrails) expect(owning!.guardrails, `${e.experimentId} guardrail ${g.metric} not in contract`).toContain(g.metric);
      const controlled = Object.keys(Object.assign({}, ...e.arms)).filter((k) => k !== "armId" && k !== "variantValue");
      expect(findConfoundsIn(e.arms, controlled, e.primaryVariable)).toEqual([]);
      expect(e.arms.map((a) => a.armId)).toContain("control");
    }
  });
  it("every experiment has a flag definition (off by default)", () => {
    const keys = new Set(FLAG_DEFINITIONS.map((f) => f.key as string));
    for (const e of WEB_EXPERIMENTS) expect(keys.has(webExperimentFlagKey(e.experimentId)), webExperimentFlagKey(e.experimentId)).toBe(true);
  });
});
