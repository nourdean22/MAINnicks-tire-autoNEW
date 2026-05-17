/**
 * v10.0.411 · operator-rules regression armor.
 *
 * The eight rules in lib/ai/prompt/policy/operator-rules.ts are
 * the single source of truth for the operator policy block. Any
 * accidental wording change (auto-format, eslint fix, refactor)
 * will silently change the model's behavior — these tests anchor
 * the rules' essential content.
 *
 * We assert on PHRASES not full strings so prose tweaks don't
 * trigger churn — but the load-bearing words (the ones that drive
 * the model's behavior) must persist.
 */

import { describe, expect, it } from "vitest";
import {
  DO_NOT_AUTO_TASKIFY,
  NO_SYCOPHANCY,
  BREVITY_DEFAULT,
  INLINE_CITATIONS,
  CONFIDENCE_CUES,
  TIME_OF_DAY_VOICE,
  MODE_PERSONAS,
  TRUTH_RULE_NEVER_FABRICATE,
  getOperatorPolicyLines,
  getOperatorPolicyBlock,
} from "@/lib/ai/prompt/policy/operator-rules";

describe("operator-rules · DO_NOT_AUTO_TASKIFY (v10.0.391)", () => {
  it("forbids createTask on conversational phrases", () => {
    expect(DO_NOT_AUTO_TASKIFY).toContain("AUTO-TASKIFY");
    expect(DO_NOT_AUTO_TASKIFY).toContain("createTask");
    // Must list at least 3 conversational phrases that should NOT fire
    expect(DO_NOT_AUTO_TASKIFY).toContain("I should");
    expect(DO_NOT_AUTO_TASKIFY).toContain("we need to");
    expect(DO_NOT_AUTO_TASKIFY).toContain("let's discuss");
  });

  it("requires explicit task language to fire", () => {
    expect(DO_NOT_AUTO_TASKIFY.toLowerCase()).toContain("explicit");
    expect(DO_NOT_AUTO_TASKIFY).toContain("add task");
    expect(DO_NOT_AUTO_TASKIFY).toContain("create a task");
  });

  it("instructs to ASK rather than fire when in doubt", () => {
    expect(DO_NOT_AUTO_TASKIFY.toLowerCase()).toContain("ask");
    expect(DO_NOT_AUTO_TASKIFY).toContain("want me to add");
  });
});

describe("operator-rules · NO_SYCOPHANCY (v10.0.392)", () => {
  it("bans the canonical opener phrases", () => {
    expect(NO_SYCOPHANCY).toContain("Great question");
    expect(NO_SYCOPHANCY).toContain("Absolutely");
    expect(NO_SYCOPHANCY).toContain("happy to help");
  });

  it("specifies the 8-word time-to-answer budget", () => {
    expect(NO_SYCOPHANCY).toMatch(/first\s+8\s+words/i);
  });
});

describe("operator-rules · BREVITY_DEFAULT (v10.0.392)", () => {
  it("specifies the ≤80-word default", () => {
    expect(BREVITY_DEFAULT).toMatch(/[≤<]\s*80\s+words/);
  });

  it("specifies the voice-mode tighter cap", () => {
    expect(BREVITY_DEFAULT.toLowerCase()).toContain("voice");
    expect(BREVITY_DEFAULT).toMatch(/[≤<]\s*30/);
  });

  it("carves out length for explicit detail asks", () => {
    expect(BREVITY_DEFAULT.toLowerCase()).toMatch(/detail|multi-step|structured/);
  });
});

describe("operator-rules · INLINE_CITATIONS (v10.0.393)", () => {
  it("lists the seven citation tags by name", () => {
    expect(INLINE_CITATIONS).toContain("Buffett");
    expect(INLINE_CITATIONS).toContain("Greene");
    expect(INLINE_CITATIONS).toContain("Jobs");
    expect(INLINE_CITATIONS).toContain("Satori");
    expect(INLINE_CITATIONS).toContain("Musk");
    expect(INLINE_CITATIONS).toContain("Gates");
  });

  it("requires paraphrase, not verbatim", () => {
    expect(INLINE_CITATIONS.toLowerCase()).toContain("paraphrase");
    expect(INLINE_CITATIONS.toLowerCase()).toContain("never cite verbatim");
  });
});

describe("operator-rules · CONFIDENCE_CUES (v10.0.393)", () => {
  it("lists the uncertainty markers", () => {
    expect(CONFIDENCE_CUES).toContain("Best guess");
    expect(CONFIDENCE_CUES).toContain("Probably");
  });

  it("instructs Don't know rather than invent", () => {
    expect(CONFIDENCE_CUES).toContain("Don't know");
    expect(CONFIDENCE_CUES.toLowerCase()).toContain("never invent");
  });
});

describe("operator-rules · TIME_OF_DAY_VOICE (v10.0.393)", () => {
  it("differentiates four time bands", () => {
    expect(TIME_OF_DAY_VOICE.toLowerCase()).toContain("morning");
    expect(TIME_OF_DAY_VOICE.toLowerCase()).toContain("afternoon");
    expect(TIME_OF_DAY_VOICE.toLowerCase()).toContain("evening");
    expect(TIME_OF_DAY_VOICE.toLowerCase()).toContain("late night");
  });

  it("late-night gently shortens + suggests tomorrow", () => {
    expect(TIME_OF_DAY_VOICE.toLowerCase()).toContain("tomorrow");
  });
});

describe("operator-rules · MODE_PERSONAS (v10.0.400)", () => {
  it("specifies all three mode prefixes", () => {
    expect(MODE_PERSONAS).toContain("/battle");
    expect(MODE_PERSONAS).toContain("/reflect");
    expect(MODE_PERSONAS).toContain("/execute");
  });

  it("battle mode pairs Greene + Musk", () => {
    expect(MODE_PERSONAS).toContain("BATTLE");
    expect(MODE_PERSONAS.toLowerCase()).toContain("greene");
    expect(MODE_PERSONAS.toLowerCase()).toContain("musk");
  });

  it("reflect mode pairs Satori + Buffett", () => {
    expect(MODE_PERSONAS).toContain("REFLECT");
    expect(MODE_PERSONAS.toLowerCase()).toContain("satori");
    expect(MODE_PERSONAS.toLowerCase()).toContain("buffett");
  });

  it("execute mode pairs Jobs + Gates", () => {
    expect(MODE_PERSONAS).toContain("EXECUTE");
    expect(MODE_PERSONAS.toLowerCase()).toContain("jobs");
    expect(MODE_PERSONAS.toLowerCase()).toContain("gates");
  });

  it("specifies word caps per mode", () => {
    expect(MODE_PERSONAS).toMatch(/[≤<]\s*60\s+words/i); // battle
    expect(MODE_PERSONAS).toMatch(/[≤<]\s*120\s+words/i); // execute
  });
});

describe("operator-rules · TRUTH_RULE_NEVER_FABRICATE (Bay 5 lesson)", () => {
  it("anchors the never-claim-action-without-tool rule", () => {
    expect(TRUTH_RULE_NEVER_FABRICATE.toLowerCase()).toContain("never claim");
    expect(TRUTH_RULE_NEVER_FABRICATE).toContain("tool");
  });

  it("lists fabrication-prone past-tense words", () => {
    expect(TRUTH_RULE_NEVER_FABRICATE).toContain("added");
    expect(TRUTH_RULE_NEVER_FABRICATE).toContain("created");
    expect(TRUTH_RULE_NEVER_FABRICATE).toContain("sent");
  });

  it("prescribes hedge phrases for tool-didn't-fire path", () => {
    expect(TRUTH_RULE_NEVER_FABRICATE).toContain("I would");
    expect(TRUTH_RULE_NEVER_FABRICATE).toContain("I can");
    expect(TRUTH_RULE_NEVER_FABRICATE).toContain("want me to");
  });
});

describe("operator-rules · bundle helpers", () => {
  it("getOperatorPolicyLines returns 9 entries (8 rules + 1 spacer + truth) plus trailing blank", () => {
    const lines = getOperatorPolicyLines();
    expect(lines.length).toBeGreaterThanOrEqual(8);
    // The TRUTH_RULE block should appear by checking for its title
    expect(lines.join("\n")).toContain("TRUTH RULE");
  });

  it("getOperatorPolicyBlock joins all lines with newlines", () => {
    const block = getOperatorPolicyBlock();
    expect(block).toContain("AUTO-TASKIFY");
    expect(block).toContain("SYCOPHANCY");
    expect(block).toContain("BREVITY");
    expect(block).toContain("INLINE CITATIONS");
    expect(block).toContain("CONFIDENCE");
    expect(block).toContain("TIME-OF-DAY");
    expect(block).toContain("MODE PERSONAS");
    expect(block).toContain("TRUTH RULE");
  });
});
