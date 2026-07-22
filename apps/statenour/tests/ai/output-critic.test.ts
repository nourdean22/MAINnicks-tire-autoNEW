/**
 * tests/ai/output-critic.test.ts · v10.0.490
 *
 * Locks the axis-specific regen gate. Diagnosis was that overall<55
 * almost never fired (1% in production) because specificity scored
 * 50 avg while cliché + antiNour + length scored 95+ each · those
 * three masked the spec gap. Result: vague-but-clean replies shipped
 * silently.
 *
 * After v10.0.490 ANY single critical-axis miss alone fires regen:
 *   specScore <= 30 · clicheScore <= 20 · antiScore <= 20 ·
 *   lengthScore <= 30
 */
import { describe, it, expect } from "vitest";
import { critiqueOutput } from "@/lib/ai/output-critic";

describe("output-critic · axis-specific regen gate (v10.0.490)", () => {
  it("fires shouldRegen when spec is critical even if overall passes", () => {
    // Generic, hedge-free prose · no clichés, no anti-Nour, length OK.
    // No numbers, names, dates, or system references → spec density
    // floors at the worst bucket (score 30).
    const text =
      "Yes, the question makes sense. The answer depends on the situation, " +
      "and there is no single approach that fits every case. Consider the " +
      "options, and choose the one that feels right based on what works " +
      "best for the goals you have in mind. The path forward can take many " +
      "shapes, and a thoughtful step is usually the right move forward.";

    const score = critiqueOutput(text, "prose");

    expect(score.specificity).toBeLessThanOrEqual(30);
    expect(score.cliche).toBeGreaterThanOrEqual(80);
    expect(score.antiNour).toBeGreaterThanOrEqual(80);
    expect(score.length).toBeGreaterThanOrEqual(80);
    expect(score.shouldRegen).toBe(true);
    expect(score.reasons.some((r) => r.includes("axis-gate"))).toBe(true);
  });

  it("does NOT fire regen when all axes pass minimums", () => {
    // Concrete reply · uses tokens the SPECIFICITY_PATTERNS regex
    // catches: counts of business nouns, system names, temporal
    // anchors, dollar amounts. Spec density bucket should be 60+.
    const text =
      "Today: 12 leads opened, 3 callbacks pending, 5 estimates worth $4,200. " +
      "autonicks shows 8 drops booked this week. Nick handles 2 jobs at " +
      "9:30am. Run cleanup this month before 5/15.";

    const score = critiqueOutput(text, "prose");

    expect(score.specificity).toBeGreaterThanOrEqual(60);
    expect(score.shouldRegen).toBe(false);
  });

  it("fires shouldRegen when reply opens with hedge ('Sorry, I cannot provide')", () => {
    // The 2026-05-12 smoke test failure mode · Nick said this even
    // with GSC data injected in the system prompt. Hedge alone fires
    // regen now.
    const text =
      "Sorry, I cannot provide information about how Nick's Tire performed in Google Search Console (GSC) for the specified period.";
    const score = critiqueOutput(text, "prose");
    expect(score.shouldRegen).toBe(true);
    expect(score.reasons.some((r) => r.includes("hedge"))).toBe(true);
  });

  it("fires shouldRegen on 'Unfortunately' opener", () => {
    const text =
      "Unfortunately, I do not have real-time access to the GSC pipeline at this moment. Try checking the Google Search Console dashboard directly.";
    const score = critiqueOutput(text, "prose");
    expect(score.shouldRegen).toBe(true);
    expect(score.reasons.some((r) => r.includes("hedge"))).toBe(true);
  });

  it("fires shouldRegen on 'I'm unable to' opener", () => {
    const text =
      "I'm unable to retrieve those numbers right now. Refer to the Google Search Console for live data.";
    const score = critiqueOutput(text, "prose");
    expect(score.shouldRegen).toBe(true);
    expect(score.reasons.some((r) => r.includes("hedge"))).toBe(true);
  });

  it("fires shouldRegen on 'as an AI' phrasing", () => {
    const text =
      "As an AI assistant, I do not have direct access to live Google Search Console data. However, I can explain how impressions work...";
    const score = critiqueOutput(text, "prose");
    expect(score.shouldRegen).toBe(true);
    expect(score.reasons.some((r) => r.includes("hedge"))).toBe(true);
  });

  it("does NOT fire hedge gate on reply that cites actual numbers", () => {
    const text =
      "Last 30 days on nickstire.org: 1700 clicks, 17000 impressions, 1% CTR, avg position 25. Top query: 'used tires euclid ohio' with 1500 impressions.";
    const score = critiqueOutput(text, "prose");
    expect(score.shouldRegen).toBe(false);
    expect(score.reasons.some((r) => r.includes("hedge"))).toBe(false);
  });

  it("preserves existing overall<55 gate when overall fails alone", () => {
    // Force a weak overall · ultra-short ("none" shape min=2, max=30 ·
    // 50 words = length 60). Combined with low spec → overall ≤ 55.
    const text = (
      "Yes the thing depends on various factors and there are many ways to " +
      "consider it and the best path forward will be one that you can choose " +
      "based on what works for your specific case and the goals you have."
    );

    const score = critiqueOutput(text, "none");

    // Either overall<55 or critical axis fires · both routes acceptable.
    expect(score.shouldRegen).toBe(true);
  });
});

describe("output-critic · false scope-refusal detection (authority reconciliation)", () => {
  it("flags 'not my lane / use Claude direct / not designed for' deflections -> regen", () => {
    const deflections = [
      "That's not my lane — use Claude direct for a literary essay.",
      "Writing a 2000-word essay is outside my domain. Use Claude directly for this.",
      "That's not what I'm tuned for. Want me to save it as a task instead?",
      "I'm not designed to write literary essays.",
    ];
    for (const text of deflections) {
      const score = critiqueOutput(text, "prose");
      expect(score.shouldRegen).toBe(true);
      expect(score.reasons.some((r) => r.includes("hedge-detected"))).toBe(true);
    }
  });

  it("does NOT flag a normal in-voice reply that merely mentions 'domain' or 'Claude' as content", () => {
    const text =
      "Domain authority for nickstire.org climbed to 18 this week — 3 new backlinks " +
      "from Cleveland auto blogs. Claude's API bill was $42. Next: 5 more guest posts by 5/15.";
    const score = critiqueOutput(text, "prose");
    expect(score.reasons.some((r) => r.includes("hedge-detected"))).toBe(false);
  });
});
