/**
 * GET /api/cron/agent-followups — fire follow-ups the agent scheduled
 * for itself (2026-08-28 · WP3).
 *
 * This is the consumer that makes lib/agent/follow-up.ts a real feature
 * instead of a queue nothing drains. It is deliberately the SMALLEST
 * possible executor: claim what is due, run each, mark it done.
 *
 * THREE INDEPENDENT OFF SWITCHES, and all three must be on to deliver a
 * single message:
 *   1. `NICK_AGENT_FOLLOWUPS=1` — the feature switch, DEFAULT OFF, checked
 *      inside both scheduleFollowUp and claimDueFollowUps.
 *   2. `isCronEnabled("agent-followups")` — the operator's live per-cron
 *      kill switch at /system/crons, no deploy needed.
 *   3. The cron manifest `mode` — this ships "staged", so the scheduler
 *      does not call it at all until promoted.
 * That is intentional over-provisioning of OFF. An agent that can wake
 * itself and message its owner should be hard to start and trivial to
 * stop, not the reverse.
 *
 * A failed follow-up is NOT retried into the ground: attempts are capped
 * in claimDueFollowUps (< 3) and a failure marks the row failed with its
 * reason, so a permanently-broken follow-up dies quietly instead of
 * re-messaging the operator every 15 minutes.
 */

import { cronHandler } from "@/lib/utils/http";
import { logger as rootLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { claimDueFollowUps, areFollowUpsEnabled } from "@/lib/agent/follow-up";
import { runFollowUp } from "@/lib/agent/run-follow-up";
import { isCronEnabled } from "@/lib/services/cron-control";

export const maxDuration = 300;

const log = rootLogger.withSurface("cron/agent-followups");

export const GET = cronHandler(async () => {
  if (!areFollowUpsEnabled()) {
    return { skipped: true, reason: "NICK_AGENT_FOLLOWUPS is not set — feature is off" };
  }
  if (!(await isCronEnabled("agent-followups"))) {
    return { skipped: true, reason: "operator kill switch is off for this cron" };
  }

  const claimed = await claimDueFollowUps(5);
  let delivered = 0;
  let dropped = 0;

  for (const row of claimed) {
    try {
      const result = await runFollowUp(row.payload);
      await prisma.postTurnOutbox.update({
        where: { id: row.id },
        // A follow-up that legitimately decided NOT to deliver (thread
        // archived, empty completion, provider sentinel) is DONE, not
        // failed — retrying it would not change the answer and would
        // burn the attempt budget for no reason.
        data: { status: "done", lastError: result.ok ? null : result.reason },
      });
      if (result.ok) delivered++;
      else dropped++;
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 400) : String(err);
      await prisma.postTurnOutbox.update({
        where: { id: row.id },
        // Genuine throw → leave it claimable again until the attempt cap
        // in claimDueFollowUps stops it for good.
        data: { status: row.attempts >= 3 ? "failed" : "pending", lastError: message },
      });
      log.error("followup_run_failed", { id: row.id, attempts: row.attempts, message });
      dropped++;
    }
  }

  if (claimed.length > 0) {
    log.info("agent_followups_drained", { claimed: claimed.length, delivered, dropped });
  }
  return { claimed: claimed.length, delivered, dropped };
});
