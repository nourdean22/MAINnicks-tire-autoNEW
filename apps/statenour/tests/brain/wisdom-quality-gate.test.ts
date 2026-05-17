/**
 * v10.0.356 · Wisdom quality gate behavior corpus.
 *
 * Locks in the rejection criteria so future tweaks to the gate don't
 * silently change which wisdom-shaped strings get accepted vs demoted.
 */

import { describe, expect, it } from "vitest";
import { gateWisdom } from "@/lib/brain/wisdom-quality-gate";

describe("gateWisdom · accepts principle-shaped wisdom", () => {
  it("WHEN/THEN/BECAUSE form passes", () => {
    const r = gateWisdom(
      "WHEN open loops exceed 8, IMMEDIATELY close 3 before starting new work BECAUSE sleep quality drops within 48h and decision quality follows.",
    );
    expect(r.pass).toBe(true);
  });

  it("threshold + action passes", () => {
    const r = gateWisdom(
      "When energy drops below 4 for 2+ consecutive days, skip new commitments. Three of the last four attempts were abandoned within a week.",
    );
    expect(r.pass).toBe(true);
  });

  it("imperative principle with quantitative evidence passes", () => {
    const r = gateWisdom(
      "Always follow up on quotes by day 1 — day-3 follow-ups close at 2.3x lower rate, treat any quote past day 1 as 50% lost until contacted.",
    );
    expect(r.pass).toBe(true);
  });

  it("philosophical wisdom with conditional + imperative passes", () => {
    const r = gateWisdom(
      "When a part of you is screaming, don't fight it. Ask what it's protecting. The Self is curious; parts are protective. Trust earned beats force every time.",
    );
    expect(r.pass).toBe(true);
  });
});

describe("gateWisdom · rejects vague meta-summaries", () => {
  it("rejects \"Nick frequently provides advice\" pattern", () => {
    const r = gateWisdom(
      "Nick frequently provides detailed advice and updates on various business topics including pricing, marketing, and operations.",
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("vague_meta");
  });

  it("rejects \"Nour's approach reflects\" pattern", () => {
    const r = gateWisdom(
      "Nour's approach reflects discipline and intentionality across his daily routines and business decision-making.",
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("vague_meta");
  });

  it("rejects \"the conversation reflects\" pattern", () => {
    const r = gateWisdom(
      "The conversation reflects the dynamic nature of business operations and the need for adaptability in changing markets.",
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("vague_meta");
  });

  it("ignores [PROMOTED TO WISDOM] tag wrapper but still catches vague body", () => {
    const r = gateWisdom(
      "[PROMOTED TO WISDOM] Nick frequently offers multiple lists detailing best practices in tire shop ops.",
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("vague_meta");
  });
});

describe("gateWisdom · rejects on length", () => {
  it("rejects too-short content", () => {
    const r = gateWisdom("Just do it.");
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("too_short");
  });

  it("rejects too-long content", () => {
    const r = gateWisdom("X".repeat(801));
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("too_long");
  });
});

describe("gateWisdom · rejects on no action shape", () => {
  it("rejects pure description without conditional or imperative", () => {
    const r = gateWisdom(
      "Tire shops in the Midwest have seasonal revenue cycles tied to weather, and retail patterns echo macro trends across the broader auto industry.",
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("no_action_shape");
  });

  it("accepts when an imperative is present", () => {
    const r = gateWisdom(
      "Avoid scheduling deep work during the post-lunch dip. The 1pm-3pm window costs roughly twice what the morning costs in error rate.",
    );
    expect(r.pass).toBe(true);
  });

  it("accepts when a numeric threshold is present", () => {
    const r = gateWisdom(
      "Mornings before 9am consistently produce 22% higher focus scores than afternoon sessions across the last 60 days of journal data.",
    );
    expect(r.pass).toBe(true);
  });
});

describe("gateWisdom · trims and strips lead tags", () => {
  it("trims whitespace before checking length", () => {
    const r = gateWisdom("    short   ");
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("too_short");
  });

  it("strips leading [TAG] before vague-pattern check", () => {
    const r = gateWisdom(
      "[PROVEN PATTERN] Nour usually focuses on customer experience improvements in retail.",
    );
    expect(r.pass).toBe(false);
    expect(r.reason).toBe("vague_meta");
  });
});
