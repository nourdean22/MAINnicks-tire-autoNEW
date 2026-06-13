import { cronHandler } from "@/lib/utils/http";
import { buildCronCommandDeck } from "@/lib/services/system-pages";
import { runManifestCron } from "@/lib/services/cron-control";
import { recordCoachEvent } from "@/lib/services/coach-events";
import { logger } from "@/lib/logger";

export const maxDuration = 120; // 2 minutes, as it may heal up to 3 crons sequentially

const log = logger.withSurface("cron/cron-healer");

export const GET = cronHandler(async () => {
  log.info("start_scan");
  
  const deck = await buildCronCommandDeck();
  const healed: string[] = [];
  const errors: string[] = [];
  const MAX_HEAL_PER_RUN = 3;

  for (const row of deck.rows) {
    if (healed.length >= MAX_HEAL_PER_RUN) {
      log.info("heal_limit_reached", { count: healed.length });
      break;
    }

    // Skip retired, disabled, or self
    if (row.mode === "retired" || !row.enabled || row.name === "cron-healer") {
      continue;
    }

    const isFailing = row.lastStatus === "failed" || row.fail14d > 0;
    const isNeverRun = row.lastRunAt === null || (row.success14d === 0 && row.fail14d === 0);

    if (isFailing || isNeverRun) {
      const reason = isFailing ? "failing" : "never_run";
      log.info("trigger_healing", { jobName: row.name, reason });

      try {
        const result = await runManifestCron(row.name);
        healed.push(row.name);

        // Notify operator via Coach Channel (P0 for failed crons, P1 for never-run crons)
        await recordCoachEvent({
          kind: "system-alert",
          subjectId: `cron-heal:${row.name}`,
          priority: isFailing ? "P0" : "P1",
          title: `Cron Healer: Rescued ${row.name}`,
          body: `Cron job "${row.name}" was ${reason} and was automatically healed. Status: ${result.status}, duration: ${result.durationMs}ms.`,
          surfaces: ["scoreboard", "home"],
          extra: {
            jobName: row.name,
            reason,
            status: result.status,
            durationMs: result.durationMs,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${row.name}: ${msg}`);
        log.error("healing_failed", { jobName: row.name, error: msg });
      }
    }
  }

  log.info("scan_completed", { healedCount: healed.length, errorsCount: errors.length });

  return {
    status: "ok",
    healed,
    errors,
  };
});
