import type { BrainMemory, Prisma } from "@prisma/client";
import { BRAIN_CATEGORIES, isKnownCategory } from "@/lib/brain/categories";
import { brainMemory } from "@/lib/brain/memory-manager";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import {
  evaluateKnowledgeCandidate,
  knowledgeCandidateMetadata,
  type KnowledgeCandidate,
  type KnowledgeGateResult,
} from "@/lib/knowledge/candidate";

const CANDIDATE_RECORD_TYPE = "knowledge_candidate";
const CANDIDATE_STAGING_CATEGORY = BRAIN_CATEGORIES.RESEARCH_PACK;

export interface PersistCandidateOptions {
  category?: string;
  key?: string;
  allowReviewQueue?: boolean;
}

export interface PersistCandidateResult {
  gate: KnowledgeGateResult;
  memory: BrainMemory | null;
  queuedForReview: boolean;
}

export interface PendingKnowledgeCandidate {
  id: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  source: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export type KnowledgeOutcome = "confirmed" | "disproved" | "neutral";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function candidateKey(candidate: KnowledgeCandidate): string {
  return `candidate_${candidate.id.slice(3)}`;
}

function canonicalKey(candidate: KnowledgeCandidate, requestedKey?: string): string {
  return requestedKey?.trim() || `knowledge_${candidate.contentHash.slice(0, 24)}`;
}

function metadataJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isCandidateMetadata(metadata: Record<string, unknown>): boolean {
  return metadata.recordType === CANDIDATE_RECORD_TYPE && typeof metadata.candidateId === "string";
}

async function upsertCandidateAudit(
  candidate: KnowledgeCandidate,
  gate: KnowledgeGateResult,
  targetCategory: string,
  targetKey: string,
): Promise<BrainMemory> {
  const metadata = {
    ...candidate.metadata,
    ...knowledgeCandidateMetadata(candidate, gate),
    recordType: CANDIDATE_RECORD_TYPE,
    targetCategory,
    targetKey,
    persistedAt: new Date().toISOString(),
  };

  return prisma.brainMemory.upsert({
    where: {
      category_key: {
        category: CANDIDATE_STAGING_CATEGORY,
        key: candidateKey(candidate),
      },
    },
    create: {
      category: CANDIDATE_STAGING_CATEGORY,
      key: candidateKey(candidate),
      content: candidate.content,
      confidence: 0,
      source: `knowledge_candidate:${candidate.sourceType}`,
      expiresAt: null,
      metadata: metadataJson(metadata),
    },
    update: {
      content: candidate.content,
      confidence: 0,
      source: `knowledge_candidate:${candidate.sourceType}`,
      expiresAt: null,
      deletedAt: null,
      lastSeen: new Date(),
      metadata: metadataJson(metadata),
    },
  });
}

export async function persistKnowledgeCandidate(
  candidate: KnowledgeCandidate,
  options: PersistCandidateOptions = {},
): Promise<PersistCandidateResult> {
  const gate = evaluateKnowledgeCandidate(candidate);
  if (gate.decision === "reject") {
    return { gate, memory: null, queuedForReview: false };
  }

  const targetCategory = options.category ?? BRAIN_CATEGORIES.RESEARCH_CLAIM;
  if (!isKnownCategory(targetCategory)) {
    throw new ServiceError(`Unknown BrainMemory category: ${targetCategory}`, 400);
  }
  const targetKey = canonicalKey(candidate, options.key);

  if (gate.decision === "review_required") {
    if (options.allowReviewQueue === false) {
      return { gate, memory: null, queuedForReview: false };
    }
    const staged = await upsertCandidateAudit(candidate, gate, targetCategory, targetKey);
    return { gate, memory: staged, queuedForReview: true };
  }

  if (!gate.canonicalEligible) {
    const audit = await upsertCandidateAudit(candidate, gate, targetCategory, targetKey);
    return { gate, memory: audit, queuedForReview: false };
  }

  const metadata = {
    ...candidate.metadata,
    ...knowledgeCandidateMetadata(candidate, gate),
    recordType: CANDIDATE_RECORD_TYPE,
    targetCategory,
    targetKey,
    persistedAt: new Date().toISOString(),
  };
  const remembered = await brainMemory.remember(
    targetCategory,
    targetKey,
    candidate.content,
    `knowledge_candidate:${candidate.sourceType}`,
    metadata,
  );

  return { gate, memory: remembered, queuedForReview: false };
}

export async function listPendingKnowledgeCandidates(limit = 20): Promise<{
  total: number;
  items: PendingKnowledgeCandidate[];
}> {
  const take = Math.max(1, Math.min(100, Math.trunc(limit)));
  const where: Prisma.BrainMemoryWhereInput = {
    category: CANDIDATE_STAGING_CATEGORY,
    deletedAt: null,
    metadata: {
      path: ["gateDecision"],
      equals: "review_required",
    },
  };

  const [total, rows] = await Promise.all([
    prisma.brainMemory.count({ where }), // `where` above already scopes deletedAt: null
    prisma.brainMemory.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        category: true,
        key: true,
        content: true,
        confidence: true,
        source: true,
        metadata: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    total,
    items: rows.map((row) => ({
      ...row,
      metadata: asRecord(row.metadata),
    })),
  };
}

export async function reviewKnowledgeCandidate(
  memoryId: string,
  decision: "accept" | "reject",
): Promise<{
  id: string;
  candidateMemoryId: string;
  decision: "accept" | "reject";
  canonicalEligible: boolean;
  actionEligible: boolean;
}> {
  const memory = await prisma.brainMemory.findUnique({ where: { id: memoryId } });
  if (!memory || memory.deletedAt) throw new ServiceError("Knowledge candidate not found.", 404);

  const metadata = asRecord(memory.metadata);
  if (
    memory.category !== CANDIDATE_STAGING_CATEGORY ||
    !isCandidateMetadata(metadata) ||
    metadata.gateDecision !== "review_required"
  ) {
    throw new ServiceError("This memory is not a pending knowledge candidate.", 409);
  }

  const now = new Date().toISOString();
  const kind = typeof metadata.kind === "string" ? metadata.kind : "observation";
  const canonicalEligible = kind !== "action" && kind !== "question";
  const actionEligible = kind === "action";

  if (decision === "reject") {
    await prisma.brainMemory.update({
      where: { id: memoryId },
      data: {
        metadata: metadataJson({
          ...metadata,
          gateDecision: "reject",
          canonicalEligible: false,
          actionEligible: false,
          reviewedAt: now,
          reviewedBy: "user",
        }),
      },
    });
    await brainMemory.forget(memoryId);
    return {
      id: memoryId,
      candidateMemoryId: memoryId,
      decision,
      canonicalEligible: false,
      actionEligible: false,
    };
  }

  if (!canonicalEligible) {
    await prisma.brainMemory.update({
      where: { id: memoryId },
      data: {
        confidence: 0,
        expiresAt: null,
        source: "manual",
        lastSeen: new Date(),
        metadata: metadataJson({
          ...metadata,
          gateDecision: "accept",
          gateReasons: [],
          canonicalEligible: false,
          actionEligible,
          reviewedAt: now,
          reviewedBy: "user",
          outcomeStatus: actionEligible ? "pending" : "not_applicable",
        }),
      },
    });
    return {
      id: memoryId,
      candidateMemoryId: memoryId,
      decision,
      canonicalEligible: false,
      actionEligible,
    };
  }

  const targetCategory = typeof metadata.targetCategory === "string"
    ? metadata.targetCategory
    : BRAIN_CATEGORIES.RESEARCH_CLAIM;
  const targetKey = typeof metadata.targetKey === "string"
    ? metadata.targetKey
    : `knowledge_${String(metadata.contentHash ?? memory.id).slice(0, 24)}`;
  if (!isKnownCategory(targetCategory)) {
    throw new ServiceError(`Candidate target category is invalid: ${targetCategory}`, 409);
  }

  const promotedMetadata = {
    ...metadata,
    gateDecision: "accept",
    gateReasons: [],
    canonicalEligible: true,
    actionEligible: false,
    reviewedAt: now,
    reviewedBy: "user",
    promotedFromCandidateMemoryId: memoryId,
  };
  const promoted = await brainMemory.remember(
    targetCategory,
    targetKey,
    memory.content,
    "manual",
    promotedMetadata,
  );
  await prisma.brainMemory.update({
    where: { id: promoted.id },
    data: {
      confidence: 1,
      expiresAt: null,
      source: "manual",
      lastSeen: new Date(),
      metadata: metadataJson({
        ...asRecord(promoted.metadata),
        ...promotedMetadata,
      }),
    },
  });
  await prisma.brainMemory.update({
    where: { id: memoryId },
    data: {
      metadata: metadataJson({
        ...metadata,
        gateDecision: "accept",
        canonicalEligible: true,
        actionEligible: false,
        reviewedAt: now,
        reviewedBy: "user",
        promotedToMemoryId: promoted.id,
      }),
    },
  });
  await brainMemory.forget(memoryId);

  return {
    id: promoted.id,
    candidateMemoryId: memoryId,
    decision,
    canonicalEligible: true,
    actionEligible: false,
  };
}

export async function recordKnowledgeCandidateOutcome(
  memoryId: string,
  outcome: KnowledgeOutcome,
  evidence?: string,
): Promise<{ id: string; outcome: KnowledgeOutcome }> {
  const memory = await prisma.brainMemory.findUnique({ where: { id: memoryId } });
  if (!memory || memory.deletedAt) throw new ServiceError("Knowledge candidate not found.", 404);
  const metadata = asRecord(memory.metadata);
  if (!isCandidateMetadata(metadata) || metadata.gateDecision !== "accept") {
    throw new ServiceError("Only accepted knowledge candidates can receive outcomes.", 409);
  }

  const confidence = outcome === "disproved"
    ? Math.max(0, memory.confidence - 0.2)
    : memory.confidence;
  await prisma.brainMemory.update({
    where: { id: memoryId },
    data: {
      confidence,
      lastSeen: new Date(),
      metadata: metadataJson({
        ...metadata,
        actionEligible: metadata.kind === "action" ? false : metadata.actionEligible,
        outcomeStatus: outcome,
        outcomeEvidence: evidence?.trim() || undefined,
        outcomeRecordedAt: new Date().toISOString(),
        outcomeRecordedBy: "user",
      }),
    },
  });

  return { id: memoryId, outcome };
}
