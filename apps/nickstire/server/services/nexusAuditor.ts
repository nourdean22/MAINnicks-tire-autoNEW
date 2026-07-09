/**
 * Nexus Background Auditor
 */

import { getDbTyped } from "../db";
import { nexusAuditJobs, nickgptDefectLedger } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { createLogger } from "../lib/logger";

const log = createLogger("nexus-auditor");

export async function processNexusAuditJob(jobId: number) {
  const db = await getDbTyped();
  if (!db) return;

  try {
    const [job] = await db.select()
      .from(nexusAuditJobs)
      .where(eq(nexusAuditJobs.id, jobId))
      .limit(1);

    if (!job) return;
    
    await db.update(nexusAuditJobs)
      .set({ status: "processing" })
      .where(eq(nexusAuditJobs.id, jobId));

    let body = "";
    if (job.payloadJson) {
      try {
        const payload = JSON.parse(job.payloadJson);
        body = payload.body || "";
      } catch (e) {}
    }

    const isDefect = body.toLowerCase().includes("guarantee");

    if (isDefect) {
      await db.insert(nickgptDefectLedger).values({
        auditJobId: job.id,
        phoneHashOrLast4: "unknown",
        releaseDecision: "blocked",
        severity: "high",
        defectCodesJson: JSON.stringify(["policy_violation"]),
        findingsJson: JSON.stringify([{ reason: "Found prohibited word 'guarantee'" }]),
      });
      log.warn(`[Nexus] Logged defect for job ${jobId}`);
    }

    await db.update(nexusAuditJobs)
      .set({ 
        status: "completed", 
        completedAt: new Date(), 
        resultJson: JSON.stringify({ isDefect })
      })
      .where(eq(nexusAuditJobs.id, jobId));

  } catch (err) {
    log.error(`Failed to process nexus audit job ${jobId}`, err);
    await db.update(nexusAuditJobs)
      .set({ 
        status: "failed", 
        lastError: JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
      })
      .where(eq(nexusAuditJobs.id, jobId));
  }
}
