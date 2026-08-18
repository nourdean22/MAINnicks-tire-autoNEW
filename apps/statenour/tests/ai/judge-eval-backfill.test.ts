/**
 * tests/ai/judge-eval-backfill.test.ts
 *
 * Pins the history-preservation rule in lib/ai/judge-eval/backfill.ts:
 * an already-judged message's backfill row must never carry core axes
 * or a composite — otherwise it double-counts core means in the census
 * and re-attributes historical scores to today's judge lane.
 */

import { describe, expect, it } from "vitest";
import {
  BACKFILL_KEY_PREFIX,
  planBackfillRow,
} from "@/lib/ai/judge-eval/backfill";
import type { JudgeReport } from "@/lib/ai/judge-eval";

const report: JudgeReport = {
  composite: 7.4,
  rubric: {
    accuracy: 8,
    actionability: 7,
    brevity: 7,
    tone: 8,
    evidence: 7,
    obedience: 9,
    nonSycophancy: 4,
    calibration: 6,
  },
  reasoning: "direct but flattered the premise",
  flagForReview: false,
  judgedBy: "ollama:deepseek-v4-flash",
  durationMs: 900,
};

describe("planBackfillRow · never-judged message", () => {
  const plan = planBackfillRow("msg123", false, report, "2026-08-18T12:00:00.000Z");

  it("uses the normal judge_ key with the full rubric + composite", () => {
    expect(plan.key).toBe("judge_msg123");
    expect(plan.rubric).toEqual(report.rubric);
    expect(plan.composite).toBe(7.4);
    expect(plan.metadata.flagForReview).toBe(false);
  });

  it("carries backfill provenance so downstream can distinguish eras", () => {
    expect(plan.metadata.backfill).toBe(true);
    expect(plan.metadata.messageId).toBe("msg123");
    expect(plan.metadata.judgedBy).toBe("ollama:deepseek-v4-flash");
  });
});

describe("planBackfillRow · already-judged message (the load-bearing case)", () => {
  const plan = planBackfillRow("msg456", true, report, "2026-08-18T12:00:00.000Z");

  it("writes a companion bf key, never the original judgment's key", () => {
    expect(plan.key).toBe(`${BACKFILL_KEY_PREFIX}msg456`);
  });

  it("persists ONLY persona axes — no core axes, no composite", () => {
    expect(plan.rubric).toEqual({ obedience: 9, nonSycophancy: 4, calibration: 6 });
    expect(plan.composite).toBeNull();
    const persisted = plan.metadata.rubric as Record<string, unknown>;
    expect(persisted.accuracy).toBeUndefined();
    expect(persisted.tone).toBeUndefined();
    expect(persisted.evidence).toBeUndefined();
    expect(plan.metadata.composite).toBeUndefined();
  });

  it("links back to the untouched original row", () => {
    expect(plan.metadata.complementsKey).toBe("judge_msg456");
    expect(plan.metadata.personaOnly).toBe(true);
  });
});
