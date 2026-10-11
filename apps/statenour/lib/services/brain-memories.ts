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

import { randomUUID } from "node:crypto";
import { brainMemory } from "@/lib/brain/memory-manager";
import { admitMemory } from "@/lib/brain/memory-admission";
import { dropEmbeddingsForMemories } from "@/lib/brain/memory-tombstone";
import { supersedeMemoryVersion } from "@/lib/brain/memory-transaction-time";
import { softDelete } from "@/lib/db/soft-delete";
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

/** The memory is gone or no longer the current version (forgotten, or already corrected). */
export class MemoryNotCurrentError extends Error {
  constructor(id: string) {
    super(`memory ${id} is not the current version`);
    this.name = "MemoryNotCurrentError";
  }
}

/**
 * 05-M12: forget ONE memory by id: the soft-delete tombstone (restorable,
 * audited) plus the vector_embeddings copy, which carries the text too.
 */
export async function forgetMemoryById(
  id: string,
): Promise<{ deleted: boolean; embeddingDropped?: boolean; searchCopyRemaining?: number | null }> {
  const res = await softDelete("brainMemory", { id });
  if (!res.ok) return { deleted: false };
  // The noop path drops too (idempotent), so a retry after a failed drop still removes the text copy.
  await dropEmbeddingsForMemories([id], "brain.forgetMemory");
  // The drop swallows its own failure: read back that the copy is gone; a failed read is unconfirmed, not dropped.
  // null = the read failed: unknown, never shown as zero (empty-vs-error).
  const searchCopyRemaining = await prisma.vectorEmbedding
    .count({ where: { sourceType: "brain_memory", sourceId: id } })
    .catch(() => null);
  return { deleted: !res.noop, embeddingDropped: searchCopyRemaining === 0, searchCopyRemaining };
}

/**
 * 05-M12: correct ONE memory: a new operator-stated row, then the old row is
 * superseded. supersedeMemoryVersion locks the old row only while it is still
 * live and unsuperseded, which is the compare-and-swap on the version read
 * here; the loser of a race removes its own new row and reports not-current.
 */
export async function correctMemory(id: string, content: string): Promise<{ id: string }> {
  const old = await prisma.brainMemory.findFirst({
    where: { id, deletedAt: null, supersededById: null },
    select: { id: true, category: true, key: true },
  });
  if (!old) throw new MemoryNotCurrentError(id);

  const admitted = await admitMemory({
    category: old.category,
    // (category, key) is unique: reusing the key would reinforce the old row.
    key: `${old.key}#fix-${randomUUID().slice(0, 8)}`,
    content: content.trim(),
    source: "manual",
    memoryKind: "semantic",
    extractionMethod: "explicit_save",
    trustTier: "OPERATOR",
    evidenceRefs: [`brain_memory:${old.id}`],
  });
  let swapped: boolean;
  try {
    // Operator-stated: no 24h probation, the same as a manual confirm.
    await brainMemory.confirm(admitted.id);
    const swap = await supersedeMemoryVersion({
      losingMemoryId: old.id,
      winningMemoryId: admitted.id,
      effectiveUntil: new Date(),
    });
    swapped = swap.count === 1;
  } catch (err) {
    // Never leave the new row live beside the old one.
    await forgetMemoryById(admitted.id);
    throw err;
  }
  if (!swapped) {
    await forgetMemoryById(admitted.id);
    throw new MemoryNotCurrentError(id);
  }
  return { id: admitted.id };
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
