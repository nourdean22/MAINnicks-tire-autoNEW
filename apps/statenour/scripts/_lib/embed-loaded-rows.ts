/**
 * Embed the brain_memory rows a loader just wrote (brain backfill W2, 2026-10-30).
 *
 * The wisdom loaders wrote rows with no embedding and left them to the embed-backfill cron, which takes 100
 * rows a run, twice a day, highest confidence first: the 300 Gracian rows loaded 2026-10-30 03:19Z still had
 * 0 vectors at 12:10Z, and a wisdom row with no vector can never enter a wisdom slot. Same text as the cron
 * (brainMemoryEmbedText), so the cron's stale lane never re-embeds these.
 *
 * Counts by the vector rows that exist afterwards: storeGenericEmbedding swallows provider failures, so a
 * returned call proves nothing. A gap is reported, and scripts/drain-brain-embeddings.ts --apply closes it.
 */
type Row = { id: string; category: string; key: string; content: string };

export interface EmbedDeps {
  prisma: {
    brainMemory: { findMany(args: { where: { id: { in: string[] }; deletedAt: null }; select: Record<string, true> }): Promise<Row[]> };
    vectorEmbedding: { count(args: { where: { sourceType: string; sourceId: { in: string[] } } }): Promise<number> };
  };
  store: (sourceType: "brain_memory", sourceId: string, content: string) => Promise<void>;
}

async function defaultDeps(): Promise<EmbedDeps> {
  const { prisma } = await import("@/lib/prisma");
  const { storeGenericEmbedding } = await import("@/lib/brain/embedding-utils");
  return { prisma: prisma as unknown as EmbedDeps["prisma"], store: storeGenericEmbedding };
}

export async function embedLoadedRows(ids: string[], deps?: EmbedDeps): Promise<{ landed: number; total: number }> {
  if (ids.length === 0) return { landed: 0, total: 0 };
  const { prisma, store } = deps ?? (await defaultDeps());
  const { brainMemoryEmbedText } = await import("@/lib/brain/embedding-utils");
  const rows = await prisma.brainMemory.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, category: true, key: true, content: true },
  });
  for (const r of rows) await store("brain_memory", r.id, brainMemoryEmbedText(r));
  const landed = await prisma.vectorEmbedding.count({ where: { sourceType: "brain_memory", sourceId: { in: ids } } });
  return { landed, total: ids.length };
}

/** One line for a loader's summary. */
export function embedSummary({ landed, total }: { landed: number; total: number }): string {
  return landed === total
    ? `embedded ${landed}/${total}`
    : `embedded ${landed}/${total} - ${total - landed} missing: run scripts/drain-brain-embeddings.ts --apply`;
}
