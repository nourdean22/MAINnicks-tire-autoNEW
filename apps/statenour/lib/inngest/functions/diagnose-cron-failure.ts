import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/diagnose-cron-failure");
const inngest = getInngest();

export interface CronFailureDiagnosis {
  failedCount: number;
  schemaError: string | null;
  missingEnvKeys: string[];
  repairs: string[];
  timeline: string[];
}

export const diagnoseCronFailure = inngest.createFunction(
  {
    id: "diagnose-cron-failure",
    name: "Cron Failure Diagnosis Workflow",
    retries: 2,
    triggers: [{ cron: "0 */4 * * *" }], // Run every 4 hours
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    // Step 1: Read Cron logs from database
    const failedLogs = await step.run("read-failed-logs", async () => {
      const { prisma } = await import("@/lib/prisma");
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const logs = await prisma.cronJobLog.findMany({
        where: {
          status: "failed",
          createdAt: { gte: twentyFourHoursAgo },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          jobName: true,
          error: true,
          createdAt: true,
        },
      });

      return logs.map(l => ({
        id: l.id,
        jobName: l.jobName,
        error: l.error ?? "Unknown error",
        createdAt: l.createdAt.toISOString(),
      }));
    });

    // Step 2: Verify Schema migrations status
    const schemaStatus = await step.run("verify-schema-health", async () => {
      const { prisma } = await import("@/lib/prisma");
      const failedMigration = await prisma.schemaChangeLedger.findFirst({
        where: { status: "failed" },
        orderBy: { createdAt: "desc" },
        select: {
          changeKey: true,
          title: true,
          reason: true,
        },
      });

      return failedMigration ? {
        key: failedMigration.changeKey,
        title: failedMigration.title,
        reason: failedMigration.reason,
      } : null;
    });

    // Step 3: Check environment variables
    const envStatus = await step.run("check-env-vars", async () => {
      const criticalKeys = [
        "DATABASE_URL",
        "INNGEST_EVENT_KEY",
        "INNGEST_SIGNING_KEY",
        "VAPI_API_KEY",
        "NICKSTIRE_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
      ];
      const missing: string[] = [];
      for (const key of criticalKeys) {
        if (!process.env[key]) {
          missing.push(key);
        }
      }
      return missing;
    });

    // Step 4: Create Repair Plan & diagnosis summary
    const diagnosis = await step.run("create-repair-plan", async () => {
      const repairs: string[] = [];
      const timeline: string[] = [];

      timeline.push(`Scan complete: found ${failedLogs.length} failed logs.`);

      if (schemaStatus) {
        timeline.push(`Detected failed schema migration: "${schemaStatus.title}"`);
        repairs.push(`Re-apply or rollback migration: "${schemaStatus.key}"`);
      }

      if (envStatus.length > 0) {
        timeline.push(`Missing critical environment variables: ${envStatus.join(", ")}`);
        repairs.push(`Configure environment variables in Railway: ${envStatus.join(", ")}`);
      }

      for (const log of failedLogs) {
        if (log.error.toLowerCase().includes("pgvector") || log.error.toLowerCase().includes("embedding")) {
          repairs.push(`Run migrate-with-env.ps1 to restore pgvector bindings for job ${log.jobName}`);
        }
        if (log.error.toLowerCase().includes("unauthorized") || log.error.toLowerCase().includes("auth")) {
          repairs.push(`Verify API tokens for job ${log.jobName}`);
        }
      }

      return {
        failedCount: failedLogs.length,
        schemaError: schemaStatus ? schemaStatus.reason : null,
        missingEnvKeys: envStatus,
        repairs,
        timeline,
      };
    });

    log.info("cron_diagnose_complete", {
      failedCount: diagnosis.failedCount,
      repairCount: diagnosis.repairs.length,
    });

    return diagnosis;
  }
);
