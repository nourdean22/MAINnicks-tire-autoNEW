/**
 * nick-action-approved · AG-41 (2026-07-09)
 *
 * Event-driven half of the Nick Action Queue executor. The daily 9am
 * cron (app/api/cron/nick-action-execute) meant a /qa approval at
 * 10am sat unexecuted for 23 hours — the automation-gap register
 * measured a 14-DAY median approve→execute latency because of this.
 *
 * cmdQa now emits `nick-action/approved` with the just-approved row
 * ids right after its updateMany; this fn executes them within
 * seconds via the SHARED batch core (lib/ai/nick-action-batch.ts).
 * The cron stays as the backstop for anything the event path missed
 * (send failure, inngest outage). Double-execution is impossible:
 * every row is claimed by an atomic executedAt flip before running.
 *
 * retries: 0 — the batch core is at-most-once by design (claimed rows
 * never re-execute), so a retry could only re-send the digest.
 */

import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/nick-action-approved");
const inngest = getInngest();

interface NickActionApprovedData {
  actionIds: string[];
  approvedBy?: string;
}

export const nickActionApproved = inngest.createFunction(
  {
    id: "nick-action-approved",
    name: "Nick Action Queue · execute on approval",
    retries: 0,
    triggers: [{ event: "nick-action/approved" }],
    onFailure: onInngestFailure,
  },
  async ({ event, step }) => {
    const data = event.data as NickActionApprovedData;
    const ids = Array.isArray(data.actionIds)
      ? data.actionIds.filter((id): id is string => typeof id === "string")
      : [];
    if (ids.length === 0) {
      return { ok: true, skipped: "no_action_ids" };
    }

    // Same defense-in-depth gate as the cron — with the flag off the
    // proposer creates no rows, this just makes the posture explicit.
    const gated = await step.run("check-autonomy-flag", async () => {
      const { getFlag } = await import("@/lib/feature-flags");
      return getFlag("NICK_AUTONOMY")?.isOn ?? false;
    });
    if (!gated) {
      return { ok: true, skipped: "NICK_AUTONOMY off" };
    }

    const summary = await step.run("execute-approved", async () => {
      const { runNickActionBatch } = await import("@/lib/ai/nick-action-batch");
      return runNickActionBatch({ ids, source: "inngest:nick-action-approved" });
    });

    log.info("nick_action_approved_executed", {
      requested: ids.length,
      executed: summary.executed,
      failed: summary.failed,
      skipped: summary.skipped,
    });

    return { ok: true, ...summary, requested: ids.length };
  },
);
