/**
 * Vector embedding orphan cleanup · v10.0.192
 *
 * Probe (scripts/probe-embedding-orphans.mjs) revealed the
 * vector_embeddings table was 69% dead weight: 5,655 of 8,158 rows
 * referenced soft-deleted or hard-missing source rows. The cosine-
 * similarity search path scans every embedding regardless of source
 * liveness, so dead rows quietly inflate query latency for /brain
 * recall, semantic search, and the conversation→mission linker.
 *
 * What "orphan" means per sourceType:
 *   · brain_memory       → row missing OR brain_memories.deleted_at IS NOT NULL
 *   · chat_message       → row missing (chat_messages has no soft-delete column)
 *   · chat_conversation  → row missing OR chat_conversations.archived_at IS NOT NULL
 *   · mission            → row missing OR Mission.deleted_at IS NOT NULL
 *   · brain_dump         → row missing (brain_dumps has soft-delete pattern)
 *   · strategic_law      → row missing
 *   · reflection         → row missing
 *   · photo              → row missing
 *
 * Hard-delete (not soft-delete) the orphan vector_embeddings rows.
 * They reference sources that are gone or archived; keeping the
 * embedding adds zero value (can't recover the source from a
 * 1024-dim vector).
 *
 * Idempotent: re-running on a clean table returns 0 deleted.
 * Safe: each sourceType is its own DELETE so a future schema change
 * to one source table doesn't fail the others.
 */
import { prisma as defaultPrisma } from "@/lib/prisma";

type PrismaLike = typeof defaultPrisma;

export interface EmbeddingCleanupOptions {
  prisma?: PrismaLike;
  dryRun?: boolean;
}

export interface EmbeddingCleanupReport {
  before: Record<string, number>;
  deleted: Record<string, number>;
  after: Record<string, number>;
  totalDeleted: number;
}

interface OrphanQuery {
  sourceType: string;
  /** Raw SQL WHERE clause for the source liveness check; must use
   * `live` as the join alias for the source table. */
  liveCheck: string;
  joinTable: string;
  joinAlias: string;
  joinColumn?: string; // default "id"
}

const ORPHAN_QUERIES: OrphanQuery[] = [
  {
    sourceType: "brain_memory",
    joinTable: "brain_memories",
    joinAlias: "live",
    liveCheck: 'live.id IS NULL OR live.deleted_at IS NOT NULL',
  },
  {
    sourceType: "chat_message",
    joinTable: "chat_messages",
    joinAlias: "live",
    liveCheck: 'live.id IS NULL',
  },
  {
    sourceType: "chat_conversation",
    joinTable: "chat_conversations",
    joinAlias: "live",
    liveCheck: 'live.id IS NULL OR live.archived_at IS NOT NULL',
  },
  {
    sourceType: "mission",
    joinTable: '"Mission"',
    joinAlias: "live",
    liveCheck: 'live.id IS NULL OR live.deleted_at IS NOT NULL',
  },
];

async function countBySourceType(
  prisma: PrismaLike,
): Promise<Record<string, number>> {
  const rows = await prisma.vectorEmbedding.groupBy({
    by: ["sourceType"],
    _count: { id: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.sourceType ?? "(null)"] = r._count.id;
  }
  return out;
}

async function deleteOrphansForType(
  prisma: PrismaLike,
  q: OrphanQuery,
  dryRun: boolean,
): Promise<number> {
  if (dryRun) {
    const result = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
      SELECT COUNT(*)::int AS n
      FROM vector_embeddings ve
      LEFT JOIN ${q.joinTable} ${q.joinAlias} ON ${q.joinAlias}.id = ve."sourceId"
      WHERE ve."sourceType" = '${q.sourceType}'
        AND (${q.liveCheck})
    `);
    return result[0]?.n ?? 0;
  }
  // v10.0.192 · use a CTE-backed DELETE so we get the affected row
  // count back. The LEFT JOIN inside USING wasn't reliable across
  // Postgres versions in raw $executeRaw.
  const result = await prisma.$executeRaw`
    DELETE FROM vector_embeddings ve
    WHERE ve."sourceType" = '${q.sourceType}'
      AND ve."sourceId" IN (
        SELECT ve2."sourceId"
        FROM vector_embeddings ve2
        LEFT JOIN ${q.joinTable} ${q.joinAlias} ON ${q.joinAlias}.id = ve2."sourceId"
        WHERE ve2."sourceType" = '${q.sourceType}'
          AND (${q.liveCheck})
      )
  `;
  return Number(result);
}

export async function runEmbeddingCleanup(
  options: EmbeddingCleanupOptions = {},
): Promise<EmbeddingCleanupReport> {
  const prisma = options.prisma ?? defaultPrisma;
  const dryRun = options.dryRun ?? false;

  const before = await countBySourceType(prisma);
  const deleted: Record<string, number> = {};

  for (const q of ORPHAN_QUERIES) {
    const n = await deleteOrphansForType(prisma, q, dryRun);
    deleted[q.sourceType] = n;
  }

  const after = dryRun ? before : await countBySourceType(prisma);
  const totalDeleted = Object.values(deleted).reduce((s, n) => s + n, 0);

  return { before, deleted, after, totalDeleted };
}
