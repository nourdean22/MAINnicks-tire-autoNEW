import { describe, expect, it } from "vitest";
import {
  buildKnowledgeCandidate,
  evaluateKnowledgeCandidate,
  knowledgeCandidateMetadata,
} from "@/lib/knowledge/candidate";

describe("knowledge candidate governance", () => {
  it("accepts a well-supported low-risk observation as canonical knowledge", () => {
    const candidate = buildKnowledgeCandidate({
      content: "The operator completed the Obsidian sync successfully.",
      kind: "observation",
      sourceType: "obsidian",
      sourceId: "01_Inbox/sync-log.md",
      generatedBy: "human:obsidian",
      confidence: 0.9,
      evidence: [
        {
          type: "operator_authored",
          value: "01_Inbox/sync-log.md",
        },
      ],
    });

    const gate = evaluateKnowledgeCandidate(candidate);

    expect(gate).toMatchObject({
      decision: "accept",
      canonicalEligible: true,
      actionEligible: false,
      reasons: [],
    });
  });

  it("requires review when NotebookLM output lacks source evidence", () => {
    const candidate = buildKnowledgeCandidate({
      content: "A competitor reportedly changed its brake pricing strategy.",
      kind: "fact",
      sourceType: "notebooklm",
      sourceId: "competitor-pack:item-1",
      generatedBy: "notebooklm",
      confidence: 0.88,
      evidence: [],
    });

    const gate = evaluateKnowledgeCandidate(candidate);

    expect(gate.decision).toBe("review_required");
    expect(gate.canonicalEligible).toBe(false);
    expect(gate.reasons).toContain("evidence_required");
  });

  it("does not permit an extracted action without explicit operator confirmation", () => {
    const candidate = buildKnowledgeCandidate({
      content: "Create a new landing page for hybrid vehicle diagnostics.",
      kind: "action",
      sourceType: "notebooklm",
      sourceId: "seo-pack:action-1",
      generatedBy: "notebooklm",
      confidence: 0.92,
      evidence: [
        {
          type: "source_document",
          value: "research-packs/seo-pack/05_ACTION_PLAN.md",
        },
      ],
    });

    const gate = evaluateKnowledgeCandidate(candidate);

    expect(gate.decision).toBe("review_required");
    expect(gate.actionEligible).toBe(false);
    expect(gate.reasons).toContain("action_requires_operator_confirmation");
  });

  it("permits a low-risk action after explicit operator confirmation", () => {
    const candidate = buildKnowledgeCandidate({
      content: "Create a new landing page for hybrid vehicle diagnostics.",
      kind: "action",
      sourceType: "notebooklm",
      sourceId: "seo-pack:action-1",
      generatedBy: "notebooklm",
      confidence: 0.92,
      evidence: [
        {
          type: "source_document",
          value: "research-packs/seo-pack/05_ACTION_PLAN.md",
        },
        {
          type: "operator_confirmation",
          value: "CLI --create-tasks",
        },
      ],
    });

    const gate = evaluateKnowledgeCandidate(candidate);

    expect(gate).toMatchObject({
      decision: "accept",
      canonicalEligible: false,
      actionEligible: true,
      reasons: [],
    });
  });

  it("always routes Graphify findings to review because the graph is a snapshot", () => {
    const candidate = buildKnowledgeCandidate({
      content: "The authentication module is a high-degree dependency hub.",
      kind: "inference",
      sourceType: "graphify",
      sourceId: "graph-report:community-12",
      generatedBy: "graphify",
      confidence: 0.95,
      evidence: [
        {
          type: "source_document",
          value: "graphify-out/GRAPH_REPORT.md",
        },
      ],
    });

    const gate = evaluateKnowledgeCandidate(candidate);

    expect(gate.decision).toBe("review_required");
    expect(gate.reasons).toContain("graph_snapshot_requires_review");
  });

  it("rejects extremely weak candidates instead of polluting memory", () => {
    const candidate = buildKnowledgeCandidate({
      content: "Maybe something changed in the system yesterday.",
      kind: "inference",
      sourceType: "system",
      sourceId: "uncertain-signal",
      generatedBy: "system",
      confidence: 0.1,
      evidence: [],
    });

    const gate = evaluateKnowledgeCandidate(candidate);

    expect(gate.decision).toBe("reject");
    expect(gate.reasons).toContain("confidence_below_minimum");
  });

  it("produces stable content hashes while keeping source-specific candidate ids", () => {
    const first = buildKnowledgeCandidate({
      content: "Brake jobs increased this week.",
      kind: "observation",
      sourceType: "manual",
      sourceId: "note-a",
      generatedBy: "human",
      confidence: 0.8,
      evidence: [{ type: "operator_authored", value: "note-a" }],
    });
    const second = buildKnowledgeCandidate({
      content: "Brake jobs increased this week.\r\n",
      kind: "observation",
      sourceType: "obsidian",
      sourceId: "note-b",
      generatedBy: "human:obsidian",
      confidence: 0.8,
      evidence: [{ type: "operator_authored", value: "note-b" }],
    });

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.id).not.toBe(second.id);

    const metadata = knowledgeCandidateMetadata(first, evaluateKnowledgeCandidate(first));
    expect(metadata).not.toHaveProperty("content");
    expect(metadata).toMatchObject({
      candidateId: first.id,
      contentHash: first.contentHash,
      gateDecision: "accept",
    });
  });
});
