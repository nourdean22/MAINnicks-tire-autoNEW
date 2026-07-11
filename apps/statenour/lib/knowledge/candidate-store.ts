import type { BrainMemory } from "@prisma/client";
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function candidateKey(candidate: KnowledgeCandidate): string {
  return `candidate_${candidate.contentHash.slice(0, 24)}`;
}

export async function persistKnowledgeCandidate(
  candidate: KnowledgeCandidate,
  options: PersistCandidateOptions = {},
): Promise<PersistCandidateResult> {
  const gate = evaluateKnowledgeCandidate(candidate);
  if (gate.decision === "reject") {
    return { gate, memory: null, queuedForReview: false };
  }

  const category = options.category ?? BRAIN_CATEGORIES.RESEARCH_CLAIM;
  if (!isKnownCategory(category)) {
    throw new ServiceError(`Unknown BrainMemory category: ${category}`, 400);
  }

  if (gate.decision === "review_required" && options.allowReviewQueue === false) {
    return { gate, memory: null, queuedForReview: false };
  }

  const metadata = {
    ...candidate.metadata,
    ...knowledgeCandidateMetadata(candidate, gate),
    persistedAt: new Date().toISOString(),
  };

  const memory = await brainMemory.remember(
    category,
    options.key?.trim() || candidateKey(candidate),
    candidate.content,
    `knowledge_candidate:${candidate.sourceType}`,
    metadata,
  );

  return {
    gate,
    memory,
    queuedForReview: gate.decision === "review_required",
  };
}

export async function listPendingKnowledgeCandidates(limit = 20): Promise<{
  total: number;
  items: PendingKnowledgeCandidate[];
}> {
  const take = Math.max(1, Math.min(100, Math.trunc(limit)));
  const where = {
    deletedAt: null,
    metadata: {
      path: ["gateDecision"],
      equals: "review_required",
    },
  } as const;

  const [total, rows] = await Promise.all([
    prisma.brainMemory.count({ where }),
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
): Promise<{ id: string; decision: "accept" | "reject" }> {
  const memory = await prisma.brainMemory.findUnique({ where: { id: memoryId } });
  if (!memory || memory.deletedAt) throw new ServiceError("Knowledge candidate not found.", 404);

  const metadata = asRecord(memory.metadata);
  const now = new Date().toISOString();

  if (decision === "accept") {
    const kind = typeof metadata.kind === "string" ? metadata.kind : "observation";
    await prisma.brainMemory.update({
      where: { id: memoryId },
      data: {
        confidence: 1,
        expiresAt: null,
        source: "manual",
        lastSeen: new Date(),
        metadata: {
          ...metadata,
          gateDecision: "accept",
          gateReasons: [],
          canonicalEligible: kind !== "action" && kind !== "question",
          reviewedAt: now,
          reviewedBy: "user",
        } as any,
      },
    });
  } else {
    await prisma.brainMemory.update({
      where: { id: memoryId },
      data: {
        metadata: {
          ...metadata,
          gateDecision: "reject",
          canonicalEligible: false,
          actionEligible: false,
          reviewedAt: now,
          reviewedBy: "user",
        } as any,
      },
    });
    await brainMemory.forget(memoryId);
  }

  return { id: memoryId, decision };
}
