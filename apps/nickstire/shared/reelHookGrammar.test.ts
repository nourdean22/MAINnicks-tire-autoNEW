/**
 * Hook fatigue (2026-10-08): the opening-line shape that took over the feed is
 * seen by the scorer and told to the generator. The thresholds are the claim:
 * at least 8 readings, and one shape opening at least half of them.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildHookFatigueFragment, classifyHookGrammar, saturatedHookGrammar } from "./reelHookGrammar";
import { calculateReelQualityScore } from "../client/src/lib/facelessReelStudio";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";

const rep = (g: string, n: number) => Array.from({ length: n }, () => g);

describe("saturatedHookGrammar", () => {
  it("one shape opening half or more of 8+ Reels is saturated", () => {
    expect(saturatedHookGrammar([...rep("symptom_question", 6), "command", "number_lead"]))
      .toEqual({ grammar: "symptom_question", count: 6, of: 8 });
    expect(saturatedHookGrammar([...rep("command", 4), ...rep("number_lead", 2), ...rep("direct_statement", 2)])?.grammar).toBe("command");
  });
  it("under half is variety, not fatigue", () => {
    expect(saturatedHookGrammar([...rep("command", 3), ...rep("number_lead", 3), ...rep("direct_statement", 2)])).toBeNull();
  });
  it("fewer than 8 known readings is too few to call a habit; unknown never counts", () => {
    expect(saturatedHookGrammar(rep("command", 7))).toBeNull();
    expect(saturatedHookGrammar([...rep("command", 7), ...rep("unknown", 5)])).toBeNull();
    expect(saturatedHookGrammar(rep("unknown", 20))).toBeNull();
    expect(saturatedHookGrammar(undefined)).toBeNull();
  });
});

describe("buildHookFatigueFragment", () => {
  it("is empty when nothing is saturated", () => {
    expect(buildHookFatigueFragment(null)).toBe("");
  });
  it("names the measured share and offers every OTHER shape", () => {
    const f = buildHookFatigueFragment({ grammar: "symptom_question", count: 6, of: 8 });
    expect(f).toContain("6 of the last 8 Reels opened with a symptom question");
    const offered = f.slice(f.indexOf("Open this one differently"));
    expect(offered).not.toContain("symptom question");
    expect(offered).toContain("customer quote");
  });
});

describe("the scorer sees it", () => {
  const sample = () => structuredClone(SAMPLE_REEL_BRIEFS[0]);
  const fresh = {
    topics: ["something else entirely"], keywords: ["UNRELATED"], archetypes: ["silent_film_title_cards"],
    motionLenses: ["neon_retro_futurist"], objectCharacters: ["a completely different object"], available: true,
  };
  const part = (b: ReturnType<typeof sample>, hookGrammars?: string[]) =>
    calculateReelQualityScore(b, 0, { recent: { ...fresh, hookGrammars } }).parts.find((p) => p.label === "Distinct from recent reels");

  it("opening like most recent Reels costs one point and says why", () => {
    const b = sample();
    const mine = classifyHookGrammar(b.storyboardBeats[0].onScreenText);
    expect(mine).not.toBe("unknown");
    const p = part(b, [...rep(mine, 6), ...rep(mine === "command" ? "number_lead" : "command", 2)]);
    expect(p?.points).toBe(4);
    expect(p?.ok).toBe(false);
    expect(p?.detail).toContain("opens like 6/8 recent reels");
  });

  it("a different opener, or no hook history, costs nothing", () => {
    const b = sample();
    const mine = classifyHookGrammar(b.storyboardBeats[0].onScreenText);
    const other = mine === "command" ? "number_lead" : "command";
    expect(part(b, rep(other, 8))?.points).toBe(5);
    expect(part(b, undefined)?.points).toBe(5);
  });
});

describe("the generator is told", () => {
  it("draft prep derives it from the recent window, and reelBriefGen appends it to the system prompt", () => {
    const prep = fs.readFileSync(path.join(__dirname, "../server/services/reelDraftPrep.ts"), "utf8");
    expect(prep).toMatch(/saturatedHookGrammar\(recent\.hookGrammars\)/);
    expect(prep).toMatch(/\.\.\.\(hookFatigue \? \{ hookFatigue \} : \{\}\)/);
    const gen = fs.readFileSync(path.join(__dirname, "../server/services/reelBriefGen.ts"), "utf8");
    expect(gen).toMatch(/buildHookFatigueFragment\(input\.hookFatigue \?\? null\)/);
    expect(gen).toMatch(/if \(fatigue\) systemPrompt \+= /);
  });
});
