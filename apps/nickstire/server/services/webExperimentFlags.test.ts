import { describe, expect, it } from "vitest";
import { WEB_EXPERIMENTS, webExperimentFlagKey as conventionFlagKey } from "../../shared/webExperiments";
import { FLAG_DEFINITIONS } from "./featureFlags";
import { WEB_EXPERIMENT_FLAGS } from "./webExperimentFlags";

describe("web experiment flags", () => {
  it("every registered experiment has a literal flag, equal to the convention, defined in FLAG_DEFINITIONS", () => {
    const defined = new Set(FLAG_DEFINITIONS.map((f) => f.key as string));
    for (const e of WEB_EXPERIMENTS) {
      const literal = WEB_EXPERIMENT_FLAGS[e.experimentId as keyof typeof WEB_EXPERIMENT_FLAGS];
      expect(literal, `${e.experimentId} has no literal flag in WEB_EXPERIMENT_FLAGS`).toBeDefined();
      expect(literal).toBe(conventionFlagKey(e.experimentId));
      expect(defined.has(literal)).toBe(true);
    }
  });
  it("no literal flag points at an experiment that no longer exists", () => {
    const ids = new Set(WEB_EXPERIMENTS.map((e) => e.experimentId));
    for (const id of Object.keys(WEB_EXPERIMENT_FLAGS)) expect(ids.has(id), `${id} is not a registered experiment`).toBe(true);
  });
});
