/**
 * Shadow planner (milestone 11) — deterministic recommendations that are
 * STRUCTURALLY incapable of acting. The shadow guarantee is enforced at the
 * source level, not by promise.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SEASONAL_PLAYBOOK, scoreOpportunity, type PlannerSignals } from "./services/shadowPlanner";

const signals = (over: Partial<PlannerSignals> = {}): PlannerSignals => ({
  month: 7,
  fingerprints: { available: true, values: [] },
  recentTopics: { available: true, values: [] },
  weather: { available: true, triggered: [] },
  evidenceTables: { available: true, populated: false },
  ...over,
});

describe("structural shadow guarantee", () => {
  it("the planner module imports NOTHING that can generate, reserve, enqueue, or publish", () => {
    const src = readFileSync(resolve(process.cwd(), "server/services/shadowPlanner.ts"), "utf8");
    for (const forbidden of ["higgsfieldStudio", "metaSocial", "socialPublish", "reelPipeline", "generationLedger", "contentGovernor", "invokeLLM", "_core/llm", "selectiveRepair", "reelBriefGen", "carouselBriefGen", "checkWeatherTriggers"]) {
      expect(src.includes(forbidden), `shadowPlanner must not reference ${forbidden}`).toBe(false);
    }
  });

  it("every plan self-declares shadow: true", async () => {
    const src = readFileSync(resolve(process.cwd(), "server/services/shadowPlanner.ts"), "utf8");
    expect(src).toContain("shadow: true");
  });
});

describe("playbook coverage", () => {
  it("every month has at least three candidate moments", () => {
    for (let m = 1; m <= 12; m++) {
      const count = SEASONAL_PLAYBOOK.filter((p) => p.months.includes(m)).length;
      expect(count, `month ${m}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("every moment uses a registry campaign keyword shape and unique id", () => {
    const ids = new Set<string>();
    for (const p of SEASONAL_PLAYBOOK) {
      expect(p.campaignKeyword).toMatch(/^[A-Z]+$/);
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
    }
  });
});

describe("deterministic scoring", () => {
  it("same signals always produce the same score and codes", () => {
    const m = SEASONAL_PLAYBOOK.find((p) => p.id === "summer_pressure")!;
    const a = scoreOpportunity(m, signals());
    const b = scoreOpportunity(m, signals());
    expect(a).toEqual(b);
    expect(a.reasoningCodes).toContain("SEASON_MATCH");
    expect(a.reasoningCodes).toContain("EVIDENCE_STARVED_PUBLIC_ONLY");
  });

  it("a live weather trigger maxes timing and says so", () => {
    const m = SEASONAL_PLAYBOOK.find((p) => p.id === "first_freeze_battery")!;
    const cold = scoreOpportunity(m, signals({ month: 11, weather: { available: true, triggered: ["first_freeze"] } }));
    const calm = scoreOpportunity(m, signals({ month: 11 }));
    expect(cold.score).toBeGreaterThan(calm.score);
    expect(cold.reasoningCodes).toContain("WEATHER_TRIGGER_LIVE");
  });

  it("recently used territory loses creative-potential points with a code", () => {
    const m = SEASONAL_PLAYBOOK.find((p) => p.id === "pothole_thaw")!;
    const fresh = scoreOpportunity(m, signals({ month: 2 }));
    const seen = scoreOpportunity(m, signals({ month: 2, fingerprints: { available: true, values: ["territory:road_villain | moment:x | metaphor:y | action:z"] } }));
    expect(seen.score).toBe(fresh.score - 6);
    expect(seen.reasoningCodes).toContain("TERRITORY_RECENTLY_USED");
  });

  it("repetition against published topics is a HARD REJECT, not a discount", () => {
    const m = SEASONAL_PLAYBOOK.find((p) => p.id === "winter_tread")!;
    const rejected = scoreOpportunity(m, signals({ month: 11, recentTopics: { available: true, values: ["Bald tires meeting the season's first lake-effect snow"] } }));
    expect(rejected.rejected).toBe(true);
    expect(rejected.score).toBe(0);
    expect(rejected.reasoningCodes).toContain("HARD_REJECT_REPETITION");
  });

  it("populated evidence tables raise the evidence part with the honest code flip", () => {
    const m = SEASONAL_PLAYBOOK.find((p) => p.id === "brake_noise")!;
    const starved = scoreOpportunity(m, signals());
    const fed = scoreOpportunity(m, signals({ evidenceTables: { available: true, populated: true } }));
    expect(fed.score).toBe(starved.score + 8);
    expect(fed.reasoningCodes).toContain("FIRST_PARTY_EVIDENCE_AVAILABLE");
  });
});
