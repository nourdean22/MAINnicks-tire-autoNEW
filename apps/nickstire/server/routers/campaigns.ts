/**
 * SMS Campaigns Router — admin endpoints for creating and sending targeted SMS campaigns.
 *
 * Supports:
 * - Pre-built templates: Maintenance Reminder, Seasonal, Special Offer, Winback
 * - Customer segments: recent (active last 90 days), lapsed (91-365 days), all customers
 * - Batch sending with rate limiting (1 SMS/second to avoid Twilio throttle)
 * - Campaign tracking (sends, failures, completions)
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { eq, sql, desc, and, isNull } from "drizzle-orm";
import { customers, smsCampaigns, smsCampaignSends } from "../../drizzle/schema";
import { campaignEligiblePhoneSql } from "../lib/sms-eligibility";
import { sendSms, isShopGatewayReachable, isShopGatewayConfigured } from "../sms";
import { STORE_PHONE, STORE_NAME } from "@shared/const";
import { BUSINESS } from "@shared/business";

import { db } from "../lib/db-helper";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:campaigns");
// ─── CAMPAIGN TEMPLATES ────────────────────────────────

const CAMPAIGN_TEMPLATES: Record<string, (name: string, customMessage?: string) => string> = {
  maintenance: (_firstName: string) =>
    `Due for an oil change or a once-over? $49 conventional, $80 synthetic — walk in any day, no appointment. Nick's Tire & Auto, ${BUSINESS.phone.display}`,

  seasonal: (_firstName: string) =>
    `Winter's on the way — get your tires checked before the snow. Used tires from $60 installed, walk in any day. Nick's Tire & Auto, ${BUSINESS.phone.display}`,

  special_offer: (_firstName: string, offer?: string) =>
    `${offer || "10% off your next visit"} at Nick's Tire & Auto — walk in any day, first-come, first-served. ${BUSINESS.phone.display}`,

  winback: (_firstName: string) =>
    `It's been a while — come back to Nick's Tire & Auto for 10% off your next visit. Walk in any day, no appointment. ${BUSINESS.phone.display}`,
};

/**
 * TCPA/CTIA: bulk promotional SMS must carry opt-out instructions. Append a
 * STOP footer unless the body already contains one (custom messages may).
 * Applied to BOTH template and custom-message paths at the build site so the
 * stored send body, the operator preview, and the actual send all match.
 */
function withOptOut(body: string): string {
  return /\breply stop\b/i.test(body) ? body : `${body}\n\nReply STOP to opt out.`;
}

// ─── GET CUSTOMERS BY SEGMENT ──────────────────────────

async function getSegmentCustomers(segment: "recent" | "lapsed" | "all"): Promise<Array<{ id: number; firstName: string; phone: string }>> {
  const d = await db();
  if (!d) return [];

  // Canonical eligibility predicate — shared with customers.retryCampaign so the
  // two SMS-campaign paths can never drift on who counts as reachable.
  const phoneFilter = campaignEligiblePhoneSql;

  if (segment === "recent") {
    // Active in last 90 days
    return d.select({
      id: customers.id,
      firstName: customers.firstName,
      phone: customers.phone,
    }).from(customers).where(
      and(phoneFilter, sql`${customers.lastVisitDate} IS NOT NULL AND DATEDIFF(CURDATE(), ${customers.lastVisitDate}) <= 90`)
    ).limit(5000);
  } else if (segment === "lapsed") {
    // Haven't visited in 91-365 days
    return d.select({
      id: customers.id,
      firstName: customers.firstName,
      phone: customers.phone,
    }).from(customers).where(
      and(phoneFilter, sql`${customers.lastVisitDate} IS NOT NULL AND DATEDIFF(CURDATE(), ${customers.lastVisitDate}) BETWEEN 91 AND 365`)
    ).limit(5000);
  } else {
    // All customers
    return d.select({
      id: customers.id,
      firstName: customers.firstName,
      phone: customers.phone,
    }).from(customers).where(phoneFilter).limit(5000);
  }
}

// ─── MAIN ROUTER ───────────────────────────────────────

export const campaignsRouter = router({
  /** List all SMS campaigns with stats */
  list: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];

    return d.select().from(smsCampaigns).orderBy(desc(smsCampaigns.createdAt)).limit(100);
  }),

  /** Get campaign detail with send stats */
  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return null;

      const [campaign] = await d.select().from(smsCampaigns).where(eq(smsCampaigns.id, input.id));
      if (!campaign) return null;

      // Get send stats
      const [stats] = await d.select({
        sent: sql<number>`sum(case when ${smsCampaignSends.status} = 'sent' then 1 else 0 end)`,
        failed: sql<number>`sum(case when ${smsCampaignSends.status} = 'failed' then 1 else 0 end)`,
        pending: sql<number>`sum(case when ${smsCampaignSends.status} = 'pending' then 1 else 0 end)`,
      })
        .from(smsCampaignSends)
        .where(eq(smsCampaignSends.campaignId, input.id));

      return { campaign, stats };
    }),

  /** Create a new SMS campaign (draft mode) */
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      template: z.enum(["maintenance", "seasonal", "special_offer", "winback"]),
      segment: z.enum(["recent", "lapsed", "all"]),
      customMessage: z.string().max(1600).optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false, error: "Database not available" };

      const cleanName = input.name.replace(/<[^>]*>/g, "").trim();

      // Get target customers for segment
      const targetCustomers = await getSegmentCustomers(input.segment);

      // Create campaign
      const [result] = await d.insert(smsCampaigns).values({
        name: cleanName,
        template: input.template,
        segment: input.segment,
        customMessage: input.customMessage || null,
        targetCount: targetCustomers.length,
        status: "draft",
      }).$returningId();

      return { success: true, campaignId: result.id, targetCount: targetCustomers.length };
    }),

  /** Preview campaign messages for a sample of customers */
  preview: adminProcedure
    .input(z.object({
      template: z.enum(["maintenance", "seasonal", "special_offer", "winback"]),
      segment: z.enum(["recent", "lapsed", "all"]),
      customMessage: z.string().max(1600).optional(),
    }))
    .query(async ({ input }) => {
      const targetCustomers = await getSegmentCustomers(input.segment);
      const sampleCustomers = targetCustomers.slice(0, 5);

      // forensic-audit CRITICAL · previously returned only the 5 sample rows.
      // The client derived the send-confirmation count from samples.length,
      // so the dialog read "Send to 5" while send() blasts the ENTIRE
      // segment. Return the true segment size alongside the samples.
      return {
        targetCount: targetCustomers.length,
        samples: sampleCustomers.map(c => ({
          customer: c.firstName,
          phone: c.phone,
          message: withOptOut(
            input.customMessage ||
            CAMPAIGN_TEMPLATES[input.template](c.firstName, input.customMessage)
          ),
        })),
      };
    }),

  /** Send campaign SMS to all target customers (with rate limiting).
   *
   * wave-141a — atomic claim pattern protects against the race condition
   * where two concurrent send clicks (or two Railway instances handling
   * the request) both passed the draft check and double-sent every customer.
   *
   * The fix: encode the draft check inside the UPDATE's WHERE clause and
   * inspect affectedRows. Only one caller wins the claim; the other gets
   * 0 affected rows and bails out cleanly.
   */
  send: adminProcedure
    .input(z.object({
      campaignId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false, error: "Database not available" };

      // Read campaign metadata (template/segment/customMessage). Safe to
      // read without locking — the atomic claim below is the source of truth.
      const [campaign] = await d.select().from(smsCampaigns).where(eq(smsCampaigns.id, input.campaignId));
      if (!campaign) {
        return { success: false, error: "Campaign not found" };
      }
      if (campaign.status !== "draft") {
        return { success: false, error: `Campaign already in '${campaign.status}' state` };
      }

      // Atomic claim — only one caller can transition draft → active.
      // Drizzle/mysql2 returns [ResultSetHeader, FieldPacket[]] for UPDATE;
      // affectedRows=0 means a concurrent caller already won.
      const claimResult = await d.update(smsCampaigns)
        .set({ status: "active", startedAt: new Date() })
        .where(and(
          eq(smsCampaigns.id, input.campaignId),
          eq(smsCampaigns.status, "draft"),
        ));
      const claimedRows = (Array.isArray(claimResult) && claimResult[0] && typeof claimResult[0] === "object"
        ? (claimResult[0] as { affectedRows?: number }).affectedRows
        : (claimResult as { affectedRows?: number }).affectedRows) ?? 0;
      if (claimedRows === 0) {
        return { success: false, error: "Campaign already started by another request" };
      }

      // Get target customers — only the winning claim does this work.
      const targetCustomers = await getSegmentCustomers(campaign.segment as any);

      if (targetCustomers.length === 0) {
        // Roll the claim back to draft so the operator can edit + retry.
        await d.update(smsCampaigns)
          .set({ status: "draft", startedAt: null })
          .where(eq(smsCampaigns.id, input.campaignId));
        return { success: false, error: "No customers in target segment" };
      }

      // Create send records for all customers (batch insert)
      const messageBody = campaign.customMessage ||
        CAMPAIGN_TEMPLATES[campaign.template](
          "{firstName}",
          campaign.customMessage ?? undefined
        );

      const sendRecords = targetCustomers.map(customer => ({
        campaignId: input.campaignId,
        customerId: customer.id,
        phone: customer.phone,
        messageBody: withOptOut(messageBody.replace(/{firstName}/g, customer.firstName)),
        status: "pending" as const,
      }));

      // Batch insert in chunks of 500 to avoid query size limits
      for (let i = 0; i < sendRecords.length; i += 500) {
        const chunk = sendRecords.slice(i, i + 500);
        await d.insert(smsCampaignSends).values(chunk);
      }

      // Start async processing
      processCampaignSends(input.campaignId).catch(err => {
        log.error(`[Campaigns] Error processing campaign ${input.campaignId}:`, err);
      });

      return { success: true, sentCount: 0, totalCount: targetCustomers.length };
    }),

  /** Get recent send activity for a campaign */
  recentSends: adminProcedure
    .input(z.object({
      campaignId: z.number(),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];

      return d.select()
        .from(smsCampaignSends)
        .where(eq(smsCampaignSends.campaignId, input.campaignId))
        .orderBy(desc(smsCampaignSends.createdAt))
        .limit(input.limit);
    }),

  /** Get campaign stats summary */
  stats: adminProcedure.query(async () => {
    const d = await db();
    if (!d) {
      return { totalCampaigns: 0, activeCampaigns: 0, totalSent: 0, totalFailed: 0 };
    }

    const [allCampaigns] = await d.select({ count: sql<number>`count(*)` }).from(smsCampaigns);
    const [activeCampaigns] = await d.select({ count: sql<number>`count(*)` })
      .from(smsCampaigns)
      .where(eq(smsCampaigns.status, "active"));
    const [totalSent] = await d.select({ count: sql<number>`count(*)` })
      .from(smsCampaignSends)
      .where(eq(smsCampaignSends.status, "sent"));
    const [totalFailed] = await d.select({ count: sql<number>`count(*)` })
      .from(smsCampaignSends)
      .where(eq(smsCampaignSends.status, "failed"));

    return {
      totalCampaigns: allCampaigns?.count ?? 0,
      activeCampaigns: activeCampaigns?.count ?? 0,
      totalSent: totalSent?.count ?? 0,
      totalFailed: totalFailed?.count ?? 0,
    };
  }),

  // wave-187 — REMOVED dead pause/resume/cancel/delete/update mutations.
  // None had a UI caller (grep: zero `campaigns.{pause,resume,cancel,delete,update}`
  // in client/), and they wrote enum values the schema rejects: status "paused"/
  // "cancelled" are not in the sms_campaigns enum ["draft","active","completed"]
  // (and "cancelled" is not in smsCampaignSends ["pending","sent","failed"]), plus
  // `update` wrote a non-existent `message` column (real col is customMessage).
  // Latent strict-mode crashes if ever wired. Deleted per kaizen (delete > maintain).
  // The send/resume lifecycle is handled by processCampaignSends + resumeStuckCampaigns.
});

// ─── ASYNC SEND PROCESSING ────────────────────────────
/**
 * Process pending campaign sends with rate limiting.
 * Runs in the background after campaign activation.
 * Respects Twilio rate limits: max 1 SMS per second.
 */
async function processCampaignSends(campaignId: number, batchSize: number = 50): Promise<void> {
  const d = await db();
  if (!d) return;

  // Don't blast while the F25e gateway is offline. Sends would be deferred by
  // sendSms (queued, not delivered) yet the rows are claimed "sent" first —
  // reporting thousands of phantom "sent" on an offline night. Hold instead:
  // leave rows 'pending' and let resumeStuckCampaigns (5-min cron) pick the
  // campaign back up once the gateway returns. Mirrors the bulk-drain gate in
  // sms.ts; skipped when the gateway isn't configured (dev/test send as before).
  if (isShopGatewayConfigured() && !(await isShopGatewayReachable())) {
    log.warn(`[Campaigns] F25e gateway offline — holding campaign ${campaignId}; rows stay pending for resume.`);
    return;
  }

  let totalSent = 0;
  let totalFailed = 0;

  while (true) {
    // Re-check gateway EACH batch: the entry gate only catches an offline
    // start. If F25e dies mid-campaign, stop here — leave remaining rows
    // 'pending' for resumeStuckCampaigns rather than marking phantom 'sent'
    // on sends that sendSms silently queues while offline.
    if (isShopGatewayConfigured() && !(await isShopGatewayReachable())) {
      log.warn(`[Campaigns] F25e gateway offline mid-run — pausing campaign ${campaignId} (${totalSent} sent so far); rest stay pending for resume.`);
      break;
    }
    // Get next batch of pending sends
    const pendingSends = await d.select()
      .from(smsCampaignSends)
      .where(
        and(
          eq(smsCampaignSends.campaignId, campaignId),
          eq(smsCampaignSends.status, "pending")
        )
      )
      .limit(batchSize);

    if (pendingSends.length === 0) break;

    // Process each send with rate limiting
    let batchSent = 0;
    let batchFailed = 0;
    for (const send of pendingSends) {
      // At-most-once claim — flip status 'pending' -> 'sent' BEFORE the
      // send. resumeStuckCampaigns (cron, every 5 min) re-runs this for any
      // campaign with rows still 'pending'; if a crash left a row 'pending'
      // after its text went out, that recovery path re-sends it. Claiming
      // first means a crash leaves the row 'sent' (never reprocessed). The
      // conditional WHERE also blocks two overlapping runs from both
      // sending the same row.
      const claimRes = await d.update(smsCampaignSends)
        .set({ status: "sent", sentAt: new Date() })
        .where(and(eq(smsCampaignSends.id, send.id), eq(smsCampaignSends.status, "pending")));
      if (((claimRes as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) === 0) {
        continue; // already claimed by an overlapping run
      }
      try {
        const result = await sendSms(send.phone, send.messageBody, { via: "shop" });

        if (result.success) {
          await d.update(smsCampaignSends).set({
            twilioSid: result.sid || null,
          }).where(eq(smsCampaignSends.id, send.id));
          batchSent++;
          totalSent++;
        } else {
          await d.update(smsCampaignSends).set({
            status: "failed",
            errorMessage: result.error || "Unknown error",
          }).where(eq(smsCampaignSends.id, send.id));
          batchFailed++;
          totalFailed++;
        }
      } catch (err) {
        log.error(`[Campaigns] Failed to process send ${send.id}:`, err);
        await d.update(smsCampaignSends).set({
          status: "failed",
          errorMessage: String(err),
        }).where(eq(smsCampaignSends.id, send.id));
        batchFailed++;
        totalFailed++;
      }

      // Rate limiting: 1 second delay between sends
      await new Promise(r => setTimeout(r, 1000));
    }

    // Batch update campaign counts once per batch instead of per-send
    if (batchSent > 0) {
      await d.update(smsCampaigns)
        .set({ sentCount: sql`${smsCampaigns.sentCount} + ${batchSent}` })
        .where(eq(smsCampaigns.id, campaignId));
    }
    if (batchFailed > 0) {
      await d.update(smsCampaigns)
        .set({ failedCount: sql`${smsCampaigns.failedCount} + ${batchFailed}` })
        .where(eq(smsCampaigns.id, campaignId));
    }
  }

  // Mark campaign as completed
  await d.update(smsCampaigns).set({
    status: "completed",
    completedAt: new Date(),
  }).where(eq(smsCampaigns.id, campaignId));

  // Dispatch campaign result to NOUR OS (non-blocking)
  const [campaign] = await d.select().from(smsCampaigns).where(eq(smsCampaigns.id, campaignId));
  import("../services/eventBus").then(({ dispatch }) =>
    dispatch("campaign_sent", {
      campaignId,
      sent: totalSent,
      failed: totalFailed,
      campaignType: campaign?.template || "unknown",
    })
  ).catch((e) => { log.warn("[routers/campaigns] fire-and-forget failed:", e); });

  console.info(`[campaigns:done] Campaign ${campaignId} completed: ${totalSent} sent, ${totalFailed} failed`);
}

/**
 * wave-166: recover stuck campaigns abandoned by dyno restart.
 *
 * processCampaignSends() runs in-process. If Railway restarts the dyno
 * mid-campaign (OOM, deploy, health-check failure), the loop dies without
 * completing — the campaign stays status='active' with pending sends rows
 * that nobody ever processes. Real customers never get their SMS.
 *
 * This handler is registered as a cron job (every 5 min). For each active
 * campaign it checks "has any send row been updated in the last 90 seconds?"
 * — if yes, the campaign is in-flight on a live dyno, leave it alone. If
 * no, the campaign is abandoned → resume by calling processCampaignSends.
 *
 * The 90-second heuristic works because processCampaignSends rate-limits
 * to 1 SMS/sec, so any live run will produce a sentAt update at least once
 * per second. A 90-second gap means the loop is dead.
 */
export async function resumeStuckCampaigns(): Promise<{ recordsProcessed: number; details?: string }> {
  const d = await db();
  if (!d) return { recordsProcessed: 0, details: "no db" };

  // Find all campaigns currently in "active" status
  const activeCampaigns = await d.select()
    .from(smsCampaigns)
    .where(eq(smsCampaigns.status, "active"));

  if (activeCampaigns.length === 0) return { recordsProcessed: 0 };

  let resumed = 0;
  const failedCampaigns: number[] = [];
  const NINETY_SECONDS_MS = 90 * 1000;

  for (const campaign of activeCampaigns) {
    // Look for ANY send row touched in the last 90s — sentAt for completed
    // sends, the row updatedAt would also work but we don't have one. Use
    // sentAt because both success + failure paths set sentAt OR errorMessage
    // and we know completed sends always have sentAt populated.
    const [recentActivity] = await d.select({
      latest: sql<Date | null>`MAX(${smsCampaignSends.sentAt})`,
    })
      .from(smsCampaignSends)
      .where(eq(smsCampaignSends.campaignId, campaign.id));

    const latestMs = recentActivity?.latest ? new Date(recentActivity.latest).getTime() : 0;
    const ageMs = Date.now() - latestMs;

    // If activity is fresh (< 90s), assume a live dyno is processing
    if (latestMs > 0 && ageMs < NINETY_SECONDS_MS) continue;

    // Confirm there are still pending rows before resuming. If everything
    // is sent/failed and only the status update is missing, mark complete.
    const [pendingProbe] = await d.select({ c: sql<number>`COUNT(*)` })
      .from(smsCampaignSends)
      .where(
        and(
          eq(smsCampaignSends.campaignId, campaign.id),
          eq(smsCampaignSends.status, "pending")
        )
      );

    const pendingCount = Number(pendingProbe?.c ?? 0);
    if (pendingCount === 0) {
      // No pending rows — the previous run finished sending but died before
      // setting status='completed'. Just close it.
      await d.update(smsCampaigns).set({
        status: "completed",
        completedAt: new Date(),
      }).where(eq(smsCampaigns.id, campaign.id));
      log.info(`[campaigns:resume] Closed abandoned-but-finished campaign ${campaign.id}`);
      resumed++;
      continue;
    }

    // Real resume — pick up where the previous dyno died. processCampaignSends
    // is idempotent at the row level (eq(status, 'pending')) so it will only
    // touch rows the previous dyno never got to.
    log.info(`[campaigns:resume] Resuming campaign ${campaign.id} — ${pendingCount} pending sends, age=${Math.round(ageMs / 1000)}s`);
    try {
      await processCampaignSends(campaign.id);
      resumed++;
    } catch (err) {
      // wave-181.16 · silent-failure audit Finding #4 · was logging
      // + continuing silently. If processCampaignSends consistently
      // fails for one campaign (corrupt row, FK violation, gateway
      // outage), the next 5-min cron tick picks it up + fails the
      // same way forever. Track failures so the cron return reflects
      // partial failure.
      log.error(`[campaigns:resume] Failed to resume campaign ${campaign.id}`, {
        errorId: "CAMPAIGN_RESUME_FAILED",
        campaignId: campaign.id,
        error: err instanceof Error ? err.message : String(err),
      });
      failedCampaigns.push(campaign.id);
    }
  }

  // wave-181.16 · throw so the cron runner writes status='failed'
  // when ANY campaign failed to resume. Operator gets a real signal
  // instead of seeing recordsProcessed=N (where N excludes the failures).
  if (failedCampaigns.length > 0) {
    throw new Error(
      `Failed to resume ${failedCampaigns.length} campaign(s): [${failedCampaigns.join(",")}] · ${resumed} succeeded`,
    );
  }
  return { recordsProcessed: resumed, details: `${resumed} stuck campaigns resumed` };
}
