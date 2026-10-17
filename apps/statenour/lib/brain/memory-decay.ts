/**
 * lib/brain/memory-decay.ts · 2026-10-17 (brain W5)
 *
 * The ONE definition of which memories nightly decay would touch, shared by
 * the UPDATE (BrainMemoryManager.decay in memory-manager.ts) and the dry-run
 * count (countMemoryDecayCandidates) so the number data-cleanup reports can
 * never describe a different set than the one decay would change.
 *
 * Guards (audit 05-M5): NEVER_HARD_DELETE_CATEGORIES + pinned_user never decay;
 * operator-authored rows (created_by 'user' or source 'manual') never decay;
 * rows on probation (expires_at set) and soft-deleted rows are out of scope;
 * confidence has a floor of 0.1 (the UPDATE applies it; the WHERE only keeps
 * rows still above it).
 *
 * The hard-delete guard is imported lazily: it pulls memory-recall, which
 * reaches back into this area, and the original decay() loaded it the same way.
 */
import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";

/** Days without a sighting (last_seen) before a memory starts to decay. */
export const DECAY_AFTER_DAYS = 30;

/** WHERE clause (no leading keyword) plus its positional parameters: $1 cutoff, $2 exempt categories. */
export async function buildDecayWhere(): Promise<{ where: string; params: [Date, string[]] }> {
  const { NEVER_HARD_DELETE_CATEGORIES } = await import("@/lib/brain/hard-delete-guard");
  const exempt = [...NEVER_HARD_DELETE_CATEGORIES, "pinned_user"];
  return {
    where: `last_seen < $1
          AND confidence > 0.1
          AND expires_at IS NULL
          AND deleted_at IS NULL
          AND category <> ALL($2::text[])
          AND COALESCE(created_by, '') <> 'user'
          AND COALESCE(source, '') <> 'manual'`,
    params: [daysAgo(DECAY_AFTER_DAYS), exempt],
  };
}

/**
 * The categories nightly decay WOULD touch most, with row counts (top 5). One
 * total cannot show what real memories would lose: edges and imports may be most
 * of it. Same where-clause and parameters as the count, SELECT only. Throws on a
 * failed or malformed read; the caller reports that as unknown (null), not [].
 */
export async function countMemoryDecayByCategoryTop5(): Promise<Array<{ category: string; count: number }>> {
  const { where, params } = await buildDecayWhere();
  const rows = await prisma.$queryRawUnsafe<Array<{ category: string; n: number | bigint }>>(
    `SELECT category::text AS category, COUNT(*)::int AS n
       FROM brain_memories
      WHERE ${where}
      GROUP BY category
      ORDER BY n DESC, category
      LIMIT 5`,
    ...params,
  );
  if (!Array.isArray(rows)) throw new Error("decay by-category read returned no rows array");
  return rows.map((r) => {
    const count = Number(r.n);
    if (!Number.isFinite(count) || count < 0) throw new Error("decay by-category count malformed");
    return { category: String(r.category), count };
  });
}

/**
 * How many rows nightly decay WOULD change. SELECT only. Throws when the count
 * cannot be read or is malformed: the caller reports that as unknown, and a
 * failed read must never turn into a quiet 0.
 */
export async function countMemoryDecayCandidates(): Promise<number> {
  const { where, params } = await buildDecayWhere();
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number | bigint }>>(
    `SELECT COUNT(*)::int AS n FROM brain_memories WHERE ${where}`,
    ...params,
  );
  const n = Number(rows?.[0]?.n);
  if (!Number.isFinite(n) || n < 0) throw new Error("decay candidate count missing or malformed");
  return n;
}
