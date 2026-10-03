/**
 * NICKSTIRE-9 (2026-09-30): instagramStudio.generate ran 40.9s and failed with
 * "The content model returned an empty draft." The draft call budgeted
 * maxTokens 4096 while reasoning models spend hidden thinking from the same
 * budget — the defect carouselBriefGen/reelBriefGen already fixed at 24576.
 * Pins the budget and that an empty reply names its finish_reason.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { invokeLLM } = vi.hoisted(() => ({ invokeLLM: vi.fn() }));

vi.mock("./_core/llm", () => ({ invokeLLM }));
vi.mock("./google-reviews", () => ({ getGoogleReviews: vi.fn(async () => null) }));

import { generateInstagramStudioDraft } from "./services/instagramStudio";

const input = {
  source: { type: "manual_idea" as const, detail: "Explain pothole tire damage without inventing claims." },
  format: "post" as const,
  objective: "education" as const,
};

describe("Instagram Studio draft generation output budget", () => {
  beforeEach(() => invokeLLM.mockReset());

  it("gives the draft call reasoning-model headroom (>= the sibling generators' 24576)", async () => {
    invokeLLM.mockResolvedValueOnce({ choices: [{ message: { content: "" }, finish_reason: "length" }] });
    await expect(generateInstagramStudioDraft(input)).rejects.toThrow();
    const params = invokeLLM.mock.calls[0][0] as { maxTokens: number; timeoutMs: number };
    expect(params.maxTokens).toBeGreaterThanOrEqual(24_576);
    expect(params.timeoutMs).toBeGreaterThanOrEqual(120_000);
  });

  it("says the budget ran out when the empty reply was a length truncation", async () => {
    invokeLLM.mockResolvedValueOnce({ choices: [{ message: { content: "" }, finish_reason: "length" }] });
    await expect(generateInstagramStudioDraft(input)).rejects.toThrow(/finish_reason=length/);
  });

  it("names the provider's finish_reason for any other empty reply", async () => {
    invokeLLM.mockResolvedValueOnce({ choices: [{ message: { content: "   " }, finish_reason: "content_filter" }] });
    await expect(generateInstagramStudioDraft(input)).rejects.toThrow(/empty draft \(finish_reason=content_filter\)/);
  });
});
