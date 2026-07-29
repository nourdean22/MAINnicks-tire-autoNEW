/**
 * tests/brain/skill-from-source.test.ts — capturing a protocol from an
 * external source (2026-07-29).
 *
 * Reported: a photographed book cover + "turn this into a skill" did
 * nothing, because every skill tool was a READ.
 *
 * The honesty contract these pin: a captured protocol is a CANDIDATE.
 * The existing skill lane is behavioral (times_fired / success_rate
 * earned by doing), so a book-derived entry must never arrive wearing
 * invented history.
 */

import { describe, it, expect } from "vitest";
import { buildSkillFromSource, sourceProvenance } from "@/lib/brain/skill-from-source";

const base = {
  sourceLabel: "What to Say When You Talk to Your Self — Shad Helmstetter",
  trigger: "when I catch myself narrating a failure",
  steps: [
    "Stop the sentence mid-thought",
    "Say the corrected self-statement out loud",
    "Write the corrected line into the journal",
  ],
};

describe("buildSkillFromSource", () => {
  it("captures trigger and ordered steps verbatim", () => {
    const { skill } = buildSkillFromSource(base);
    expect(skill.trigger).toBe(base.trigger);
    expect(skill.action_sequence).toEqual(base.steps);
  });

  it("NEVER invents history — zero counters and no last_fired", () => {
    // The load-bearing rule: a book gives a candidate, not a credential.
    const { skill } = buildSkillFromSource(base);
    expect(skill.times_fired).toBe(0);
    expect(skill.times_succeeded).toBe(0);
    expect(skill.times_failed).toBe(0);
    expect(skill.last_fired).toBeNull();
    expect(skill.graduated).toBe(false);
    expect(skill.manually_reviewed).toBe(false);
  });

  it("claims no observed machine signals — it has not been watched happening", () => {
    expect(buildSkillFromSource(base).skill.trigger_signals).toEqual([]);
  });

  it("tier reflects SIZE, not confidence", () => {
    expect(buildSkillFromSource({ ...base, steps: ["Do the one thing"] }).skill.tier).toBe("tiny");
    expect(buildSkillFromSource(base).skill.tier).toBe("tactical");
  });

  it("derives keywords when none are supplied, and honors them when given", () => {
    const derived = buildSkillFromSource(base).skill.keywords;
    expect(derived.length).toBeGreaterThan(0);
    expect(derived).not.toContain("the"); // stopwords dropped
    expect(buildSkillFromSource({ ...base, keywords: ["self-talk"] }).skill.keywords).toEqual([
      "self-talk",
    ]);
  });

  it("the same protocol yields a stable key — re-capture updates, not duplicates", () => {
    expect(buildSkillFromSource(base).key).toBe(buildSkillFromSource(base).key);
  });

  it("refuses hollow input rather than storing a skill that looks actionable", () => {
    expect(() => buildSkillFromSource({ ...base, steps: [] })).toThrow(/step/i);
    expect(() => buildSkillFromSource({ ...base, trigger: "  " })).toThrow(/trigger/i);
    expect(() => buildSkillFromSource({ ...base, sourceLabel: "" })).toThrow(/source/i);
  });

  it("provenance names the source and says it is unproven", () => {
    const line = sourceProvenance(base);
    expect(line).toContain("Helmstetter");
    expect(line).toMatch(/unproven/i);
  });
});

describe("provenance is structural, not just prose", () => {
  it("source_evidence marks it as an EXTERNAL source, never an observed task", () => {
    // Ranking that trusts observed evidence must be able to tell a
    // protocol Nour READ from one he was seen DOING.
    const { skill } = buildSkillFromSource(base);
    expect(skill.source_evidence).toEqual([
      { type: "external_source", id: base.sourceLabel },
    ]);
    expect(skill.source_evidence.some((e) => e.type === "task")).toBe(false);
  });

  it("timestamps are injectable so capture is deterministic", () => {
    const now = "2026-07-29T12:00:00.000Z";
    const { skill } = buildSkillFromSource(base, { now });
    expect(skill.created_at).toBe(now);
    expect(skill.updated_at).toBe(now);
    expect(skill.review_note).toBeNull();
  });
});
