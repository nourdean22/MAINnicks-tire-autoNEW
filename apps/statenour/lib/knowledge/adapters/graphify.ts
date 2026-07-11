import { z } from "zod";
import { buildKnowledgeCandidate, type KnowledgeCandidate } from "@/lib/knowledge/candidate";

export const GraphifyFindingSchema = z.object({
  id: z.string().min(1).max(256),
  summary: z.string().min(12).max(8_000),
  kind: z.enum(["dependency_hub", "cycle", "orphan", "boundary", "risk", "change"]).default("change"),
  confidence: z.number().min(0).max(1),
  files: z.array(z.string().min(1).max(1_000)).min(1).max(50),
  evidence: z.array(z.string().min(1).max(2_000)).min(1).max(20),
  contradictionRefs: z.array(z.string().min(1).max(512)).max(20).default([]),
});

export const GraphifyManifestSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  sourceCommit: z.string().regex(/^[a-f0-9]{7,40}$/i),
  generator: z.string().min(1).max(256),
  reportPath: z.string().min(1).max(1_000),
  nodeCount: z.number().int().nonnegative().optional(),
  edgeCount: z.number().int().nonnegative().optional(),
  findings: z.array(GraphifyFindingSchema).max(200),
});

export type GraphifyManifest = z.infer<typeof GraphifyManifestSchema>;
export type GraphifyFinding = z.infer<typeof GraphifyFindingSchema>;

export function buildGraphifyCandidate(
  manifest: GraphifyManifest,
  finding: GraphifyFinding,
): KnowledgeCandidate {
  return buildKnowledgeCandidate({
    content: finding.summary,
    kind: "inference",
    sourceType: "graphify",
    sourceId: `${manifest.sourceCommit}:${finding.id}`,
    sourceUri: manifest.reportPath,
    observedAt: manifest.generatedAt,
    generatedBy: manifest.generator,
    confidence: finding.confidence,
    riskLevel: finding.kind === "risk" ? "medium" : "low",
    evidence: [
      { type: "source_document", value: manifest.reportPath },
      ...finding.evidence.map((value) => ({ type: "citation" as const, value })),
    ],
    contradictionRefs: finding.contradictionRefs,
    metadata: {
      graphifyKind: finding.kind,
      sourceCommit: manifest.sourceCommit,
      files: finding.files,
      nodeCount: manifest.nodeCount,
      edgeCount: manifest.edgeCount,
    },
  });
}
