/**
 * lib/services/brain-memories.ts · actions-surface REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/actions/* slice).
 *
 * Thin shared wrappers over `brainMemory.{recall,remember,forget}` so
 * the legacy /api/brain/memories REST route AND the new `brain.memories`
 * / `brain.recordMemory` / `brain.forgetMemoryByKey` tRPC procedures
 * call the SAME functions · drift between consumers structurally
 * impossible.
 */

import { brainMemory } from "@/lib/brain/memory-manager";
import { prisma } from "@/lib/prisma";

const KNOWLEDGE_CANDIDATE_RECORD_TYPE = "knowledge_candidate";

export interface BrainMemoryRow {
  id: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  source: string;
  seenCount: number;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  lastSeen: string;
  expiresAt: string | null;
}

export interface ListMemoriesInput {
  category?: string;
  query?: string;
  minConfidence?: number;
  limit?: number;
}

function isKnowledgeCandidateRecord(metadata: unknown): boolean {
  return Boolean(
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).recordType === KNOWLEDGE_CANDIDATE_RECORD_TYPE,
  );
}

/**
 * Recall normal BrainMemory rows. Governance staging records are deliberately
 * excluded even when a caller asks for confidence zero; they belong only on
 * the owner review surface until promoted or rejected.
 */
export async function listMemories(
  input: ListMemoriesInput = {},
): Promise<{ memories: BrainMemoryRow[] }> {
  const requestedLimit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 50)));
  const rows = await brainMemory.recall(input.category, {
    query: input.query,
    minConfidence: Math.max(input.minConfidence ?? 0, 0.001),
    limit: Math.min(100, requestedLimit * 2),
  });

  return {
    memories: rows
      .filter((row) => !isKnowledgeCandidateRecord(row.metadata))
      .slice(0, requestedLimit)
      .map(toRow),
  };
}

export interface RecordMemoryInput {
  category: string;
  key: string;
  content: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export async function recordMemory(
  input: RecordMemoryInput,
): Promise<{ memory: BrainMemoryRow }> {
  const created = await brainMemory.remember(
    input.category,
    input.key,
    input.content,
    input.source ?? "manual",
    input.metadata,
  );
  return { memory: toRow(created) };
}

export async function forgetMemoryByKey(
  key: string,
): Promise<{ ok: true; deleted: boolean }> {
  const row = await prisma.brainMemory.findFirst({
    where: { key, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!row) return { ok: true, deleted: false };
  await brainMemory.forget(row.id);
  return { ok: true, deleted: true };
}

function toRow(r: {
  id: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  source: string;
  seenCount: number;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  lastSeen: Date;
  expiresAt: Date | null;
}): BrainMemoryRow {
  return {
    id: r.id,
    category: r.category,
    key: r.key,
    content: r.content,
    confidence: r.confidence,
    source: r.source,
    seenCount: r.seenCount,
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    lastSeen: r.lastSeen.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
  };
}
