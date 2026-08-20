import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/diagnose-cron-failure");
const inngest = getInngest();

export interface ChronicPartial {
  jobName: string;
  /** Runs in the window that ended `partial`. */
  partialRuns: number;
  /** Failing children named in the partial errors, most frequent first. */
  failingChildren: { path: string; count: number }[];
}

export interface CronFailureDiagnosis {
  failedCount: number;
  schemaError: string | null;
  missingEnvKeys: string[];
  repairs: string[];
  timeline: string[];
  chronicPartials: ChronicPartial[];
}

/**
 * 2026-08-20 · a fan-out can be degraded every single night and never appear
 * here, because this workflow only ever read `status: "failed"` and the mega
 * fan-out writes `partial` when SOME children fail (mega-fanout.ts). That is
 * how mega-evening logged 29 consecutive partial nights — consolidate aborted
 * in every one of them — with zero diagnoses filed.
 *
 * Chronic = at least MIN_PARTIALS partials AND zero successes in the window.
 * One partial night is ordinary degradation (the fan-out's own per-child
 * retries cover it); a job that never once finishes clean is a defect with a
 * name in it, and the name is in the error JSON.
 */
export const CHRONIC_MIN_PARTIALS = 3;

export function isChronicPartial(counts: {
  success: number;
  partial: number;
}): boolean {
  return counts.success === 0 && counts.partial >= CHRONIC_MIN_PARTIALS;
}

/**
 * Tally failing-child paths out of `summarizeSettled` error payloads
 * (`[{"path":"/api/cron/x","status":...},...]`). Prod rows are not all valid
 * JSON — legacy rows hold prose — so anything unparseable is skipped, never
 * thrown: this runs inside the diagnosis cron and a poison row must not kill
 * the diagnosis.
 */
export function summarizeFailingChildren(
  errors: ReadonlyArray<string | null>,
): { path: string; count: number }[] {
  const tally = new Map<string, number>();
  for (const raw of errors) {
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const child of parsed) {
      if (child && typeof child === "object" && typeof (child as { path?: unknown }).path === "string") {
        const path = (child as { path: string }).path;
        tally.set(path, (tally.get(path) ?? 0) + 1);
      }
    }
  }
  return [...tally.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count);
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

    // Step 1b: chronically-partial fan-outs. Counts come from groupBy so a
    // storm (1,237 rows on 2026-08-20) cannot hide behind a `take` cap; the
    // error fetch is capped and scoped to the chronic jobs only.
    const chronicPartials = await step.run("read-chronic-partials", async () => {
      const { prisma } = await import("@/lib/prisma");
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const grouped = await prisma.cronJobLog.groupBy({
        by: ["jobName", "status"],
        where: { createdAt: { gte: sevenDaysAgo } },
        _count: { id: true },
      });
      const byJob = new Map<string, { success: number; partial: number }>();
      for (const g of grouped) {
        const e = byJob.get(g.jobName) ?? { success: 0, partial: 0 };
        if (g.status === "success") e.success = g._count.id;
        if (g.status === "partial") e.partial = g._count.id;
        byJob.set(g.jobName, e);
      }
      const chronicNames = [...byJob.entries()]
        .filter(([, counts]) => isChronicPartial(counts))
        .map(([name]) => name);
      if (chronicNames.length === 0) return [] as ChronicPartial[];

      const errorRows = await prisma.cronJobLog.findMany({
        where: {
          jobName: { in: chronicNames },
          status: "partial",
          createdAt: { gte: sevenDaysAgo },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { jobName: true, error: true },
      });

      return chronicNames.map((jobName): ChronicPartial => ({
        jobName,
        partialRuns: byJob.get(jobName)?.partial ?? 0,
        failingChildren: summarizeFailingChildren(
          errorRows.filter((r) => r.jobName === jobName).map((r) => r.error),
        ),
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

      for (const cp of chronicPartials) {
        const worst = cp.failingChildren
          .slice(0, 3)
          .map((c) => `${c.path} (${c.count}x)`)
          .join(", ");
        timeline.push(
          `Chronically partial: "${cp.jobName}" — ${cp.partialRuns} partial runs, zero clean, in 7d.` +
            (worst ? ` Failing children: ${worst}.` : ""),
        );
        repairs.push(
          `Fix the failing child(ren) of "${cp.jobName}"${worst ? ` — ${worst}` : ""}. ` +
            `Do NOT re-run the fan-out itself; that is the 2026-08-20 recursion.`,
        );
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
        chronicPartials,
      };
    });

    log.info("cron_diagnose_complete", {
      failedCount: diagnosis.failedCount,
      repairCount: diagnosis.repairs.length,
      chronicPartialCount: diagnosis.chronicPartials.length,
    });

    return diagnosis;
  }
);
