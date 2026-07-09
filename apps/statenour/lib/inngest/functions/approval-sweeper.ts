import { getInngest } from "../client";
import { prisma } from "@/lib/prisma";
import { executeApprovedToolAsync } from "@/lib/tools/guardian";
import { logger } from "@/lib/logger";

const log = logger.withSurface("inngest/approval-sweeper");

export const approvalSweeper = getInngest().createFunction(
  { 
    id: "approval-sweeper", 
    name: "Approval Sweeper",
    triggers: [{ cron: "*/5 * * * *" }]
  },
  async ({ step }) => {
    const staleTime = new Date(Date.now() - 5 * 60 * 1000); // 5 min
    const now = new Date();
    // 2026-07-09 hardening (post-#617 review) · without these bounds the
    // sweeper would resurrect and EXECUTE every historically stuck
    // "approved" row on first deploy — including real customer SMS
    // (audit-todays-leads writes shop.sendSms approvals the third-tier
    // dispatch can now send). expiresAt was being written everywhere
    // (24h default, 2h high/critical) but read NOWHERE — dead policy
    // until this filter. The age floor is belt+suspenders for legacy
    // rows created before expiresAt existed.
    const ageFloor = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // Find stuck or pending approved requests
    const pendingIds = await step.run("query-approved-requests", async () => {
      const requests = await prisma.approvalRequest.findMany({
        where: {
          expiresAt: { gt: now },
          createdAt: { gt: ageFloor },
          OR: [
            { status: "approved" },
            { status: "executing", updatedAt: { lt: staleTime } }
          ]
        },
        select: { id: true },
        take: 10 // process in batches
      });
      return requests.map(r => r.id);
    });

    if (pendingIds.length === 0) {
      return { swept: 0 };
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

    return { swept: pendingIds.length };
  }
);
