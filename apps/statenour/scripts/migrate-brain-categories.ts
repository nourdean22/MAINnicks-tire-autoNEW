/**
 * scripts/migrate-brain-categories.ts — one-shot database migration
 *
 * Rewrites every BrainMemory row whose category appears in
 * DEPRECATED_CATEGORY_MAP to its canonical target. Dry-run by default —
 * pass `--apply` to actually mutate data.
 *
 * Why this exists:
 *   - lib/brain/categories.ts was introduced to stop new writes from
 *     hand-typing category strings.
 *   - The runtime guard in brainMemory.remember() auto-rewrites
 *     deprecated→canonical on NEW writes.
 *   - But existing rows under `relationship`, `skills`, `business_read`,
 *     etc. are stranded — reads that filter by the canonical name miss
 *     them. This script heals the drift in one pass.
 *
 * Safety:
 *   - Dry-run prints exactly what will change (category + rowcount).
 *   - Conflict handling: if a row `{ category: "skills", key: "foo" }`
 *     conflicts with an existing `{ category: "skill", key: "foo" }`,
 *     we DELETE the older deprecated row (by createdAt). Never merge
 *     metadata silently — that would risk data loss.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-brain-categories.ts           # dry-run
 *   pnpm tsx scripts/migrate-brain-categories.ts --apply   # do it
 */

import { prisma } from "@/lib/prisma";
import { DEPRECATED_CATEGORY_MAP } from "@/lib/brain/categories";

interface MigrationRow {
  source: string;
  target: string;
  total: number;
  conflicts: number; // existing (target, key) already present
  migratable: number; // total - conflicts
}

async function preview(): Promise<MigrationRow[]> {
  const rows: MigrationRow[] = [];
  for (const [source, target] of Object.entries(DEPRECATED_CATEGORY_MAP)) {
    const [sourceRows, targetKeys] = await Promise.all([
      prisma.brainMemory.findMany({
        where: { category: source },
        select: { id: true, key: true },
      }),
      prisma.brainMemory
        .findMany({
          where: { category: target },
          select: { key: true },
        })
        .then((rs) => new Set(rs.map((r) => r.key))),
    ]);
    const conflicts = sourceRows.filter((r) => targetKeys.has(r.key)).length;
    if (sourceRows.length === 0) continue;
    rows.push({
      source,
      target,
      total: sourceRows.length,
      conflicts,
      migratable: sourceRows.length - conflicts,
    });
  }
  return rows;
}

async function apply(rows: MigrationRow[]): Promise<void> {
  for (const row of rows) {
    console.log(`\n== ${row.source} → ${row.target} ==`);
    const sourceRows = await prisma.brainMemory.findMany({
      where: { category: row.source },
      orderBy: { createdAt: "asc" },
    });
    const existingTargets = await prisma.brainMemory.findMany({
      where: {
        category: row.target,
        key: { in: sourceRows.map((r) => r.key) },
      },
      select: { key: true },
    });
    const takenKeys = new Set(existingTargets.map((r) => r.key));

    // Split into renames (no conflict) and deletes (canonical exists).
    const renames: string[] = [];
    const deletes: string[] = [];
    for (const r of sourceRows) {
      if (takenKeys.has(r.key)) deletes.push(r.id);
      else renames.push(r.id);
    }

    if (renames.length > 0) {
      const updated = await prisma.brainMemory.updateMany({
        where: { id: { in: renames } },
        data: { category: row.target },
      });
      console.log(`  ✓ renamed ${updated.count} rows`);
    }
    if (deletes.length > 0) {
      const removed = await prisma.brainMemory.deleteMany({
        where: { id: { in: deletes } },
      });
      console.log(
        `  ✓ deleted ${removed.count} conflicting rows (canonical already had the same key — older row dropped)`,
      );
    }
  }
}

async function main() {
  const apply_flag = process.argv.includes("--apply");

  console.log(
    apply_flag
      ? "🔧 APPLY mode — rows will be migrated"
      : "🔍 DRY-RUN mode — no changes will be written. Pass --apply to commit.",
  );

  const rows = await preview();

  if (rows.length === 0) {
    console.log("\n✅ Nothing to migrate — no rows under deprecated categories.");
    return;
  }

  console.log("\n📊 Migration preview:");
  console.log(
    `  source → target           │  total  │ conflicts │ migratable`,
  );
  console.log(
    `  ─────────────────────────┼─────────┼───────────┼───────────`,
  );
  for (const r of rows) {
    const arrow = `${r.source} → ${r.target}`.padEnd(28);
    console.log(
      `  ${arrow}│ ${String(r.total).padStart(7)} │ ${String(r.conflicts).padStart(9)} │ ${String(r.migratable).padStart(10)}`,
    );
  }
  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      conflicts: acc.conflicts + r.conflicts,
      migratable: acc.migratable + r.migratable,
    }),
    { total: 0, conflicts: 0, migratable: 0 },
  );
  console.log(
    `  ─────────────────────────┼─────────┼───────────┼───────────`,
  );
  console.log(
    `  TOTAL                      │ ${String(totals.total).padStart(7)} │ ${String(totals.conflicts).padStart(9)} │ ${String(totals.migratable).padStart(10)}`,
  );

  if (apply_flag) {
    await apply(rows);
    console.log("\n✅ Migration complete.");
  } else {
    console.log("\n💡 Re-run with --apply to commit these changes.");
  }
}

main()
  .catch((err) => {
    console.error("migrate-brain-categories FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
