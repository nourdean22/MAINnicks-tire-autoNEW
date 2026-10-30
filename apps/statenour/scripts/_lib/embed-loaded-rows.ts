/**
 * Embed the brain_memory rows a loader just wrote (brain backfill W2, 2026-10-30).
 *
 * The wisdom loaders wrote rows with no embedding and left them to the embed-backfill cron, which takes 100
 * rows a run, twice a day, highest confidence first: the 300 Gracian rows loaded 2026-10-30 03:19Z still had
 * 0 vectors at 12:10Z, and a wisdom row with no vector can never enter a wisdom slot. Same text as the cron
 * (brainMemoryEmbedText), so the cron's stale lane never re-embeds these.
 *
 * Counts a row only when its native pgvector column (embedding_vec_1536, the one the recall KNN reads)
 * exists AND the record holds the text just written
 * (Codex P1 on PR 3380): storeGenericEmbedding swallows provider failures and does not await the native
 * write, so a returned call, or an old record from before the update, proves nothing. Polls briefly for the
 * un-awaited native write. A gap is reported; scripts/drain-brain-embeddings.ts --apply closes it.
 */
type Row = { id: string; category: string; key: string; content: string };

export interface EmbedDeps {
  prisma: {
    brainMemory: { findMany(args: { where: { id: { in: string[] }; deletedAt: null }; select: Record<string, true> }): Promise<Row[]> };
    $queryRawUnsafe(sql: string, ...params: unknown[]): Promise<unknown>;
  };
  store: (sourceType: "brain_memory", sourceId: string, content: string) => Promise<void>;
  /** Wait between checks for the un-awaited native write; tests pass 0. */
  pollMs?: number;
}

/** Fresh and searchable: the native vector exists and the record's text is the text this load wrote. */
export const LANDED_SQL = `
SELECT COUNT(*)::int AS n
  FROM vector_embeddings v
  JOIN unnest($1::text[], $2::text[]) AS w(id, text) ON v."sourceId" = w.id
 WHERE v."sourceType" = 'brain_memory' AND v.embedding_vec_1536 IS NOT NULL AND v.content = w.text`;

const POLLS = 5;

async function defaultDeps(): Promise<EmbedDeps> {
  const { prisma } = await import("@/lib/prisma");
  const { storeGenericEmbedding } = await import("@/lib/brain/embedding-utils");
  return { prisma: prisma as unknown as EmbedDeps["prisma"], store: storeGenericEmbedding };
}

export async function embedLoadedRows(ids: string[], deps?: EmbedDeps): Promise<{ landed: number; total: number }> {
  if (ids.length === 0) return { landed: 0, total: 0 };
  const { prisma, store, pollMs = 1000 } = deps ?? (await defaultDeps());
  const { brainMemoryEmbedText } = await import("@/lib/brain/embedding-utils");
  const rows = await prisma.brainMemory.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, category: true, key: true, content: true },
  });
  for (const r of rows) await store("brain_memory", r.id, brainMemoryEmbedText(r));

  const texts = rows.map((r) => brainMemoryEmbedText(r));
  let landed = 0;
  for (let i = 0; i < POLLS; i++) {
    const res = (await prisma.$queryRawUnsafe(LANDED_SQL, rows.map((r) => r.id), texts)) as Array<{ n: number }>;
    landed = Number(res[0]?.n ?? 0);
    if (landed >= rows.length) break;
    if (pollMs > 0) await new Promise((r) => setTimeout(r, pollMs));
  }
  return { landed, total: ids.length };
}

/** One line for a loader's summary. */
export function embedSummary({ landed, total }: { landed: number; total: number }): string {
  return landed === total
    ? `embedded ${landed}/${total}`
    : `embedded ${landed}/${total} - ${total - landed} missing: run scripts/drain-brain-embeddings.ts --apply`;
}
