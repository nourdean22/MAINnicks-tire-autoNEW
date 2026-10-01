import { describe, expect, it, vi } from "vitest";

const { invokeLLM } = vi.hoisted(() => ({
  invokeLLM: vi.fn(),
}));

vi.mock("./_core/llm", () => ({ invokeLLM }));
vi.mock("./google-reviews", () => ({
  getGoogleReviews: vi.fn(async () => null),
}));

import { generateInstagramStudioDraft } from "./services/instagramStudio";

describe("Instagram Studio model-output normalization", () => {
  it("salvages overlong carousel model output through the real generation boundary", async () => {
    invokeLLM.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            topic: "Cleveland pothole tire check",
            caption: "C".repeat(2400),
            hashtags: ["#Cleveland".repeat(8), "Nickstire", "Nickstire"],
            headline: "H".repeat(80),
            subheadline: "S".repeat(140),
            cta: "CALL OR WALK IN TODAY FOR A QUICK STRAIGHT ANSWER".repeat(2),
            artDirection: "A".repeat(700),
            rationale: "R".repeat(700),
            conceptKey: "Pothole Tire Bubble Warning With Extra Words".repeat(3),
            carouselSlides: [
              { role: "hook", headline: "H".repeat(80), body: "B".repeat(160), artDirection: "A".repeat(360) },
              { role: "truth", headline: "H".repeat(80), body: "B".repeat(160), artDirection: "A".repeat(360) },
              { role: "proof", headline: "H".repeat(80), body: "B".repeat(160), artDirection: "A".repeat(360) },
              { role: "action", headline: "H".repeat(80), body: "B".repeat(160), artDirection: "A".repeat(360) },
              { role: "cta", headline: "H".repeat(80), body: "B".repeat(160), artDirection: "A".repeat(360) },
            ],
          }),
        },
      }],
    });

    const draft = await generateInstagramStudioDraft({
      source: { type: "manual_idea", detail: "Explain pothole tire damage without inventing claims." },
      format: "carousel",
      objective: "education",
    });

    expect(draft.caption).toHaveLength(2200);
    expect(draft.headline).toHaveLength(42);
    expect(draft.subheadline).toHaveLength(90);
    expect(draft.cta).toHaveLength(52);
    expect(draft.artDirection).toHaveLength(500);
    expect(draft.rationale).toHaveLength(500);
    expect(draft.conceptKey.length).toBeLessThanOrEqual(64);
    expect(draft.hashtags).toHaveLength(2);
    expect(draft.carouselSlides).toHaveLength(5);
    for (const slide of draft.carouselSlides) {
      expect(slide.headline).toHaveLength(42);
      expect(slide.body).toHaveLength(110);
      expect(slide.artDirection).toHaveLength(300);
    }
  });
});
