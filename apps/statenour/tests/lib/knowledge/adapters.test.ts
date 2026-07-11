import { describe, expect, it } from "vitest";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  buildNotebookLmCandidate,
  parseNotebookLmMarkdown,
} from "@/lib/knowledge/adapters/notebooklm";
import {
  buildObsidianCandidate,
  parseObsidianFrontmatter,
} from "@/lib/knowledge/adapters/obsidian";
import {
  GraphifyManifestSchema,
  buildGraphifyCandidate,
} from "@/lib/knowledge/adapters/graphify";
import { evaluateKnowledgeCandidate } from "@/lib/knowledge/candidate";

describe("knowledge source adapters", () => {
  it("parses NotebookLM claims and citations into evidence-backed candidates", () => {
    const [item] = parseNotebookLmMarkdown(
      "# Findings\n- Brake conversion improved after quote follow-up. [Source: sales-report.md]",
      "research-packs/test/notebooklm-output/findings.md",
    );
    const candidate = buildNotebookLmCandidate({
      ...item,
      slug: "test",
      domain: "business",
      verificationScore: 0.91,
      bestMatchChunk: "Brake conversion improved after quote follow-up.",
    });

    expect(candidate.kind).toBe("fact");
    expect(candidate.evidence.map((item) => item.type)).toEqual([
      "citation",
      "source_document",
      "semantic_match",
    ]);
    expect(evaluateKnowledgeCandidate(candidate).decision).toBe("accept");
  });

  it("keeps unsupported NotebookLM claims in review", () => {
    const candidate = buildNotebookLmCandidate({
      text: "A competitor may have changed its pricing.",
      category: BRAIN_CATEGORIES.RESEARCH_CLAIM,
      sourceFile: "unverified.md",
      slug: "test",
      domain: "business",
      verificationScore: 0,
    });
    expect(evaluateKnowledgeCandidate(candidate).decision).toBe("review_required");
  });

  it("treats explicit Obsidian frontmatter as operator-authored evidence", () => {
    const parsed = parseObsidianFrontmatter(
      "---\ncategory: business\ntitle: Shop rule\ntype: rule\n---\nAlways confirm parts before promising pickup.",
    );
    const candidate = buildObsidianCandidate({
      content: parsed.content,
      title: "Shop rule",
      category: "business",
      sourceId: "obsidian_rules.md",
      sourceUri: "rules.md",
      metadata: parsed.metadata,
      categoryWasExplicit: true,
      sourceName: "Obsidian Vault",
      modifiedAt: new Date("2026-07-11T12:00:00.000Z"),
    });

    expect(candidate.kind).toBe("rule");
    expect(candidate.evidence[0]?.type).toBe("operator_authored");
    expect(evaluateKnowledgeCandidate(candidate).decision).toBe("accept");
  });

  it("queues filename-inferred Obsidian knowledge for review", () => {
    const candidate = buildObsidianCandidate({
      content: "Revenue rose after the new follow-up process.",
      title: "Business note",
      category: "business",
      sourceId: "obsidian_business-note.md",
      sourceUri: "business-note.md",
      metadata: {},
      categoryWasExplicit: false,
      sourceName: "Obsidian Vault",
      modifiedAt: new Date("2026-07-11T12:00:00.000Z"),
    });

    const gate = evaluateKnowledgeCandidate(candidate);
    expect(candidate.evidence[0]?.type).toBe("source_document");
    expect(gate.decision).toBe("review_required");
    expect(gate.reasons).toContain("confidence_below_acceptance");
  });

  it("always queues Graphify snapshot findings for review", () => {
    const manifest = GraphifyManifestSchema.parse({
      schemaVersion: 1,
      generatedAt: "2026-07-11T12:00:00.000Z",
      sourceCommit: "abcdef1",
      generator: "graphify",
      reportPath: "graphify-out/GRAPH_REPORT.md",
      findings: [{
        id: "auth-hub",
        summary: "The authentication module is a high-degree dependency hub.",
        kind: "dependency_hub",
        confidence: 0.95,
        files: ["apps/statenour/lib/auth.ts"],
        evidence: ["GRAPH_REPORT.md#authentication"],
        contradictionRefs: [],
      }],
    });
    const candidate = buildGraphifyCandidate(manifest, manifest.findings[0]);
    const gate = evaluateKnowledgeCandidate(candidate);
    expect(gate.decision).toBe("review_required");
    expect(gate.reasons).toContain("graph_snapshot_requires_review");
  });
});
