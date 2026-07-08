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
    
    // Find stuck or pending approved requests
    const pendingIds = await step.run("query-approved-requests", async () => {
      const requests = await prisma.approvalRequest.findMany({
        where: {
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
