import { getInngest } from "../client";
import { prisma } from "@/lib/prisma";
import { executeApprovedToolAsync } from "@/lib/tools/guardian";
import { recoverStuckDecisions } from "@/lib/automation/approval-queue";
import { logger } from "@/lib/logger";
import { onInngestFailure } from "../on-failure";

const log = logger.withSurface("inngest/approval-sweeper");

export const approvalSweeper = getInngest().createFunction(
  {
    id: "approval-sweeper",
    name: "Approval Sweeper",
    triggers: [{ cron: "*/5 * * * *" }],
    // 2026-07-10 review fix · this was the ONLY Inngest function without
    // onFailure — the durability backstop for approved tool execution
    // (incl. real customer SMS) failed silently. Every sibling alerts
    // Telegram via onInngestFailure; now this one does too.
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    // ⚠⚠ THIS FUNCTION HAS NOW BEEN THE ODD ONE OUT TWICE, FOR THE SAME REASON.
    // It declares itself `getInngest().createFunction(...)` while every sibling
    // uses a module-level `inngest.createFunction(...)`, so tooling that keys on
    // the literal form skips it. In 2026-07-10 that made it the only function
    // without onFailure (see the comment above). On 2026-09-17 it made it the
    // only cron my self-row instrumentation missed — AND my ratchet shared the
    // same pattern, so the guard reported the fleet clean while the
    // five-minute sweeper stayed invisible. Review caught it.
    // ★ A detector that shares an assumption with the thing it checks cannot
    //   catch that assumption being wrong; it just produces a confident green.

    const staleTime = new Date(Date.now() - 5 * 60 * 1000); // 5 min
    const now = new Date();

    // 08-F1: an `executing` row older than 5 min is NEVER re-run: `executed`
    // is written only after the effect, so its tool may already have sent.
    // It goes to `needs_review` for a human. A slow run that finishes later
    // still overwrites this with its real `executed` / `failed`.
    const flaggedForReview = await step.run("flag-stale-executing", async () => {
      const flagged = await prisma.approvalRequest.updateMany({
        where: { status: "executing", updatedAt: { lt: staleTime } },
        data: {
          status: "needs_review",
          resultPayload: { error: "Execution did not finish within 5 minutes; not re-run. Check whether it took effect." },
        },
      });
      if (flagged.count > 0) log.warn("approval_stale_executing_needs_review", { count: flagged.count });
      return flagged.count;
    });

    // 2026-07-09 hardening (post-#617 review) · without these bounds the
    // sweeper would resurrect and EXECUTE every historically stuck
    // "approved" row on first deploy — including real customer SMS
    // (shop.sendSms approvals, which the third-tier dispatch can send).
    // expiresAt was being written everywhere
    // (24h default, 2h high/critical) but read NOWHERE — dead policy
    // until this filter. The age floor is belt+suspenders for legacy
    // rows created before expiresAt existed.
    const ageFloor = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // Find approved requests whose execution never started
    const pendingIds = await step.run("query-approved-requests", async () => {
      const requests = await prisma.approvalRequest.findMany({
        where: {
          expiresAt: { gt: now },
          createdAt: { gt: ageFloor },
          status: "approved",
        },
        select: { id: true },
        take: 10 // process in batches
      });
      return requests.map(r => r.id);
    });

    // SN-04 follow-up: an AutonomousAction decision claim (`processing`) that
    // never finished. Its own try/catch: a failure here must not block the
    // approved-tool sweep; null in the output means "not measured", never 0.
    const stuckDecisions = await step.run("recover-stuck-decisions", async () => {
      try {
        return await recoverStuckDecisions();
      } catch (err) {
        log.error("stuck_decision_recovery_failed", { error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    });

    if (pendingIds.length === 0) {
      return { swept: 0, flaggedForReview, stuckDecisions };
    }

    // Trigger execution for each
    await step.run("trigger-executions", async () => {
      log.info("sweeper_triggering_executions", { count: pendingIds.length });
      
      const results = await Promise.allSettled(
        pendingIds.map((id: string) => executeApprovedToolAsync(id))
      );
      
      const failures = results.filter(r => r.status === "rejected");
      if (failures.length > 0) {
        log.warn("sweeper_execution_failures", { count: failures.length, failures: failures.map(f => (f as PromiseRejectedResult).reason) });
      }
    });

    return { swept: pendingIds.length, flaggedForReview, stuckDecisions };
  }
);
