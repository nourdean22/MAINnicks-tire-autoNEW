/**
 * One-shot drain for the brain_memory embedding backlog.
 *
 * WHY THIS EXISTS. `app/api/cron/embed-backfill/route.ts` selected candidates
 * with a fixed top-200-by-confidence window rather than an anti-join, so it
 * could never reach rows below the window's floor (measured on prod: confidence
 * 1.0, with 9,490 rows at the ceiling). 12,791 of 15,317 active memories — 83.5%
 * — had no embedding, and recall is a vector search, so those rows were not weak
 * memories, they were absent ones.
 *
 * The cron is fixed and will now advance on its own, but at 100 rows x 2 runs a
 * day a 12,791-row backlog still takes two months. This drains it in one pass.
 *
 * TELEMETRY IS EXCLUDED ON PURPOSE. Roughly 3,879 of the dark rows are event
 * logs (mastery_xp_event, memory_gateway_shadow, persona_drift, ...). Embedding
 * them would put log lines in the same vector space as reasoning, and every one
 * is a slot a real memory could have occupied at recall time. The denylist is
 * imported from lib/brain/embedding-policy so the two cannot drift apart.
 *
 * IT COUNTS EFFECT, NOT INTENT. The first version of this script ran 25 minutes
 * and wrote NOTHING: `storeGenericEmbedding` swallows its own failures, so the
 * try/catch never fired, `done++` ran anyway, and since no row was written the
 * anti-join re-served the same 100 rows forever. Every log line said
 * `embedding.all_failed` while the counter reported progress. Two guards make
 * that impossible now: a preflight proving the provider returns a real vector
 * before any row is touched, and a per-page delta check that aborts when a full
 * page produces zero new embeddings.
 *
 * SAFETY (prod-db-guard): DRY RUN unless `--apply` is passed. It prints the
 * database host before doing anything, bounds work with `--limit`, and is
 * resumable — it selects only rows that are still unembedded, so re-running
 * after an interruption picks up exactly where it stopped. It writes ONLY
 * vector_embeddings rows; it never modifies or deletes a brain_memory.
 *
 * Usage:
 *   pnpm exec tsx scripts/drain-brain-embeddings.ts               # dry run, all
 *   pnpm exec tsx scripts/drain-brain-embeddings.ts --limit 50    # dry run, 50
 *   pnpm exec tsx scripts/drain-brain-embeddings.ts --apply       # write
 */
import fs from "node:fs";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

// Explicit env file, applied BEFORE anything reads process.env. Harness
// worktrees carry no .env, so loadEnvConfig finds nothing and COHERE_API_KEY is
// absent — which is precisely how the silent no-op described above happened.
{
  const i = process.argv.indexOf("--env");
  if (i >= 0 && process.argv[i + 1]) {
    for (const line of fs.readFileSync(process.argv[i + 1], "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
}
import { prisma } from "@/lib/prisma";
import { storeGenericEmbedding } from "@/lib/brain/embedding-utils";
import { TELEMETRY_CATEGORY_LIST } from "@/lib/brain/embedding-policy";

const APPLY = process.argv.includes("--apply");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Math.max(1, Number(process.argv[i + 1]) || 0) : Number.POSITIVE_INFINITY;
})();
/** Small enough that an interruption loses almost nothing; large enough to be quick. */
const PAGE = 100;

type Row = { id: string; category: string; key: string; content: string };

async function page(): Promise<Row[]> {
  return prisma.$queryRaw<Row[]>`
    SELECT bm.id, bm.category, bm.key, bm.content
    FROM brain_memories bm
    WHERE bm.deleted_at IS NULL
      AND bm.confidence >= 0.2
      AND NOT (bm.category = ANY(${TELEMETRY_CATEGORY_LIST}))
      AND NOT EXISTS (
        SELECT 1 FROM vector_embeddings v
        WHERE v."sourceType" = 'brain_memory' AND v."sourceId" = bm.id
      )
    ORDER BY bm.confidence DESC, bm.id
    LIMIT ${PAGE}
  `;
}

/** Live count of brain_memory embeddings — the only honest progress signal. */
async function embeddedCount(): Promise<number> {
  const [r] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM vector_embeddings WHERE "sourceType" = 'brain_memory'
  `;
  return Number(r.n);
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`database host : ${host || "(unset)"}`);
  console.log(`mode          : ${APPLY ? "APPLY (writes vector_embeddings)" : "DRY RUN (no writes)"}`);
  console.log(`limit         : ${LIMIT === Number.POSITIVE_INFINITY ? "all" : LIMIT}`);
  console.log(`excluding     : ${TELEMETRY_CATEGORY_LIST.length} telemetry categories\n`);

  if (APPLY) {
    // PREFLIGHT · getEmbedding returns [] on a missing key rather than throwing,
    // and storeGenericEmbedding swallows that. Without this the entire run is a
    // silent no-op that looks like progress.
    const { getEmbedding } = await import("@/lib/ai/provider");
    const probe = await getEmbedding("preflight: does the embedding provider work").catch(() => []);
    if (!Array.isArray(probe) || probe.length === 0) {
      console.error(
        "ABORT - the embedding provider returned no vector. COHERE_API_KEY / OPENAI_API_KEY " +
          "is probably missing; pass --env <path-to-.env>. Nothing was written.",
      );
      await prisma.$disconnect();
      process.exit(1);
    }
    console.log(`preflight ok  : provider returned a ${probe.length}-dim vector`);
  }

  let done = 0;
  let failed = 0;
  const byCategory: Record<string, number> = {};

  for (;;) {
    if (done >= LIMIT) break;
    const rows = await page();
    if (rows.length === 0) break;

    const before = APPLY ? await embeddedCount() : 0;

    for (const r of rows) {
      if (done >= LIMIT) break;
      byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
      if (APPLY) {
        try {
          await storeGenericEmbedding("brain_memory", r.id, `[${r.category}] ${r.key}: ${r.content}`);
        } catch (err) {
          failed++;
          console.warn(`  FAILED ${r.id} (${r.category}): ${String((err as Error)?.message ?? err).slice(0, 120)}`);
          continue;
        }
      }
      done++;
      if (done % 250 === 0) console.log(`  ...${done} embedded (${failed} failed)`);
    }

    // A dry run never writes, so the same page returns forever — stop after one.
    if (!APPLY) break;

    // EFFECT CHECK · if a whole page wrote nothing, the anti-join hands back the
    // same rows next time and this loop spins forever reporting success. Stop.
    const after = await embeddedCount();
    if (after === before) {
      console.error(
        "ABORT - a full page of " + rows.length + " rows produced ZERO new embeddings (count " +
          "stayed at " + after + "). The provider is failing silently. Nothing further attempted.",
      );
      break;
    }
  }

  console.log(`\n${APPLY ? "embedded" : "would embed"}: ${done}${failed ? ` · failed: ${failed}` : ""}`);
  console.log("by category:");
  for (const [c, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${c.padEnd(26)} ${String(n).padStart(6)}`);
  }
  if (!APPLY) console.log("\n(dry run showed one page only — re-run with --apply to drain)");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
