import { createHash } from "node:crypto";
import { z } from "zod";

export const KNOWLEDGE_SOURCE_TYPES = [
  "obsidian",
  "notebooklm",
  "graphify",
  "web",
  "task_outcome",
  "manual",
  "system",
] as const;

export const KNOWLEDGE_KINDS = [
  "fact",
  "observation",
  "inference",
  "contradiction",
  "action",
  "question",
  "rule",
] as const;

export const KNOWLEDGE_RISK_LEVELS = ["low", "medium", "high"] as const;

export const KNOWLEDGE_EVIDENCE_TYPES = [
  "citation",
  "source_document",
  "semantic_match",
  "operator_authored",
  "operator_confirmation",
  "system_receipt",
] as const;

export const KnowledgeEvidenceSchema = z.object({
  type: z.enum(KNOWLEDGE_EVIDENCE_TYPES),
  value: z.string().min(1).max(2_000),
  score: z.number().min(0).max(1).optional(),
});

export const KnowledgeCandidateSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  kind: z.enum(KNOWLEDGE_KINDS),
  sourceType: z.enum(KNOWLEDGE_SOURCE_TYPES),
  sourceId: z.string().min(1).max(512),
  sourceUri: z.string().min(1).max(2_000).optional(),
  observedAt: z.string().datetime(),
  generatedBy: z.string().min(1).max(256),
  confidence: z.number().min(0).max(1),
  riskLevel: z.enum(KNOWLEDGE_RISK_LEVELS),
  evidence: z.array(KnowledgeEvidenceSchema).max(20),
  contradictionRefs: z.array(z.string().min(1).max(512)).max(20),
  metadata: z.record(z.string(), z.unknown()),
});

export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];
export type KnowledgeRiskLevel = (typeof KNOWLEDGE_RISK_LEVELS)[number];
export type KnowledgeEvidence = z.infer<typeof KnowledgeEvidenceSchema>;
export type KnowledgeCandidate = z.infer<typeof KnowledgeCandidateSchema>;

export type KnowledgeGateDecision = "accept" | "review_required" | "reject";

export interface BuildKnowledgeCandidateInput {
  content: string;
  kind: KnowledgeKind;
  sourceType: KnowledgeSourceType;
  sourceId: string;
  sourceUri?: string;
  observedAt?: string | Date;
  generatedBy: string;
  confidence: number;
  riskLevel?: KnowledgeRiskLevel;
  evidence?: KnowledgeEvidence[];
  contradictionRefs?: string[];
  metadata?: Record<string, unknown>;
}

export interface KnowledgeGatePolicy {
  acceptConfidence?: number;
  minimumConfidence?: number;
  requireEvidence?: boolean;
}

export interface KnowledgeGateResult {
  decision: KnowledgeGateDecision;
  reasons: string[];
  canonicalEligible: boolean;
  actionEligible: boolean;
  effectiveConfidence: number;
}

const DEFAULT_POLICY: Required<KnowledgeGatePolicy> = {
  acceptConfidence: 0.8,
  minimumConfidence: 0.25,
  requireEvidence: true,
};

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.round(value * 1_000) / 1_000));
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

function toIso(value: string | Date | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("Knowledge candidate observedAt is invalid.");
  return date.toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildKnowledgeCandidate(input: BuildKnowledgeCandidateInput): KnowledgeCandidate {
  const content = normalizeContent(input.content);
  const contentHash = sha256(content);
  const identityHash = sha256(`${input.sourceType}\u0000${input.sourceId}\u0000${contentHash}`);

  return KnowledgeCandidateSchema.parse({
    id: `kc_${identityHash.slice(0, 24)}`,
    content,
    contentHash,
    kind: input.kind,
    sourceType: input.sourceType,
    sourceId: input.sourceId.trim(),
    sourceUri: input.sourceUri?.trim() || undefined,
    observedAt: toIso(input.observedAt),
    generatedBy: input.generatedBy.trim(),
    confidence: clampConfidence(input.confidence),
    riskLevel: input.riskLevel ?? "low",
    evidence: input.evidence ?? [],
    contradictionRefs: input.contradictionRefs ?? [],
    metadata: input.metadata ?? {},
  });
}

export function evaluateKnowledgeCandidate(
  candidate: KnowledgeCandidate,
  policy: KnowledgeGatePolicy = {},
): KnowledgeGateResult {
  const parsed = KnowledgeCandidateSchema.parse(candidate);
  const resolved = { ...DEFAULT_POLICY, ...policy };
  const reasons: string[] = [];
  const operatorConfirmed = parsed.evidence.some((item) => item.type === "operator_confirmation");

  if (parsed.content.length < 12) reasons.push("content_too_short");
  if (parsed.confidence < resolved.minimumConfidence) reasons.push("confidence_below_minimum");

  if (reasons.length > 0) {
    return {
      decision: "reject",
      reasons,
      canonicalEligible: false,
      actionEligible: false,
      effectiveConfidence: parsed.confidence,
    };
  }

  if (resolved.requireEvidence && parsed.evidence.length === 0) reasons.push("evidence_required");
  if (parsed.confidence < resolved.acceptConfidence) reasons.push("confidence_below_acceptance");
  if (parsed.riskLevel === "high") reasons.push("high_risk_requires_review");
  if (parsed.kind === "contradiction") reasons.push("contradiction_requires_resolution");
  if (parsed.contradictionRefs.length > 0) reasons.push("known_contradiction");
  if (parsed.kind === "action" && !operatorConfirmed) reasons.push("action_requires_operator_confirmation");
  if (parsed.sourceType === "graphify") reasons.push("graph_snapshot_requires_review");

  const decision: KnowledgeGateDecision = reasons.length > 0 ? "review_required" : "accept";
  const canonicalEligible = decision === "accept" && parsed.kind !== "action" && parsed.kind !== "question";
  const actionEligible = decision === "accept" && parsed.kind === "action" && operatorConfirmed;

  return {
    decision,
    reasons,
    canonicalEligible,
    actionEligible,
    effectiveConfidence: parsed.confidence,
  };
}

export function knowledgeCandidateMetadata(
  candidate: KnowledgeCandidate,
  gate: KnowledgeGateResult,
): Record<string, unknown> {
  return {
    candidateId: candidate.id,
    contentHash: candidate.contentHash,
    kind: candidate.kind,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    sourceUri: candidate.sourceUri,
    observedAt: candidate.observedAt,
    generatedBy: candidate.generatedBy,
    confidence: candidate.confidence,
    riskLevel: candidate.riskLevel,
    evidence: candidate.evidence,
    contradictionRefs: candidate.contradictionRefs,
    gateDecision: gate.decision,
    gateReasons: gate.reasons,
    canonicalEligible: gate.canonicalEligible,
    actionEligible: gate.actionEligible,
  };
}
