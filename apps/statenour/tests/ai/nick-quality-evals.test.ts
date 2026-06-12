/**
 * Vitest mirror of the Nick quality eval pack — fails CI if any of the
 * 20 agent-quality acceptance criteria regress.
 */
import { describe, it, expect } from "vitest";
import { runNickQualityEvals } from "@/lib/ai/evals/nick-quality-evals";

describe("Nick quality evals · 20 acceptance criteria", () => {
  for (const r of runNickQualityEvals()) {
    it(`#${r.id} ${r.criterion}`, () => {
      expect(r.pass, `${r.criterion} — ${r.detail}`).toBe(true);
    });
  }
});
