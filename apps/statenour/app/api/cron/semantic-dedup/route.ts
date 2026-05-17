// /api/cron/semantic-dedup — vector-similarity dedup of BrainMemory.
//
// v7 · BATCH 1A · Apr 28. Runs every 6h. Cheap (~50ms), no AI calls.
// Complements the daily AI-merge in /api/cron/consolidate.
//
// Vercel cron schedule: "0 (every-6h) * * *"

import { cronHandler } from "@/lib/utils/http";
import { runSemanticDedup } from "@/lib/brain/semantic-dedup";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const result = await runSemanticDedup({ dryRun: false });
  return {
    ok: result.errors.length === 0,
    ...result,
    summary: `${result.scanned} scanned · ${result.groups} groups · ${result.merged} merged · ${result.deleted} deleted · ${result.errors.length} errors`,
  };
});

export const POST = GET;
