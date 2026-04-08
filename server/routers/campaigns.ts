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
import { sendSms } from "../sms";
import { STORE_PHONE, STORE_NAME } from "@shared/const";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

// ─── CAMPAIGN TEMPLATES ────────────────────────────────

const CAMPAIGN_TEMPLATES: Record<string, (name: string, customMessage?: string) => string> = {
  maintenance: (firstName: string) =>
    `Hi ${firstName}, it's been a while! Your vehicle may be due for maintenance. Schedule at Nick's Tire: (216) 862-0005`,

  seasonal: (firstName: string) =>
    `Winter's coming! Get your tires checked before the snow hits. Nick's Tire: (216) 862-0005`,

  special_offer: (firstName: string, offer?: string) =>
    `Exclusive for our customers: ${offer || "10% off your next visit"}. Call Nick's Tire: (216) 862-0005`,

  winback: (firstName: string) =>
    `We miss you at Nick's Tire! Come back for 10% off your next visit. (216) 862-0005`,
};

// ─── GET CUSTOMERS BY SEGMENT ──────────────────────────

async function getSegmentCustomers(segment: "recent" | "lapsed" | "all"): Promise<Array<{ id: number; firstName: string; phone: string }>> {
  const d = await db();
  if (!d) return [];

  const phoneFilter = sql`${customers.phone} IS NOT NULL AND LENGTH(${customers.phone}) >= 10 AND ${customers.smsOptOut} = 0`;

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

      return sampleCustomers.map(c => ({
        customer: c.firstName,
        phone: c.phone,
        message:
          input.customMessage ||
          CAMPAIGN_TEMPLATES[input.template](c.firstName, input.customMessage),
      }));
    }),

  /** Send campaign SMS to all target customers (with rate limiting) */
  send: adminProcedure
    .input(z.object({
      campaignId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false, error: "Database not available" };

      // Get campaign
      const [campaign] = await d.select().from(smsCampaigns).where(eq(smsCampaigns.id, input.campaignId));
      if (!campaign || campaign.status !== "draft") {
        return { success: false, error: "Campaign not found or not in draft status" };
      }

      // Get target customers
      const targetCustomers = await getSegmentCustomers(campaign.segment as any);

      if (targetCustomers.length === 0) {
        return { success: false, error: "No customers in target segment" };
      }

      // Update campaign to active
      await d.update(smsCampaigns)
        .set({ status: "active", startedAt: new Date() })
        .where(eq(smsCampaigns.id, input.campaignId));

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
        messageBody: messageBody.replace(/{firstName}/g, customer.firstName),
        status: "pending" as const,
      }));

      // Batch insert in chunks of 500 to avoid query size limits
      for (let i = 0; i < sendRecords.length; i += 500) {
        const chunk = sendRecords.slice(i, i + 500);
        await d.insert(smsCampaignSends).values(chunk);
      }

      // Start async processing
      processCampaignSends(input.campaignId).catch(err => {
        console.error(`[Campaigns] Error processing campaign ${input.campaignId}:`, err);
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

  let totalSent = 0;
  let totalFailed = 0;

  while (true) {
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
      try {
        const result = await sendSms(send.phone, send.messageBody);

        if (result.success) {
          await d.update(smsCampaignSends).set({
            status: "sent",
            sentAt: new Date(),
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
        console.error(`[Campaigns] Failed to process send ${send.id}:`, err);
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
  ).catch(() => {});

  console.info(`[campaigns:done] Campaign ${campaignId} completed: ${totalSent} sent, ${totalFailed} failed`);
}
