/**
 * lib/services/brain-memories.ts · actions-surface REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/actions/* slice).
 *
 * Thin shared wrappers over `brainMemory.{recall,remember,forget}` so
 * the legacy /api/brain/memories REST route AND the new `brain.memories`
 * / `brain.recordMemory` / `brain.forgetMemoryByKey` tRPC procedures
 * call the SAME functions · drift between consumers structurally
 * impossible.
 *
 * The `BrainMemory` Prisma row carries a `metadata` Json column. Every
 * function here projects rows to the explicit, flat `BrainMemoryRow`
 * interface — `metadata` typed as `unknown`, Date fields stringified —
 * so the recursive Prisma `JsonValue` type never reaches the AppRouter.
 * That is the TS2589 firewall.
 *
 * `forgetMemoryByKey` is genuinely NEW behaviour. The KommandoLearn
 * spaced-review "Got it ✓" button issued `DELETE /api/brain/memories
 * ?key=…`, but the REST route never had a DELETE handler — the call
 * always 404'd and the error was silently swallowed (the review row
 * was never actually cleared; only the next interval's row carried it).
 * The typed migration replaces that dead call with a real lookup-by-key
 * soft-delete, which is what the UI promised all along.
 */

import { brainMemory } from "@/lib/brain/memory-manager";
import { prisma } from "@/lib/prisma";

/**
 * A flat, shallow projection of a BrainMemory row. The `metadata` Json
 * column is `unknown` and timestamps are ISO strings — the TS2589
 * firewall. Consumers cast to their own local row type regardless.
 */
export interface BrainMemoryRow {
  id: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  source: string;
  seenCount: number;
  /** BrainMemory.metadata · `unknown` to keep the AppRouter shallow. */
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  lastSeen: string;
  expiresAt: string | null;
}

/** Filters for {@link listMemories} · mirror the legacy GET query params. */
export interface ListMemoriesInput {
  category?: string;
  query?: string;
  minConfidence?: number;
  limit?: number;
}

/**
 * Recall BrainMemory rows by category + optional search query, sorted
 * by confidence. The REST route and the `brain.memories` procedure both
 * call this. Returns `{ memories }` so the legacy `{ data: { memories }}`
 * unwrap path stays intact.
 */
export async function listMemories(
  input: ListMemoriesInput = {},
): Promise<{ memories: BrainMemoryRow[] }> {
  const rows = await brainMemory.recall(input.category, {
    query: input.query,
    minConfidence: input.minConfidence ?? 0,
    limit: input.limit ?? 50,
  });
  return { memories: rows.map(toRow) };
}

/** Payload for {@link recordMemory} · mirrors the legacy POST body. */
export interface RecordMemoryInput {
  category: string;
  key: string;
  content: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Persist (or reinforce) one BrainMemory row. The REST route and the
 * `brain.recordMemory` procedure both call this · `brainMemory.remember`
 * upserts by (category, key) so re-recording the same key reinforces
 * rather than duplicating.
 */
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

/**
 * Soft-delete the most-recent BrainMemory row matching a key. Used by
 * the KommandoLearn spaced-review "Got it ✓" affordance. Idempotent —
 * a missing key resolves to `{ ok: true, deleted: false }` (the legacy
 * DELETE call 404'd and was swallowed · this preserves the no-throw
 * contract while actually clearing the row when it exists).
 */
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

/** Project a Prisma BrainMemory row to the flat {@link BrainMemoryRow}. */
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
    metadata: r.metadata as unknown,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    lastSeen: r.lastSeen.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
  };
}
