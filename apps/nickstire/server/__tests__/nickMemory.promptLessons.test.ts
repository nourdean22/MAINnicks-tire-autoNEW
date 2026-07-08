/**
 * Regression tests for rankPromptLessons — the lessons spliced into the LIVE VAPI
 * receptionist prompt. A /verify against the production memory pool found that
 * non-receptionist type:'lesson' rows (statenour alerts, data-accuracy checks)
 * dominate by uses×confidence and would be injected. These lock the source filter.
 */
import { describe, it, expect } from "vitest";
import { rankPromptLessons, type NickMemory } from "../services/nickMemory";

function mem(p: Partial<NickMemory>): NickMemory {
  return { id: 1, type: "lesson", content: "c", source: "vapi_eval_cron", confidence: 0.7, uses: 1, createdAt: "", ...p };
}

describe("rankPromptLessons", () => {
  it("REGRESSION: excludes non-receptionist lessons even at huge uses×confidence (the live-pool junk)", () => {
    const junk = mem({ source: "accuracy_check", confidence: 1, uses: 2532, content: "Data accuracy: invoices missing phone" });
    const alert = mem({ source: "statenour_alerts", confidence: 1, uses: 880, content: "[statenour-alert] novelty-seeking" });
    const real = mem({ source: "vapi_eval_cron", confidence: 0.7, uses: 2, content: 'Callers about "brakes" keep ending without a booking.' });
    const out = rankPromptLessons([junk, alert, real]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain("brakes");
  });

  it("keeps only confidence >= 0.65 vapi_eval_cron lessons (a fresh 0.6 one-off never reaches the prompt)", () => {
    const low = mem({ source: "vapi_eval_cron", confidence: 0.6, content: "fresh one-off" });
    const ok = mem({ source: "vapi_eval_cron", confidence: 0.65, content: "reinforced once" });
    expect(rankPromptLessons([low, ok]).map((m) => m.content)).toEqual(["reinforced once"]);
  });

  it("ranks by confidence * uses and caps at max", () => {
    const a = mem({ source: "vapi_eval_cron", confidence: 0.7, uses: 1, content: "A" });
    const b = mem({ source: "vapi_eval_cron", confidence: 0.7, uses: 5, content: "B" });
    const c = mem({ source: "vapi_eval_cron", confidence: 0.9, uses: 1, content: "C" });
    expect(rankPromptLessons([a, b, c], { max: 2 }).map((m) => m.content)).toEqual(["B", "C"]);
  });

  it("returns [] when no receptionist lesson qualifies", () => {
    expect(rankPromptLessons([mem({ source: "accuracy_check", confidence: 1, uses: 999 })])).toEqual([]);
  });
});
