/**
 * scripts/backfill-mastery.ts — operator CLI for the comprehensive,
 * all-time, all-source mastery-XP backfill (lib/mastery/comprehensive-backfill).
 *
 * Run via railway so it reads PROD data with prod env (DB + AI keys):
 *   railway run --service statenour-web pnpm exec node --conditions=react-server --import tsx scripts/backfill-mastery.ts measure
 *     → FREE, read-only. Counts uncredited items per source ≈ the AI-call count
 *       (the spend) the real run will make. Run this FIRST, before any spend.
 *   railway run ... pnpm exec tsx scripts/backfill-mastery.ts dry
 *     → small sample (8/source), real AI attribution, writes NOTHING. Preview
 *       attribution quality before committing to the full run.
 *   railway run ... pnpm exec tsx scripts/backfill-mastery.ts run [tag]
 *     → FULL run. Writes XP (idempotent · re-runnable). Reversible via revert.
 *   railway run ... pnpm exec tsx scripts/backfill-mastery.ts revert <tag>
 *     → undo exactly that run (deletes only the rows it created).
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const mode = process.argv[2];
  const arg = process.argv[3];

  // Dynamic import AFTER env is loaded so provider/prisma module-load env
  // reads succeed.
  const { measureBackfill, runComprehensiveBackfill } = await import(
    "@/lib/mastery/comprehensive-backfill"
  );
  const { revertBackfillRun } = await import("@/lib/mastery/credit");

  if (mode === "measure") {
    const m = await measureBackfill();
    console.log("=== BACKFILL MEASURE (read-only · no AI · no writes) ===");
    console.log(JSON.stringify(m, null, 2));
    console.log(
      `\nTOTAL uncredited AI-attributable items ≈ ${m.totalUncredited} AI calls.`,
    );
  } else if (mode === "dry") {
    const r = await runComprehensiveBackfill({ dryRun: true, perSourceCap: 8 });
    console.log("=== BACKFILL DRY SAMPLE (real AI · NO writes · 8/source) ===");
    console.log(JSON.stringify(r, null, 2));
  } else if (mode === "run") {
    const tag = arg || `backfill-${new Date().toISOString().slice(0, 19)}`;
    console.log(`=== BACKFILL FULL RUN · tag=${tag} (writes XP · reversible) ===`);
    const r = await runComprehensiveBackfill({ dryRun: false, runTag: tag });
    console.log(JSON.stringify(r, null, 2));
    console.log(`\nDONE · runTag=${tag} · revert with: ... revert ${tag}`);
  } else if (mode === "revert") {
    if (!arg) {
      console.error("revert needs a <tag>");
      process.exit(1);
    }
    const n = await revertBackfillRun(arg);
    console.log(JSON.stringify({ reverted: n, tag: arg }, null, 2));
  } else {
    console.error(
      "usage: backfill-mastery.ts measure | dry | run [tag] | revert <tag>",
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
