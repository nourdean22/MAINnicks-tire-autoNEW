/**
 * Win-Back Campaigns router — automated SMS sequences to re-engage lapsed customers.
 *
 * Campaign structure:
 * - Admin creates a campaign targeting a segment (lapsed, unknown, etc.)
 * - System generates a multi-step sequence (e.g., 3 messages over 2 weeks)
 * - Messages are sent via Twilio at scheduled intervals
 * - Admin can preview, pause, and track results
 */
import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq, sql, desc, and, lte, isNull } from "drizzle-orm";
import { customers } from "../../drizzle/schema";
import { winbackCampaigns, winbackMessages, winbackSends } from "../../drizzle/schema";
import { sendSms } from "../sms";
import { STORE_PHONE, STORE_NAME } from "@shared/const";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

// ─── WIN-BACK MESSAGE TEMPLATES ─────────────────────────
const WINBACK_TEMPLATES = {
  lapsed: [
    {
      step: 1,
      delayDays: 0,
      template: `Hi {firstName}, this is ${STORE_NAME}. We noticed it has been a while since your last visit. Your vehicle may be due for maintenance. Call us at ${STORE_PHONE} or book online at nickstire.org — we're here when you need us.`,
    },
    {
      step: 2,
      delayDays: 5,
      template: `Hi {firstName}, just a quick reminder from ${STORE_NAME}. Regular maintenance helps prevent costly breakdowns. We offer free check engine light diagnostics for returning customers. Call ${STORE_PHONE} to schedule.`,
    },
    {
      step: 3,
      delayDays: 12,
      template: `Hi {firstName}, ${STORE_NAME} here. We wanted to make sure your vehicle is running safely. Whether it is an oil change, brakes, or a check engine light, our technicians are ready to help. Book at nickstire.org or call ${STORE_PHONE}.`,
    },
  ],
  unknown: [
    {
      step: 1,
      delayDays: 0,
      template: `Hi {firstName}, this is ${STORE_NAME} in Cleveland. We have your vehicle on file and wanted to check in. If your car needs any service, we are here to help. Call ${STORE_PHONE} or visit nickstire.org.`,
    },
    {
      step: 2,
      delayDays: 7,
      template: `Hi {firstName}, ${STORE_NAME} here. Spring is a great time for a vehicle checkup — brakes, tires, and fluids. We offer honest diagnostics at fair prices. Call ${STORE_PHONE} to schedule.`,
    },
  ],
  recent: [
    {
      step: 1,
      delayDays: 0,
      template: `Hi {firstName}, thank you for being a loyal customer at ${STORE_NAME}. As a valued customer, we wanted to let you know about our current specials. Visit nickstire.org/specials or call ${STORE_PHONE}.`,
    },
  ],
};

export const winbackRouter = router({
  /** List all campaigns */
  campaigns: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];
    return d.select().from(winbackCampaigns).orderBy(desc(winbackCampaigns.createdAt));
  }),

  /** Get campaign details with message steps and send stats */
  campaignDetail: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return null;

      const [campaign] = await d.select().from(winbackCampaigns).where(eq(winbackCampaigns.id, input.id));
      if (!campaign) return null;

      const messages = await d.select().from(winbackMessages)
        .where(eq(winbackMessages.campaignId, input.id))
        .orderBy(winbackMessages.step);

      // Get send stats per step
      const stats = await d.select({
        step: winbackSends.step,
        total: sql<number>`count(*)`,
        sent: sql<number>`sum(case when ${winbackSends.status} = 'sent' then 1 else 0 end)`,
        failed: sql<number>`sum(case when ${winbackSends.status} = 'failed' then 1 else 0 end)`,
        pending: sql<number>`sum(case when ${winbackSends.status} = 'pending' then 1 else 0 end)`,
      })
        .from(winbackSends)
        .where(eq(winbackSends.campaignId, input.id))
        .groupBy(winbackSends.step);

      return { campaign, messages, stats };
    }),

  /** Get campaign send stats summary */
  campaignStats: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { totalCampaigns: 0, totalSent: 0, totalFailed: 0, totalPending: 0, activeCampaigns: 0 };

    const [campaigns] = await d.select({ count: sql<number>`count(*)` }).from(winbackCampaigns);
    const [active] = await d.select({ count: sql<number>`count(*)` }).from(winbackCampaigns).where(eq(winbackCampaigns.status, "active"));
    const [sent] = await d.select({ count: sql<number>`count(*)` }).from(winbackSends).where(eq(winbackSends.status, "sent"));
    const [failed] = await d.select({ count: sql<number>`count(*)` }).from(winbackSends).where(eq(winbackSends.status, "failed"));
    const [pending] = await d.select({ count: sql<number>`count(*)` }).from(winbackSends).where(eq(winbackSends.status, "pending"));

    return {
      totalCampaigns: campaigns?.count ?? 0,
      activeCampaigns: active?.count ?? 0,
      totalSent: sent?.count ?? 0,
      totalFailed: failed?.count ?? 0,
      totalPending: pending?.count ?? 0,
    };
  }),

  /** Create a new win-back campaign */
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      targetSegment: z.enum(["lapsed", "unknown", "recent"]),
      customMessages: z.array(z.object({
        step: z.number(),
        delayDays: z.number(),
        body: z.string(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false, error: "Database not available" };

      const cleanName = input.name.replace(/<[^>]*>/g, "").trim();

      // Count target customers
      const [targetCount] = await d.select({ count: sql<number>`count(*)` })
        .from(customers)
        .where(eq(customers.segment, input.targetSegment));

      // Create campaign
      const [result] = await d.insert(winbackCampaigns).values({
        name: cleanName,
        targetSegment: input.targetSegment,
        targetCount: targetCount?.count ?? 0,
        status: "draft",
      }).$returningId();

      const campaignId = result.id;

      // Create message steps
      const customMsgs = input.customMessages;
      if (customMsgs) {
        for (const tmpl of customMsgs) {
          await d.insert(winbackMessages).values({
            campaignId,
            step: tmpl.step,
            delayDays: tmpl.delayDays,
            body: tmpl.body,
          });
        }
      } else {
        const defaults = WINBACK_TEMPLATES[input.targetSegment] || WINBACK_TEMPLATES.lapsed;
        for (const tmpl of defaults) {
          await d.insert(winbackMessages).values({
            campaignId,
            step: tmpl.step,
            delayDays: tmpl.delayDays,
            body: tmpl.template,
          });
        }
      }

      return { success: true, campaignId };
    }),

  /** Preview messages for a campaign (shows first 5 customers with personalized text) */
  preview: adminProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];

      const [campaign] = await d.select().from(winbackCampaigns).where(eq(winbackCampaigns.id, input.campaignId));
      if (!campaign) return [];

      const messages = await d.select().from(winbackMessages)
        .where(eq(winbackMessages.campaignId, input.campaignId))
        .orderBy(winbackMessages.step);

      const sampleCustomers = await d.select()
        .from(customers)
        .where(eq(customers.segment, campaign.targetSegment as any))
        .limit(5);

      return sampleCustomers.map((c: any) => ({
        customer: `${c.firstName} ${c.lastName || ""}`.trim(),
        phone: c.phone,
        messages: messages.map((m: any) => ({
          step: m.step,
          delayDays: m.delayDays,
          body: m.body.replace(/{firstName}/g, c.firstName),
        })),
      }));
    }),

  /** Activate a campaign — creates send records for all target customers */
  activate: adminProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false, error: "Database not available" };

      const [campaign] = await d.select().from(winbackCampaigns).where(eq(winbackCampaigns.id, input.campaignId));
      if (!campaign || campaign.status !== "draft") {
        return { success: false, error: "Campaign not found or not in draft status" };
      }

      const messages = await d.select().from(winbackMessages)
        .where(eq(winbackMessages.campaignId, input.campaignId))
        .orderBy(winbackMessages.step);

      // Get all target customers
      const targetCustomers = await d.select()
        .from(customers)
        .where(eq(customers.segment, campaign.targetSegment as any));

      const now = new Date();
      let created = 0;

      // Create send records for each customer × each message step
      for (const customer of targetCustomers) {
        for (const msg of messages) {
          const scheduledAt = new Date(now.getTime() + msg.delayDays * 24 * 60 * 60 * 1000);
          await d.insert(winbackSends).values({
            campaignId: input.campaignId,
            customerId: customer.id,
            messageId: msg.id,
            step: msg.step,
            phone: customer.phone,
            personalizedBody: msg.body.replace(/{firstName}/g, customer.firstName),
            scheduledAt,
            status: "pending",
          });
          created++;
        }
      }

      // Update campaign status
      await d.update(winbackCampaigns).set({
        status: "active",
        activatedAt: now,
        sentCount: 0,
      }).where(eq(winbackCampaigns.id, input.campaignId));

      return { success: true, sendsCreated: created };
    }),

  /** Pause a campaign */
  pause: adminProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false };
      await d.update(winbackCampaigns).set({ status: "paused" }).where(eq(winbackCampaigns.id, input.campaignId));
      return { success: true };
    }),

  /** Resume a paused campaign */
  resume: adminProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false };
      await d.update(winbackCampaigns).set({ status: "active" }).where(eq(winbackCampaigns.id, input.campaignId));
      return { success: true };
    }),

  /** Process pending sends — called by cron/scheduler to actually send SMS */
  processPending: adminProcedure.mutation(async () => {
    const d = await db();
    if (!d) return { processed: 0, sent: 0, failed: 0 };

    const now = new Date();

    // Get pending sends that are due and belong to active campaigns
    const pendingSends = await d.select({
      send: winbackSends,
      campaignStatus: winbackCampaigns.status,
    })
      .from(winbackSends)
      .innerJoin(winbackCampaigns, eq(winbackSends.campaignId, winbackCampaigns.id))
      .where(
        and(
          eq(winbackSends.status, "pending"),
          lte(winbackSends.scheduledAt, now),
          eq(winbackCampaigns.status, "active"),
        )
      )
      .limit(50); // Process in batches of 50

    let sent = 0;
    let failed = 0;

    for (const { send } of pendingSends) {
      const result = await sendSms(send.phone, send.personalizedBody);

      if (result.success) {
        await d.update(winbackSends).set({
          status: "sent",
          sentAt: new Date(),
          twilioSid: result.sid,
        }).where(eq(winbackSends.id, send.id));

        // Update campaign sent count
        await d.execute(sql`UPDATE winback_campaigns SET sentCount = sentCount + 1 WHERE id = ${send.campaignId}`);
        sent++;
      } else {
        await d.update(winbackSends).set({
          status: "failed",
          errorMessage: result.error,
        }).where(eq(winbackSends.id, send.id));
        failed++;
      }
    }

    return { processed: pendingSends.length, sent, failed };
  }),

  /** Get recent send activity for a campaign */
  recentSends: adminProcedure
    .input(z.object({ campaignId: z.number(), limit: z.number().default(20) }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];
      return d.select()
        .from(winbackSends)
        .where(eq(winbackSends.campaignId, input.campaignId))
        .orderBy(desc(winbackSends.createdAt))
        .limit(input.limit);
    }),
});
