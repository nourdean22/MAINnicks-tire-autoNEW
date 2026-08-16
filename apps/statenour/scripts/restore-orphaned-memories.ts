/**
 * Recover brain memories whose row was hard-deleted but whose embedding survived.
 *
 * WHAT HAPPENED. Three of four hard-delete paths removed the `brain_memories`
 * row and left the `vector_embeddings` row behind (fixed 2026-08-16, see
 * lib/brain/memory-tombstone.ts). `vector_embeddings` keeps a `content` TEXT
 * copy, so 4,867 memories survived as text with no memory row: unmanaged,
 * unlistable, and — measured — the LAST copy. 100% had no surviving
 * brain_memories row with the same key, and the Obsidian vault holds only a
 * fraction (1 of 4 sampled).
 *
 * The content is not junk. Recovered by category:
 *
 *     insight            1046      nick_advice         648
 *     wisdom              254      blind_spot          249
 *     concern             287      prediction_lesson   183
 *     emotional_state     170      reference           158  (avg 4.3k chars)
 *     win                 105      learning_journal     77
 *
 * WHY AN ALLOWLIST, NOT ALL 4,867. These rows were deleted by expiry sweeps,
 * age/cap prunes and dedup passes — much of that was CORRECT. Restoring
 * everything would undo intentional pruning and re-import telemetry. Excluded on
 * purpose: `reply_judgment` (898) and `adversarial_objection` (305) are
 * judge/objection telemetry, and `gmail_thread` (123) is raw email content whose
 * re-import is a PII decision, not a recovery one.
 *
 * ZERO EMBEDDING COST. The vector already exists and already matches the text.
 * Rather than re-embedding, this re-points `vector_embeddings.sourceId` at the
 * new memory id — so a restored memory is immediately recallable and no provider
 * call is made.
 *
 * SAFETY (prod-db-guard). DRY RUN unless `--apply`. Prints the DB host. Skips
 * any key that already exists. Every restored row carries
 * `metadata.origin = "orphan-restore-2026-08-16"`, so the rollback is exact:
 *
 *     DELETE FROM brain_memories
 *      WHERE metadata->>'origin' = 'orphan-restore-2026-08-16';
 *
 * Usage:
 *   pnpm exec tsx scripts/restore-orphaned-memories.ts --env <path>            # dry run
 *   pnpm exec tsx scripts/restore-orphaned-memories.ts --env <path> --apply
 */
import fs from "node:fs";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
{
  const i = process.argv.indexOf("--env");
  if (i >= 0 && process.argv[i + 1]) {
    for (const line of fs.readFileSync(process.argv[i + 1], "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
}
// NOT a static import: ES imports are hoisted above the --env block above, so
// `lib/prisma` would build its client before DATABASE_URL existed and fail with
// "No database host or connection string was set" even though --env supplied
// one. Loaded inside main() instead, after the env is populated.
type Prisma = typeof import("@/lib/prisma")["prisma"];

const APPLY = process.argv.includes("--apply");
const ORIGIN = "orphan-restore-2026-08-16";

/** Categories worth recovering — distilled reasoning, not event logs. */
const RESTORE_CATEGORIES = [
  "insight", "nick_advice", "wisdom", "blind_spot", "prediction_lesson",
  "concern", "emotional_state", "reference", "win", "learning_journal",
  "counter_intuitive", "reflection", "business_event", "industry_intel",
  "meta_pattern", "hidden_correlation", "action_outcome", "mental",
  "discipline", "principle", "task_insight", "belief_candidate",
];

type Orphan = { embId: string; category: string; memKey: string; body: string };

async function main() {
  const { prisma }: { prisma: Prisma } = await import("@/lib/prisma");
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`database host : ${host || "(unset)"}`);
  console.log(`mode          : ${APPLY ? "APPLY (creates brain_memories rows)" : "DRY RUN"}`);
  console.log(`categories    : ${RESTORE_CATEGORIES.length} allowlisted\n`);

  // content is "[category] key: body". Parse with position(), not regex —
  // POSIX bracket-negation and JS template-literal escaping both bite here.
  const rows = await prisma.$queryRaw<Orphan[]>`
    SELECT v.id AS "embId",
           substring(v.content, 2, position(']' in v.content) - 2) AS category,
           split_part(substring(v.content from position(']' in v.content) + 2), ': ', 1) AS "memKey",
           v.content AS body
    FROM vector_embeddings v
    LEFT JOIN brain_memories bm ON bm.id = v."sourceId"
    WHERE v."sourceType" = 'brain_memory'
      AND bm.id IS NULL
      AND left(v.content, 1) = '['
      AND position(']' in v.content) > 2
      AND substring(v.content, 2, position(']' in v.content) - 2) = ANY(${RESTORE_CATEGORIES})
  `;
  console.log(`orphans matching the allowlist: ${rows.length}`);

  const byCat: Record<string, number> = {};
  for (const r of rows) byCat[r.category] = (byCat[r.category] ?? 0) + 1;
  for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1]))
    console.log(`  ${c.padEnd(24)} ${String(n).padStart(5)}`);

  if (!APPLY) {
    console.log("\n(dry run — re-run with --apply to restore)");
    await prisma.$disconnect();
    return;
  }

  let restored = 0;
  let skippedExisting = 0;
  let failed = 0;

  for (const r of rows) {
    const key = (r.memKey ?? "").trim();
    if (!key) { failed++; continue; }
    try {
      const exists = await prisma.brainMemory.findFirst({ where: { key }, select: { id: true } });
      if (exists) { skippedExisting++; continue; }

      // Strip the "[category] key: " prefix so the stored content matches what
      // the memory originally held, not the embedding's rendered form.
      const marker = `] ${key}: `;
      const idx = r.body.indexOf(marker);
      const content = idx >= 0 ? r.body.slice(idx + marker.length) : r.body;

      const created = await prisma.brainMemory.create({
        data: {
          category: r.category,
          key,
          content,
          // Original confidence did not survive the delete. 0.5 is the schema
          // default and the honest answer — asserting a high value would let a
          // recovered row outrank memories that were never lost.
          confidence: 0.5,
          source: "manual",
          createdBy: "system",
          metadata: { origin: ORIGIN, recoveredFromEmbedding: r.embId },
        },
        select: { id: true },
      });

      // Re-point the existing vector at the new row: the embedding already
      // matches this text, so recall works immediately with no provider call.
      await prisma.vectorEmbedding.update({
        where: { id: r.embId },
        data: { sourceId: created.id },
      });
      restored++;
      if (restored % 250 === 0) console.log(`  ...${restored} restored`);
    } catch (err) {
      failed++;
      if (failed <= 5) console.warn(`  FAILED ${key}: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    }
  }

  console.log(`\nrestored: ${restored} · skipped (key exists): ${skippedExisting} · failed: ${failed}`);
  console.log(`rollback: DELETE FROM brain_memories WHERE metadata->>'origin' = '${ORIGIN}';`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
