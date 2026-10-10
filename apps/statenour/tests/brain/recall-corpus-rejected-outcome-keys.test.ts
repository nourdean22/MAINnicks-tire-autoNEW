/**
 * Audit 2026-10-10 · 06-F12. A rejected-outcome case with empty relevantKeys
 * AND empty forbiddenKeys can never fail recall-eval (forbiddenInjected needs a
 * non-empty list). When the ledger row's evidence names the memory row(s) it
 * surfaced, those keys become the forbidden distractors.
 */
import { describe, expect, it } from "vitest";
import { caseFromRejectedOutcome } from "@/lib/brain/recall-corpus-builder";

const row = {
  id: "out_1",
  kind: "suggestion",
  sourceEngine: "discovery:insight",
  summary: "You always skip Friday reviews",
  decision: "dismissed",
  outcomeUseful: null,
};

describe("caseFromRejectedOutcome · keys from evidence", () => {
  it("evidence memory keys become forbiddenKeys, so the case can fail", () => {
    expect(caseFromRejectedOutcome({ ...row, evidenceRefs: { memoryKey: "k1" } }).forbiddenKeys).toEqual(["k1"]);
    expect(caseFromRejectedOutcome({ ...row, evidenceRefs: { memoryKeys: ["k1", "k2", 3] } }).forbiddenKeys).toEqual(["k1", "k2"]);
  });

  it("no evidence keys -> still empty (honest: nothing to assert against)", () => {
    expect(caseFromRejectedOutcome({ ...row, evidenceRefs: { taskId: "t1" } }).forbiddenKeys).toEqual([]);
    expect(caseFromRejectedOutcome(row).forbiddenKeys).toEqual([]);
  });
});
