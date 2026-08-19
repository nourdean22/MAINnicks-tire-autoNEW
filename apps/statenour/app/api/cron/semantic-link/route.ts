/**
 * GET /api/cron/semantic-link · 2026-08-19 (Brain truth pass).
 *
 * Revives the embedding-based cross-memory linker. `runSemanticLinker`
 * shipped 2026-05-02 (v10.0.89) and then NEVER acquired a caller — the
 * classic severed-joint pattern: `semantic_edges` froze at 114 rows on
 * 2026-05-28 (measured in prod 2026-08-19), so every "related" edge the
 * brain graph draws between memories has been a three-month-old fossil.
 * feature-status.ts even admitted it: "0 edges (semantic-link cron
 * hasn't fired yet)".
 *
 * Nightly batch keeps the graph's semantic tissue growing again. The
 * linker is idempotent (edges upsert on the unordered pair), bounded
 * (batch of 25 memories per run, top-3 neighbors each), and no-ops
 * cleanly when pgvector is unavailable — that no-op is reported as
 * ok:false so logCronRun files a failed row instead of a false green.
 */
import { cronHandler } from "@/lib/utils/http";
import { runSemanticLinker } from "@/lib/brain/semantic-link";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const report = await runSemanticLinker({ batch: 25 });
  return {
    ok: report.pgvectorAvailable,
    ...(report.pgvectorAvailable ? {} : { reason: "pgvector unavailable — linker no-oped" }),
    ...report,
  };
});
