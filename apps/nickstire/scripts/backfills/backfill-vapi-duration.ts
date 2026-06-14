/**
 * Backfill vapi_call_logs.durationSeconds from VAPI's REST API.
 *
 * Why: Pre-2026-05-26 the webhook's inline duration calc only read
 * `event.call.startedAt`/`endedAt` which VAPI doesn't always populate on
 * end-of-call-report events · result: 100% of recent rows had duration=0
 * (audit #79 baseline finding). The webhook fix in wave-Y adds a multi-
 * path extractor for new calls; this script repairs historical rows.
 *
 * Strategy:
 *   1. Pull recent calls from VAPI's `/call` REST endpoint (returns
 *      `duration` as a number — proven reliable per server/services/vapi.ts
 *      getRecentCalls).
 *   2. For each VAPI call ID, find the matching vapi_call_logs row where
 *      durationSeconds = 0.
 *   3. Update that row with the real duration.
 *
 * Usage:
 *   railway link  # one-time, picks the nickstire service
 *   railway run -- pnpm tsx scripts/backfill-vapi-duration.ts
 *
 * Options:
 *   --dry-run · prints what would change without writing
 *   --limit N · how many calls to fetch from VAPI (default 200)
 *
 * Idempotent · safe to re-run · only touches rows where durationSeconds = 0.
 */

import { getDb } from "../../server/db";
import { vapiCallLogs } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { createLogger } from "../../server/lib/logger";

const log = createLogger("scripts:backfill-vapi-duration");

interface CliArgs {
  dryRun: boolean;
  limit: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, limit: 200 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  log.info("starting backfill", args);

  // Re-uses the proven getRecentCalls service which already maps `c.duration`
  // (number from VAPI REST API) into `durationSeconds`.
  const { getRecentCalls } = await import("../../server/services/vapi");
  const result = await getRecentCalls(args.limit);
  if (!result.success) {
    log.error("VAPI API fetch failed", { error: result.error });
    process.exit(1);
  }
  const callsWithDuration = result.calls.filter(
    (c) => c.id && typeof c.durationSeconds === "number" && c.durationSeconds > 0,
  );
  log.info("VAPI returned", { total: result.calls.length, withDuration: callsWithDuration.length });

  const d = await getDb();
  if (!d) {
    log.error("DB unavailable");
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const c of callsWithDuration) {
    // Only touch rows where durationSeconds is currently 0 — idempotent.
    const existing = await d
      .select({ id: vapiCallLogs.id, currentDur: vapiCallLogs.durationSeconds })
      .from(vapiCallLogs)
      .where(eq(vapiCallLogs.vapiCallId, c.id))
      .limit(1);

    if (existing.length === 0) {
      notFound++;
      continue;
    }
    if (existing[0].currentDur > 0) {
      skipped++;
      continue;
    }

    if (args.dryRun) {
      log.info("[dry-run] would update", {
        vapiCallId: c.id,
        rowId: existing[0].id,
        oldDur: existing[0].currentDur,
        newDur: c.durationSeconds,
      });
      updated++;
      continue;
    }

    await d
      .update(vapiCallLogs)
      .set({ durationSeconds: c.durationSeconds! })
      .where(
        and(
          eq(vapiCallLogs.vapiCallId, c.id),
          eq(vapiCallLogs.durationSeconds, 0),
        ),
      );
    updated++;
  }

  log.info("backfill complete", {
    dryRun: args.dryRun,
    updated,
    skippedAlreadyPopulated: skipped,
    notFoundInLocalTable: notFound,
    vapiReturned: result.calls.length,
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error("backfill failed", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
