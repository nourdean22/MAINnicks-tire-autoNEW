import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { today } from "@/lib/utils/datetime";
import fs from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";

export const maxDuration = 60;

const log = logger.withSurface("cron/subtask-usage-audit");

/**
 * GET /api/cron/subtask-usage-audit
 * - Self-fires on/after 2026-06-22
 * - Checks ADR-0017 A1 gate:
 *   1. Check if subtasks are actually in use in the DB (Tasks with parentTaskId != null).
 *   2. Check if the two candidates in `docs/adr/0017-task-subtasks-semantics.md` are checked off.
 * - If the date is on/after 2026-06-22 and both are false: report `gate_failed` and a warn line.
 *   It never deletes: the ADR and `prisma/migrations/20260523_task_parent_task_id` (an APPLIED
 *   migration, see lib/db/migration-manifest.ts) are tracked files; removing them is a human call.
 */
export const GET = cronHandler(async () => {
  const todayStr = today();
  const targetDate = "2026-06-22";

  log.info("start", { todayStr, targetDate });

  if (todayStr < targetDate) {
    log.info("waiting_for_target_date", { todayStr, targetDate });
    return {
      status: "waiting",
      message: `Audit date (${targetDate}) has not arrived yet. Current local date is ${todayStr}.`,
    };
  }

  // 1. Check DB for subtask usage
  const subtasksInDbCount = await prisma.task.count({
    where: {
      parentTaskId: { not: null },
      deletedAt: null,
    },
  });

  // 2. Check ADR-0017 checkboxes
  const adrRelPath = "docs/adr/0017-task-subtasks-semantics.md";
  const adrFullPath = path.join(process.cwd(), adrRelPath);
  
  let adrExists = false;
  let candidatesChecked = false;
  let adrContent = "";

  try {
    if (fs.existsSync(adrFullPath)) {
      adrExists = true;
      adrContent = fs.readFileSync(adrFullPath, "utf8");
      
      const c1Match = adrContent.match(/- \[[xX]\]\s*Real subtask candidate 1/);
      const c2Match = adrContent.match(/- \[[xX]\]\s*Real subtask candidate 2/);
      
      if (c1Match && c2Match) {
        candidatesChecked = true;
      }
    }
  } catch (err) {
    log.error("error_reading_adr", { error: err instanceof Error ? err.message : String(err) });
  }

  const justified = subtasksInDbCount > 0 || candidatesChecked;

  log.info("audit_results", {
    subtasksInDbCount,
    adrExists,
    candidatesChecked,
    justified,
  });

  if (!justified) {
    // Report only: a cron must not delete tracked files from the image or a checkout.
    log.warn("subtask_feature_not_justified", {
      message: "Gate failed: no subtasks in use and ADR-0017 candidates not filled. Nothing deleted; the operator decides.",
    });
  } else {
    log.info("subtask_feature_justified", {
      message: "Gate passed: subtasks are in use or candidates are verified.",
    });
  }

  return {
    status: justified ? "justified" : "gate_failed",
    subtasksInDbCount,
    adrExists,
    candidatesChecked,
    justified,
  };
});
