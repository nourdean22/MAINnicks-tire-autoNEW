/**
 * isAiSentinel - the one predicate every aiChat/tracedAiChat consumer uses to
 * tell a total provider-chain failure (which RETURNS, never throws) from a
 * real model reply. Audit 2026-10-10 (04-F1, 08-F5): production runs a single
 * Ollama provider and hits the emergency sentinel ~30 times a day.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { aiGeneration: { groupBy: vi.fn().mockResolvedValue([]) } },
}));

import { isAiSentinel } from "@/lib/ai/provider";

describe("isAiSentinel", () => {
  it("is true for the emergency sentinel even though its content is non-empty prose", () => {
    expect(
      isAiSentinel({ content: "I'm having trouble connecting to my AI providers right now.", provider: "emergency" }),
    ).toBe(true);
  });

  it("is true for the lane-budget 'none' sentinel", () => {
    expect(isAiSentinel({ content: "", provider: "none" })).toBe(true);
  });

  it("is true for empty or whitespace-only content from a real provider", () => {
    expect(isAiSentinel({ content: "", provider: "ollama" })).toBe(true);
    expect(isAiSentinel({ content: "   \n", provider: "ollama" })).toBe(true);
  });

  it("is true for a missing result", () => {
    expect(isAiSentinel(null)).toBe(true);
    expect(isAiSentinel(undefined)).toBe(true);
  });

  it("is false for a real reply", () => {
    expect(isAiSentinel({ content: "Here is the answer.", provider: "ollama" })).toBe(false);
  });
});
