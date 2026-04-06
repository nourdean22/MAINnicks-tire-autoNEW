/**
 * Drip Campaign Step Processor — Makes multi-step drips actually work.
 *
 * Uses a DB table (drip_enrollments) to persist enrollments.
 * Cron runs every 2hr, finds enrollments where nextStepAt <= NOW(),
 * sends the message, and advances to the next step.
 *
 * If the table doesn't exist yet, auto-creates it.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("drip-processor");

/**
 * Ensure the drip_enrollments table exists (auto-create if needed)
 */
async function ensureTable(db: any): Promise<boolean> {
  try {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS drip_enrollments (
        id VARCHAR(36) PRIMARY KEY,
        campaignId VARCHAR(50) NOT NULL,
        customerPhone VARCHAR(20) NOT NULL,
        customerName VARCHAR(100),
        currentStep INT DEFAULT 0,
        status ENUM('active','completed','cancelled','converted') DEFAULT 'active',
        enrolledAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        nextStepAt DATETIME,
        metadata JSON,
        INDEX idx_status_next (status, nextStepAt),
        INDEX idx_phone_campaign (customerPhone, campaignId)
      )
    `);
    return true;
  } catch (err: any) {
    if (err.message?.includes("already exists")) return true;
    log.error("Failed to create drip_enrollments table:", { error: err.message });
    return false;
  }
}

/**
 * Enroll a customer in a drip campaign (persists to DB).
 * Called from workOrderAutomation.enrollInDripCampaign after sending step 1.
 */
export async function persistDripEnrollment(params: {
  campaignId: string;
  customerPhone: string;
  customerName: string;
  metadata?: Record<string, string>;
}): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return;

    await ensureTable(db);

    // Check for existing active enrollment in same campaign
    const [existing] = await db.execute(sql`
      SELECT id FROM drip_enrollments
      WHERE customerPhone = ${params.customerPhone}
        AND campaignId = ${params.campaignId}
        AND status = 'active'
      LIMIT 1
    `);

    if ((existing as any[])?.length > 0) return; // Already enrolled

    const { CAMPAIGNS } = await import("./dripCampaigns");
    const campaign = CAMPAIGNS.find(c => c.id === params.campaignId);
    if (!campaign) return;

    // Step 1 was already sent by enrollInDripCampaign, start at step 2
    const nextStep = campaign.steps[1]; // step 2
    if (!nextStep) return; // Only 1 step, no need to persist

    const nextStepAt = new Date();
    nextStepAt.setDate(nextStepAt.getDate() + nextStep.delayDays);

    const { randomUUID } = await import("crypto");
    await db.execute(sql`
      INSERT INTO drip_enrollments (id, campaignId, customerPhone, customerName, currentStep, status, enrolledAt, nextStepAt, metadata)
      VALUES (${randomUUID()}, ${params.campaignId}, ${params.customerPhone}, ${params.customerName}, ${1}, 'active', NOW(), ${nextStepAt}, ${JSON.stringify(params.metadata || {})})
    `);

    log.info(`Drip enrolled: ${params.customerName} → ${params.campaignId} (step 2 at ${nextStepAt.toISOString().slice(0, 10)})`);
  } catch (err: any) {
    log.warn(`Drip enrollment persist failed: ${err.message}`);
  }
}

/**
 * Process pending drip steps — called by scheduler every 2hr.
 */
export async function processDripSteps(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    const tableOk = await ensureTable(db);
    if (!tableOk) return { recordsProcessed: 0, details: "Table creation failed" };

    // Find enrollments due for next step
    const [dueRows] = await db.execute(sql`
      SELECT id, campaignId, customerPhone, customerName, currentStep, metadata
      FROM drip_enrollments
      WHERE status = 'active' AND nextStepAt <= NOW()
      LIMIT 20
    `);

    const due = dueRows as any[];
    if (!due || due.length === 0) return { recordsProcessed: 0, details: "No drip steps due" };

    const { CAMPAIGNS, personalizeMessage } = await import("./dripCampaigns");
    const { sendSms } = await import("../sms");
    let sent = 0;

    for (const enrollment of due) {
      const campaign = CAMPAIGNS.find(c => c.id === enrollment.campaignId);
      if (!campaign) continue;

      const step = campaign.steps[enrollment.currentStep];
      if (!step) {
        // No more steps — mark completed
        await db.execute(sql`UPDATE drip_enrollments SET status = 'completed' WHERE id = ${enrollment.id}`);
        continue;
      }

      try {
        const meta = typeof enrollment.metadata === "string" ? JSON.parse(enrollment.metadata) : enrollment.metadata || {};
        const msg = personalizeMessage(step.messageTemplate, {
          firstName: (enrollment.customerName || "there").split(" ")[0],
          vehicle: meta.vehicle || "vehicle",
          service: meta.service || "auto service",
          referralCode: enrollment.customerPhone.slice(-4),
        });

        if (step.channel === "sms") {
          await sendSms(enrollment.customerPhone, msg);
        }
        // TODO: Add email channel support

        const nextStepNum = enrollment.currentStep + 1;
        const nextStep = campaign.steps[nextStepNum];

        if (nextStep) {
          const nextAt = new Date();
          nextAt.setDate(nextAt.getDate() + nextStep.delayDays);
          await db.execute(sql`
            UPDATE drip_enrollments
            SET currentStep = ${nextStepNum}, nextStepAt = ${nextAt}
            WHERE id = ${enrollment.id}
          `);
        } else {
          await db.execute(sql`UPDATE drip_enrollments SET status = 'completed', currentStep = ${nextStepNum} WHERE id = ${enrollment.id}`);
        }

        sent++;
        await new Promise(r => setTimeout(r, 1500)); // Rate limit
      } catch (err: any) {
        log.warn(`Drip step failed for ${enrollment.customerName}: ${err.message}`);
      }
    }

    return { recordsProcessed: sent, details: `${sent}/${due.length} drip steps sent` };
  } catch (err: any) {
    if (err.message?.includes("drip_enrollments") && err.message?.includes("doesn't exist")) {
      return { recordsProcessed: 0, details: "drip_enrollments table not ready" };
    }
    return { recordsProcessed: 0, details: `Failed: ${err.message}` };
  }
}
