/**
 * chat-output-budget · 2026-10-02
 *
 * Pinned from a production failure: a "factual" turn was capped at 800 output
 * tokens, the thinking model spent them all reasoning, and the operator got an
 * empty answer. A shaped cap may never fall below the thinking floor; research
 * mode and unshaped turns keep their values.
 */
import { describe, expect, it } from "vitest";
import { detectQueryShape } from "@/lib/ai/query-shape";
import { deriveMaxOutputTokens, THINKING_OUTPUT_FLOOR } from "@/lib/ai/chat-output-budget";

describe("deriveMaxOutputTokens", () => {
  it("the production case: a factual question in deep mode is no longer capped at 800", () => {
    const shape = detectQueryShape("how many tasks do I have open");
    expect(shape.shape).toBe("factual");
    expect(shape.tokenBudget).toBe(800);
    const { maxOutputTokens } = deriveMaxOutputTokens({ mode: "deep", researchCompilerMode: null, shapeBudget: shape.tokenBudget });
    expect(maxOutputTokens).toBeGreaterThanOrEqual(THINKING_OUTPUT_FLOOR);
  });

  it.each([300, 500, 800, 2800])("a shaped budget of %i is floored at the thinking floor", (b) => {
    expect(deriveMaxOutputTokens({ mode: "standard", researchCompilerMode: null, shapeBudget: b }).maxOutputTokens).toBe(THINKING_OUTPUT_FLOOR);
  });

  it("a shaped budget above the floor is kept", () => {
    expect(deriveMaxOutputTokens({ mode: "standard", researchCompilerMode: null, shapeBudget: 7000 }).maxOutputTokens).toBe(7000);
  });

  it("unshaped turns get the mode default; research mode gets 8000", () => {
    expect(deriveMaxOutputTokens({ mode: "deep", researchCompilerMode: null, shapeBudget: 0 })).toEqual({ maxOutputTokens: 10000, modeDefaultTokens: 10000 });
    expect(deriveMaxOutputTokens({ mode: "standard", researchCompilerMode: null, shapeBudget: 0 }).maxOutputTokens).toBe(6000);
    expect(deriveMaxOutputTokens({ mode: "deep", researchCompilerMode: "general", shapeBudget: 800 }).maxOutputTokens).toBe(8000);
  });

  it("the floor covers the measured completion distribution (max 3,611 tokens)", () => {
    expect(THINKING_OUTPUT_FLOOR).toBeGreaterThan(3611);
  });
});
