/**
 * /save → brain ingest · May 02 · v10.0.143
 *
 * User-triggered ingest with heuristic auto-categorization. Tests
 * cover both pure categorization (no DB) and the saveToBrain write
 * path with prisma mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    create: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mocks.brainMemory,
  },
}));

import { categorizeForSave, saveToBrain } from "@/lib/services/brain/save";

describe("categorizeForSave", () => {
  it("decision keywords route to 'decision'", () => {
    expect(categorizeForSave("I decided to move the rebrand to Q3")).toBe("decision");
    expect(categorizeForSave("decision: pause the email campaign")).toBe("decision");
    expect(categorizeForSave("going with the gold and black palette")).toBe("decision");
  });

  it("belief keywords route to 'belief'", () => {
    expect(categorizeForSave("I believe trust beats discount in this market")).toBe("belief");
    expect(categorizeForSave("My view is that long-form converts better")).toBe("belief");
  });

  it("strategy keywords route to 'strategy'", () => {
    expect(categorizeForSave("The strategy is to dominate Cleveland local search first")).toBe("strategy");
    expect(categorizeForSave("New playbook for inbound calls")).toBe("strategy");
  });

  it("brand/marketing keywords route to 'brand_marketing'", () => {
    expect(categorizeForSave("Our brand voice should feel like a senior mechanic")).toBe("brand_marketing");
    expect(categorizeForSave("Write captions in plain language, no jargon")).toBe("brand_marketing");
    expect(categorizeForSave("Instagram engagement spikes on educational reels")).toBe("brand_marketing");
  });

  it("pattern keywords route to 'pattern'", () => {
    expect(categorizeForSave("Pattern: every Friday afternoon discipline drops")).toBe("pattern");
    expect(categorizeForSave("Always batch oil changes on Mondays")).toBe("pattern");
  });

  it("falls back to 'user_save' when nothing matches", () => {
    expect(categorizeForSave("just a random thought about the weather")).toBe("user_save");
  });

  it("category precedence — decision wins over brand", () => {
    // A sentence that mentions both decision + brand keywords should
    // resolve to "decision" because it's checked first (the user
    // explicitly committed to something).
    expect(
      categorizeForSave("I decided the brand voice will stay direct and educational"),
    ).toBe("decision");
  });
});

describe("saveToBrain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.brainMemory.create.mockResolvedValue({ id: "bm-123" });
  });

  it("writes a BrainMemory row with auto-categorized category", async () => {
    const result = await saveToBrain({
      content: "I decided to launch the Cleveland tire promotion in May",
    });
    expect(result.id).toBe("bm-123");
    expect(result.category).toBe("decision");
    expect(result.key).toMatch(/^decision_\d+$/);
    expect(mocks.brainMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: "decision",
          source: "user_save",
        }),
      }),
    );
  });

  it("respects an explicit category override", async () => {
    const result = await saveToBrain({
      content: "anything at all",
      category: "belief",
    });
    expect(result.category).toBe("belief");
    expect(mocks.brainMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ category: "belief" }),
      }),
    );
  });

  it("rejects content shorter than 3 chars", async () => {
    await expect(saveToBrain({ content: "ok" })).rejects.toThrow(/too short/i);
    expect(mocks.brainMemory.create).not.toHaveBeenCalled();
  });

  it("includes a slug in the key when keyHint is provided", async () => {
    // Content matches "strategy" before "marketing" in the categorizer
    // (decision → belief → strategy → brand_marketing) — so it
    // resolves to strategy. Either category is fine for the slug
    // assertion; we're verifying the keyHint slug shows up.
    const result = await saveToBrain({
      content: "marketing strategy thought",
      keyHint: "Q3 launch plan",
    });
    expect(result.key).toMatch(/^strategy_q3-launch-plan_\d+$/);
  });

  it("returns a confirmation summary truncated at 120 chars", async () => {
    const long = "a".repeat(300);
    const result = await saveToBrain({ content: long });
    // "Saved as user_save · " prefix + 120 chars + "…"
    expect(result.summary).toContain("Saved as user_save");
    expect(result.summary).toMatch(/…$/);
  });
});
