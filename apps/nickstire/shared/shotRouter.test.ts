import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { declaredBeatSource, routeShot, shotRouteProblems, type ShotFacts } from "./shotRouter";

const facts = (over: Partial<ShotFacts> = {}): ShotFacts => ({
  claimsRealWork: false, explainsMechanism: false, atmosphereOrMetaphor: false, hasApprovedStill: false,
  defectWouldHarmTrust: false, reusableShotExists: false, essential: true, ...over,
});

describe("routeShot — the seven questions, cheapest accepted method first", () => {
  it("anything that claims real work is real footage, whatever else is true of it", () => {
    const d = routeShot(facts({ claimsRealWork: true, atmosphereOrMetaphor: true, hasApprovedStill: true }));
    expect(d).toMatchObject({ route: "real", step: 1 });
  });
  it("a mechanism explanation is deterministic even when a still exists", () => {
    expect(routeShot(facts({ explainsMechanism: true, hasApprovedStill: true }))).toMatchObject({ route: "deterministic", step: 2 });
  });
  it("an approved still gets deterministic motion before any generation, even for atmosphere", () => {
    expect(routeShot(facts({ atmosphereOrMetaphor: true, hasApprovedStill: true }))).toMatchObject({ route: "still_motion", step: 4 });
  });
  it("a shot whose defect would harm trust is not generated — even as atmosphere", () => {
    expect(routeShot(facts({ atmosphereOrMetaphor: true, defectWouldHarmTrust: true }))).toMatchObject({ route: "do_not_generate", step: 5 });
  });
  it("an honest reusable shot beats a new AI shot", () => {
    expect(routeShot(facts({ atmosphereOrMetaphor: true, reusableShotExists: true }))).toMatchObject({ route: "reuse", step: 6 });
  });
  it("pure atmosphere with no cheaper route is AI, labelled illustrative", () => {
    expect(routeShot(facts({ atmosphereOrMetaphor: true }))).toMatchObject({ route: "ai_illustrative", step: 3 });
  });
  it("a non-essential shot with no route is deleted before any spend; an essential one is captured, not generated", () => {
    expect(routeShot(facts({ essential: false }))).toMatchObject({ route: "delete", step: 7 });
    expect(routeShot(facts({ essential: true }))).toMatchObject({ route: "do_not_generate", step: 7 });
  });
});

describe("declaredBeatSource — explicit tags only, never a guess", () => {
  it("reads the field first, then the leading tag, else unspecified", () => {
    expect(declaredBeatSource({ visual: "REAL macro of a tire", source: "deterministic" })).toBe("deterministic");
    expect(declaredBeatSource({ visual: "REAL macro of a tire" })).toBe("real");
    expect(declaredBeatSource({ visual: "REAL + DETERMINISTIC: nail head with a zone outline" })).toBe("real");
    expect(declaredBeatSource({ visual: "DETERMINISTIC card: three columns" })).toBe("deterministic");
    expect(declaredBeatSource({ visual: "STILL-MOTION push on the approved exterior" })).toBe("still_motion");
    expect(declaredBeatSource({ visual: "AI illustrative: abstract vibration plate" })).toBe("ai_illustrative");
    expect(declaredBeatSource({ visual: "a tire on a lift, real-looking" })).toBe("unspecified");
    expect(declaredBeatSource({ visual: null })).toBe("unspecified");
  });
});

describe("shotRouteProblems — contradictions only, silent on undeclared beats", () => {
  it("an AI beat that describes a measurement or repair is flagged", () => {
    const p = shotRouteProblems([{ beatNumber: 2, visual: "AI: a technician reads the gauge on the rotor", purpose: "measurement" }]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^beat 2: declared ai_illustrative but describes real work/);
  });
  it("a real beat that asks for a generated shot is flagged", () => {
    expect(shotRouteProblems([{ beatNumber: 3, visual: "REAL: generated close-up of the lug nuts", purpose: "evidence" }])).toHaveLength(1);
  });
  it("undeclared beats and consistent beats produce nothing", () => {
    expect(shotRouteProblems([
      { beatNumber: 1, visual: "a tire on the lift", purpose: "hook" },
      { beatNumber: 2, visual: "AI illustrative: fog rolling over an empty lot at dawn", purpose: "atmosphere" },
      { beatNumber: 3, visual: "REAL macro of the tread", purpose: "evidence" },
    ])).toEqual([]);
  });
  it("the three proof packs declare a source on every beat and raise no contradiction", () => {
    for (const slug of ["2026-10-08-proof-01-uneven-wear", "2026-10-08-proof-02-highway-shake", "2026-10-08-proof-03-patch-or-replace"]) {
      const brief = JSON.parse(readFileSync(new URL(`../docs/reel-packs/${slug}/brief.json`, import.meta.url), "utf8"));
      const beats = brief.storyboardBeats as Array<{ beatNumber: number; visual: string; purpose: string }>;
      expect(beats.every((b) => declaredBeatSource(b) !== "unspecified")).toBe(true);
      expect(beats.some((b) => declaredBeatSource(b) === "ai_illustrative")).toBe(false);
      expect(shotRouteProblems(beats)).toEqual([]);
    }
  });
});
