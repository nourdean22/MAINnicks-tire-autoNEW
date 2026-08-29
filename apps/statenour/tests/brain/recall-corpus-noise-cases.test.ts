/**
 * Canaries · label-bearing harvested cases (learning-loops wave 2026-08-28,
 * docs/LEARNING-LOOPS-2026-08-28.md Loop B).
 *
 * The measured defect: all three prior case constructors hard-coded EMPTY
 * relevantKeys AND forbiddenKeys, so every harvested case passed
 * unconditionally under runRecallEval — the corpus could detect a crashed
 * retriever, never a bad one. These pin the fourth source's cases as
 * actually FAILABLE, end to end through the real scorer.
 */
import { describe, it, expect } from "vitest";

import { caseFromNoiseDiscovery } from "@/lib/brain/recall-corpus-builder";
import { runRecallEval, type Retriever } from "@/lib/brain/recall-eval";

const noiseRow = {
  id: "bm-123",
  key: "blindspot_general_deadbeef00000000",
  category: "blind_spot",
  content: "[CRITICAL] general: the SYSTEM CONSTRAINT — high stakes, low attention",
};

describe("caseFromNoiseDiscovery", () => {
  it("carries the judged row's own key as the forbidden key — the first label-bearing shape", () => {
    const c = caseFromNoiseDiscovery(noiseRow);
    expect(c.forbiddenKeys).toEqual([noiseRow.key]);
    expect(c.acceptableAbstention).toBe(true);
    expect(c.provenance).toContain("discovery:bm-123");
    // Severity tag stripped so the query reads like a topic, not a template.
    expect(c.query.startsWith("[CRITICAL]")).toBe(false);
  });

  it("BREAKS: a retriever that surfaces the noise row FAILS the case (non-vacuous)", async () => {
    const c = caseFromNoiseDiscovery(noiseRow);
    const badRetriever: Retriever = async () => [{ key: noiseRow.key, score: 0.9 }];
    const report = await runRecallEval([c], badRetriever, 5);
    expect(report.contradictionInjectionRate).toBeGreaterThan(0);
    expect(report.abstentionCleanRate).toBe(0);
  });

  it("positive control: a retriever that abstains PASSES the case", async () => {
    const c = caseFromNoiseDiscovery(noiseRow);
    const goodRetriever: Retriever = async () => [{ key: "some_other_memory", score: 0.4 }];
    const report = await runRecallEval([c], goodRetriever, 5);
    expect(report.contradictionInjectionRate).toBe(0);
    expect(report.abstentionCleanRate).toBe(1);
  });
});
