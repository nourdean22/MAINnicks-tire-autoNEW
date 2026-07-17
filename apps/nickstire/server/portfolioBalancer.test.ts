/**
 * Weekly portfolio balancer (milestone 12 §30) — Planner 2.0 stops optimizing
 * posts independently. The caps prevent a week of six tire posts / three DM
 * CTAs / all-fear content; the education floor guarantees practical value.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE, balanceWeek, type CandidateCampaign } from "./services/portfolioBalancer";

const c = (id: string, over: Partial<CandidateCampaign>): CandidateCampaign => ({
  id, service: "tires", role: "offer", cta: "dm_keyword", territory: "weather_local_alert",
  fearBased: false, baseScore: 50, ...over,
});

describe("balanceWeek", () => {
  it("caps posts per service — six tire candidates yield at most maxPerService tires", () => {
    const cands = Array.from({ length: 6 }, (_, i) => c(`t${i}`, { service: "tires", territory: `terr${i}`, cta: "none", baseScore: 90 - i }));
    const r = balanceWeek(cands, { ...DEFAULT_BALANCE, minEducation: 0 });
    expect(r.selected.filter((x) => x.service === "tires").length).toBeLessThanOrEqual(DEFAULT_BALANCE.maxPerService);
    expect(r.rejected.some((x) => /tires posts/.test(x.reason))).toBe(true);
  });

  it("caps repeated DM-keyword CTAs", () => {
    const cands = Array.from({ length: 5 }, (_, i) => c(`d${i}`, { service: `svc${i}`, territory: `terr${i}`, cta: "dm_keyword", baseScore: 90 - i }));
    const r = balanceWeek(cands, { ...DEFAULT_BALANCE, minEducation: 0 });
    expect(r.selected.filter((x) => x.cta === "dm_keyword").length).toBeLessThanOrEqual(DEFAULT_BALANCE.maxSameCta);
  });

  it("caps fear-based posts", () => {
    const cands = Array.from({ length: 5 }, (_, i) => c(`f${i}`, { service: `svc${i}`, territory: `terr${i}`, cta: "none", fearBased: true, baseScore: 90 - i }));
    const r = balanceWeek(cands, { ...DEFAULT_BALANCE, minEducation: 0 });
    expect(r.selected.filter((x) => x.fearBased).length).toBeLessThanOrEqual(DEFAULT_BALANCE.maxFearBased);
  });

  it("enforces the education floor by swapping in an education post", () => {
    const cands = [
      c("o1", { service: "s1", territory: "t1", cta: "none", role: "offer", baseScore: 95 }),
      c("o2", { service: "s2", territory: "t2", cta: "none", role: "offer", baseScore: 90 }),
      c("edu", { service: "s3", territory: "t3", cta: "none", role: "education", baseScore: 40 }),
    ];
    const r = balanceWeek(cands, { ...DEFAULT_BALANCE, targetCount: 2, minEducation: 1 });
    expect(r.selected.some((x) => x.role === "education")).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/education floor/);
  });

  it("takes best scores first when nothing is over-concentrated", () => {
    const cands = [
      c("a", { service: "s1", territory: "t1", cta: "call", baseScore: 30 }),
      c("b", { service: "s2", territory: "t2", cta: "book", baseScore: 80 }),
      c("edu", { service: "s3", territory: "t3", cta: "none", role: "education", baseScore: 60 }),
    ];
    const r = balanceWeek(cands, { ...DEFAULT_BALANCE, targetCount: 3 });
    expect(r.selected.map((x) => x.id).sort()).toEqual(["a", "b", "edu"]);
  });

  it("never selects more than targetCount", () => {
    const cands = Array.from({ length: 10 }, (_, i) => c(`x${i}`, { service: `s${i}`, territory: `t${i}`, cta: "none", baseScore: 100 - i }));
    const r = balanceWeek(cands, { ...DEFAULT_BALANCE, targetCount: 4, minEducation: 0 });
    expect(r.selected).toHaveLength(4);
  });
});
