/**
 * tests/brain/recall-corpus-builder.test.ts — recall corpus V2
 * (2026-07-29): real corrections become eval cases with honest
 * provenance, and the composition report refuses to imply quality
 * while the corpus is synthetic-only.
 */

import { describe, it, expect } from "vitest";
import {
  caseFromRejectedOutcome,
  caseFromClaimWarning,
  describeCorpus,
} from "@/lib/brain/recall-corpus-builder";
import { SEED_CASES } from "@/lib/brain/recall-eval";

describe("caseFromRejectedOutcome", () => {
  const row = {
    id: "out_123",
    kind: "suggestion",
    sourceEngine: "rescue-scanner",
    summary: "Reschedule the alignment promo to next week",
    decision: "dismissed",
    outcomeUseful: null,
  };

  it("carries real provenance naming the source row — never synthetic-seed", () => {
    const c = caseFromRejectedOutcome(row);
    expect(c.provenance).toContain("outcome:out_123");
    expect(c.provenance).toContain("rescue-scanner");
    expect(c.provenance).not.toBe("synthetic-seed");
  });

  it("a rejected recommendation becomes an ABSTENTION case, not an invented expectation", () => {
    const c = caseFromRejectedOutcome(row);
    expect(c.kind).toBe("abstention");
    expect(c.acceptableAbstention).toBe(true);
    expect(c.relevantKeys).toEqual([]);
  });

  it("distinguishes dismissed from not-useful in the provenance trail", () => {
    expect(caseFromRejectedOutcome(row).provenance).toContain("dismissed");
    expect(
      caseFromRejectedOutcome({ ...row, decision: null, outcomeUseful: false }).provenance,
    ).toContain("marked not useful");
  });

  it("ids are slugged and stable for the same source row", () => {
    expect(caseFromRejectedOutcome(row).id).toBe(caseFromRejectedOutcome(row).id);
    expect(caseFromRejectedOutcome(row).id).toMatch(/^real-outcome-[a-z0-9-]+$/);
  });
});

describe("caseFromClaimWarning", () => {
  const row = {
    key: "sdk-fail-trace123",
    content: "SDK tool call failed · expected tools: createTask",
    metadata: {
      claims: [{ verb: "created the task", expectedTool: "createTask" }],
      textPreview: "I created the task for the alignment promo.",
    },
  };

  it("uses the operator-visible text as the query and names the unproven verb", () => {
    const c = caseFromClaimWarning(row);
    expect(c.query).toContain("I created the task");
    expect(c.provenance).toContain("created the task");
    expect(c.provenance).toContain("chat_claim_warn:sdk-fail-trace123");
  });

  it("degrades to the row content when metadata is missing — never crashes on shape drift", () => {
    const c = caseFromClaimWarning({ key: "k", content: "fallback text", metadata: null });
    expect(c.query).toBe("fallback text");
    expect(c.provenance).toContain("the claimed action");
  });
});

describe("describeCorpus", () => {
  it("synthetic-only corpora are labeled as a smoke test, NOT a quality measure", () => {
    const d = describeCorpus(SEED_CASES);
    expect(d.real).toBe(0);
    expect(d.hasRealEvidence).toBe(false);
    expect(d.note).toContain("SYNTHETIC ONLY");
  });

  it("counts real cases and flips the evidence flag once corrections land", () => {
    const mixed = [
      ...SEED_CASES,
      caseFromRejectedOutcome({
        id: "o1",
        kind: "suggestion",
        sourceEngine: "e",
        summary: "s",
        decision: "dismissed",
        outcomeUseful: null,
      }),
    ];
    const d = describeCorpus(mixed);
    expect(d.real).toBe(1);
    expect(d.synthetic).toBe(SEED_CASES.length);
    expect(d.total).toBe(SEED_CASES.length + 1);
    expect(d.hasRealEvidence).toBe(true);
    expect(d.note).toContain("1 real case");
  });
});
