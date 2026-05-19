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
  } catch (err: unknown) {
    if ((err as Error).message?.includes("already exists")) return true;
    log.error("Failed to create drip_enrollments table:", { error: (err as Error).message });
    return false;
  }
}

/**
 * Check if customer is already enrolled in a SPECIFIC campaign (dedup guard).
 */
export async function checkExistingEnrollment(phone: string, campaignId: string): Promise<boolean> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return false;

    await ensureTable(db);
    const [rows] = await db.execute(sql`
      SELECT 1 FROM drip_enrollments
      WHERE customerPhone = ${phone}
        AND campaignId = ${campaignId}
        AND status = 'active'
      LIMIT 1
    `);
    return ((rows as any[])?.length || 0) > 0;
  } catch (e) {
    log.warn("[services/dripProcessor] operation failed:", e);
    return false;
  }
}

/**
 * wave-117b — Check if customer is in ANY active drip campaign.
 * Cross-campaign dedup: prevents enrolling a customer simultaneously
 * into two campaigns (e.g. "at-risk" + "declined-estimate" both fire
 * on the same day, customer gets 2 parallel SMS sequences). Daily-tier
 * cron jobs (churn-detection, declined-work-recovery) call this before
 * enrolling so a customer who's already mid-campaign doesn't get
 * piled on. Returns the active campaign id if any.
 */
export async function hasActiveDripEnrollment(phone: string): Promise<string | null> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return null;

    await ensureTable(db);
    const [rows] = await db.execute(sql`
      SELECT campaignId FROM drip_enrollments
      WHERE customerPhone = ${phone}
        AND status = 'active'
      LIMIT 1
    `);
    const list = (rows as Array<{ campaignId?: string }>) || [];
    return list[0]?.campaignId || null;
  } catch (e) {
    log.warn("[services/dripProcessor] hasActiveDripEnrollment failed:", e);
    return null;
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

    // wave-181.67 (bug-hunter chip #2 · P0) · Wrap dedup-then-insert in
    // a transaction with FOR UPDATE so two concurrent pods can't both
    // pass the SELECT check and double-enroll the same customer. Pre-
    // fix: pod A SELECT → 0 rows · pod B SELECT → 0 rows · both INSERT
    // → customer received every drip-campaign message twice (TCPA risk
    // + brand damage). With FOR UPDATE, pod B's SELECT blocks until
    // pod A commits; pod B then sees pod A's insert and bails cleanly.
    //
    // Note · MySQL's gap-lock semantics: FOR UPDATE on a no-match
    // query takes a gap lock on the (customerPhone, campaignId,
    // status='active') predicate range. Pod B's INSERT competes for
    // the same gap, blocks until pod A commits, then re-evaluates.
    const { CAMPAIGNS } = await import("./dripCampaigns");
    const campaign = CAMPAIGNS.find(c => c.id === params.campaignId);
    if (!campaign) return;

    // Step 1 was already sent by enrollInDripCampaign, start at step 2
    const nextStep = campaign.steps[1]; // step 2
    if (!nextStep) return; // Only 1 step, no need to persist

    const nextStepAt = new Date();
    nextStepAt.setDate(nextStepAt.getDate() + nextStep.delayDays);

    const { randomUUID } = await import("crypto");

    // `tx` is the drizzle MySqlTransaction handle · same `.execute()` API
    // as the outer db, but all queries share a single transaction. Type
    // inferred from the awaited handle would require importing the
    // generic MySqlTransaction type which is overkill for a 2-query tx.
    await db.transaction(async (tx: { execute: typeof db.execute }) => {
      const [existing] = await tx.execute(sql`
        SELECT id FROM drip_enrollments
        WHERE customerPhone = ${params.customerPhone}
          AND campaignId = ${params.campaignId}
          AND status = 'active'
        LIMIT 1
        FOR UPDATE
      `);

      if (Array.isArray(existing) && existing.length > 0) {
        return; // Peer-pod won the race · skip silently
      }

      await tx.execute(sql`
        INSERT INTO drip_enrollments (id, campaignId, customerPhone, customerName, currentStep, status, enrolledAt, nextStepAt, metadata)
        VALUES (${randomUUID()}, ${params.campaignId}, ${params.customerPhone}, ${params.customerName}, ${1}, 'active', NOW(), ${nextStepAt}, ${JSON.stringify(params.metadata || {})})
      `);

      log.info(`Drip enrolled: ${params.customerName} → ${params.campaignId} (step 2 at ${nextStepAt.toISOString().slice(0, 10)})`);
    });
  } catch (err: unknown) {
    log.warn(`Drip enrollment persist failed: ${(err as Error).message}`);
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
          // Gate SMS behind feature flag
          const { isEnabled } = await import("./featureFlags");
          if (await isEnabled("drip_campaigns_enabled")) {
            await sendSms(enrollment.customerPhone, msg);
          }
        } else if (step.channel === "email") {
          const { isEnabled } = await import("./featureFlags");
          if (!(await isEnabled("drip_campaigns_enabled"))) {
            /* skip */
          } else {
            const email =
              typeof meta.email === "string" && meta.email.includes("@")
                ? meta.email.trim()
                : null;
            const resendKey = process.env.RESEND_API_KEY;
            if (!email) {
              log.warn("Drip email step skipped — no customer email in enrollment metadata");
            } else if (!resendKey) {
              log.warn("Drip email step skipped — RESEND_API_KEY not set");
            } else {
              const { Resend } = await import("resend");
              const resend = new Resend(resendKey);
              const fromEmail =
                process.env.RESEND_FROM_EMAIL || "Nick's Tire & Auto <noreply@nickstire.org>";
              const subject =
                typeof meta.emailSubject === "string" && meta.emailSubject.trim()
                  ? meta.emailSubject.trim()
                  : "Nick's Tire & Auto";
              const { error } = await resend.emails.send({
                from: fromEmail,
                replyTo: process.env.SHOP_EMAIL || undefined,
                to: [email],
                subject,
                html: `<div style="font-family:system-ui,sans-serif;line-height:1.5">${msg
                  .replace(/&/g, "&amp;")
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;")
                  .replace(/\n/g, "<br/>")}</div>`,
              });
              if (error) {
                log.warn("Drip email send failed", { error: error.message });
              }
            }
          }
        }

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
      } catch (err: unknown) {
        log.warn(`Drip step failed for ${enrollment.customerName}: ${(err as Error).message}`);
      }
    }

    return { recordsProcessed: sent, details: `${sent}/${due.length} drip steps sent` };
  } catch (err: unknown) {
    if ((err as Error).message?.includes("drip_enrollments") && (err as Error).message?.includes("doesn't exist")) {
      return { recordsProcessed: 0, details: "drip_enrollments table not ready" };
    }
    return { recordsProcessed: 0, details: `Failed: ${(err as Error).message}` };
  }
}
