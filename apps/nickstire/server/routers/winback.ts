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

import { db } from "../lib/db-helper";

// ─── WIN-BACK MESSAGE TEMPLATES ─────────────────────────
// Selectable segments: lapsed, dormant, lost, vip, fleet, recent.
// (declined + tire_customer are RETIRED — see the notes below / in buildSegmentFilter.)
// Each segment targets a different customer profile with personalized messaging.
// Templates use {firstName}, {lastService}, {vehicleInfo} for personalization.
const WINBACK_TEMPLATES: Record<string, { step: number; delayDays: number; template: string }[]> = {
  // ── LAPSED (90-180 days, was active) — 4-step sequence ──
  lapsed: [
    {
      step: 1, delayDays: 0,
      template: `Hi {firstName}, this is ${STORE_NAME}. It's been a while since we last worked on your {vehicleInfo}. Your vehicle may be due for maintenance — car problems rarely stay the same, they usually get worse. Drop by or call ${STORE_PHONE}. No appointment needed.`,
    },
    {
      step: 2, delayDays: 4,
      template: `{firstName}, quick follow-up from ${STORE_NAME}. We checked our records — last time you were in for {lastService}. It might be time for a follow-up check. We'll do a free inspection under 1 hour. Drop off your car, call an Uber out, we'll call when it's done. ${STORE_PHONE}`,
    },
    {
      step: 3, delayDays: 10,
      template: `{firstName}, this is Nick from ${STORE_NAME}. Haven't heard back — just want to make sure your {vehicleInfo} is running right. We've seen a lot of {lastService} issues turn into bigger problems when left too long. Free diagnostic if you come in this week. ${STORE_PHONE}`,
    },
    {
      step: 4, delayDays: 21,
      template: `Last check-in, {firstName}. ${STORE_NAME} — we're here 7 days a week, no appointment needed. If your car is giving you any trouble, don't wait. Drop it off early, we'll get to it same day. ${STORE_PHONE} or book at nickstire.org`,
    },
  ],

  // ── DORMANT (180-365 days) — 3-step, more urgency ──
  dormant: [
    {
      step: 1, delayDays: 0,
      template: `Hi {firstName}, ${STORE_NAME} here. It's been over 6 months since your last visit. Your {vehicleInfo} is overdue for a checkup. We're offering a free safety inspection for returning customers — no strings. Drop by or call ${STORE_PHONE}.`,
    },
    {
      step: 2, delayDays: 7,
      template: `{firstName}, the longer you wait on maintenance, the more expensive it gets. We've seen $200 brake jobs turn into $800 rotor replacements. Let us catch it early. Free inspection, 7 days a week. ${STORE_PHONE}`,
    },
    {
      step: 3, delayDays: 14,
      template: `{firstName}, last message from ${STORE_NAME}. If you've found another shop, no hard feelings. But if you haven't — we're still here, still honest, still fast. 4.9 stars, 1700+ reviews. ${STORE_PHONE}`,
    },
  ],

  // ── LOST (365+ days) — 2-step, re-introduction ──
  lost: [
    {
      step: 1, delayDays: 0,
      template: `Hi {firstName}, this is ${STORE_NAME} — Nick's Tire & Auto at 17625 Euclid Ave. It's been over a year since your last visit. A lot has changed — new equipment, faster service, same honest pricing. Come see what's new. ${STORE_PHONE}`,
    },
    {
      step: 2, delayDays: 10,
      template: `{firstName}, we're offering 10% off your first service back at ${STORE_NAME}. Tires, brakes, oil change — whatever your {vehicleInfo} needs. No appointment, just drop in. ${STORE_PHONE}`,
    },
  ],

  // ── DECLINED WORK (had an estimate, didn't convert) — 3-step ──
  declined: [
    {
      step: 1, delayDays: 0,
      template: `Hi {firstName}, ${STORE_NAME} here. We gave you an estimate for {lastService} on your {vehicleInfo}. Just checking — did you get it taken care of? If not, that estimate is still valid. ${STORE_PHONE}`,
    },
    {
      step: 2, delayDays: 7,
      template: `{firstName}, car problems rarely fix themselves. The {lastService} we quoted you on could get worse (and more expensive) with time. We offer $10 down financing if cost was the concern. ${STORE_PHONE}`,
    },
    {
      step: 3, delayDays: 21,
      template: `{firstName}, final reminder from ${STORE_NAME}. Your {lastService} estimate expires in 7 days. After that, we'd need to re-inspect. Book now at nickstire.org or call ${STORE_PHONE}. We're open 7 days.`,
    },
  ],

  // ── TIRE CUSTOMERS — RETIRED. The segment had no tire signal (filter was
  //    just lastVisitDate < 90d), so "you got tires from us" went to people
  //    who never bought tires. Removed from the targetSegment enum +
  //    buildSegmentFilter; the template is gone so it can't be revived by name.

  // ── VIP / HIGH-VALUE — 2-step, exclusive tone ──
  vip: [
    {
      step: 1, delayDays: 0,
      template: `{firstName}, this is Nick personally from ${STORE_NAME}. You're one of our top customers and we haven't seen you in a while. Everything good with your {vehicleInfo}? If anything comes up, you get priority — call me direct at ${STORE_PHONE}.`,
    },
    {
      step: 2, delayDays: 10,
      template: `{firstName}, just a heads up — we're offering our VIP customers early access to winter tire deals before the rush. Limited stock on popular sizes. Let me know if you want us to set a set aside. ${STORE_PHONE}`,
    },
  ],

  // ── FLEET / COMMERCIAL — 2-step, business tone ──
  fleet: [
    {
      step: 1, delayDays: 0,
      template: `Hi {firstName}, ${STORE_NAME} fleet services here. We service commercial vehicles 7 days a week with priority scheduling for business accounts. If your fleet needs maintenance, call ${STORE_PHONE} for fleet pricing.`,
    },
    {
      step: 2, delayDays: 7,
      template: `{firstName}, fleet downtime costs money. ${STORE_NAME} offers same-day service for commercial accounts — tires, brakes, diagnostics, emissions. Let's set up a maintenance schedule. ${STORE_PHONE}`,
    },
  ],

  // ── RECENT (30-90 days) — 1 message, light touch ──
  recent: [
    {
      step: 1, delayDays: 0,
      template: `Hi {firstName}, thanks for choosing ${STORE_NAME}! As a valued customer, you get priority service — no appointment needed, just drop in. If your {vehicleInfo} needs anything, we're here 7 days a week. ${STORE_PHONE}`,
    },
  ],
};

/**
 * Build a SQL WHERE filter for each customer segment.
 * Uses date-based logic instead of the limited DB enum.
 */
function buildSegmentFilter(segment: string) {
  const now = new Date();
  const d90 = new Date(now.getTime() - 90 * 86400000);
  const d180 = new Date(now.getTime() - 180 * 86400000);
  const d365 = new Date(now.getTime() - 365 * 86400000);
  const d30 = new Date(now.getTime() - 30 * 86400000);

  switch (segment) {
    case "lapsed":
      return and(
        sql`${customers.lastVisitDate} IS NOT NULL`,
        sql`${customers.lastVisitDate} < ${d90}`,
        sql`${customers.lastVisitDate} >= ${d180}`,
        eq(customers.smsOptOut, 0)
      )!;
    case "dormant":
      return and(
        sql`${customers.lastVisitDate} IS NOT NULL`,
        sql`${customers.lastVisitDate} < ${d180}`,
        sql`${customers.lastVisitDate} >= ${d365}`,
        eq(customers.smsOptOut, 0)
      )!;
    case "lost":
      return and(
        sql`${customers.lastVisitDate} IS NOT NULL`,
        sql`${customers.lastVisitDate} < ${d365}`,
        eq(customers.smsOptOut, 0)
      )!;
    // wave-150 · "declined" winback segment RETIRED. It targeted
    // customers.segment='lapsed' (wrong people), and repointing it to the
    // alg_estimates declined pool would DOUBLE-TEXT the declined-recovery
    // cron (50/day · FEATURE_DECLINED_RECOVERY), which now owns that pool.
    // Removed from the targetSegment enum; any legacy "declined" campaign
    // falls to the default below → segment='declined' matches ~0 rows (safe).
    // "tire_customer" winback segment RETIRED for the same reason class.
    // It had ZERO tire signal — the filter was just lastVisitDate < 90d, so
    // it texted "you got tires from us" to anyone who'd visited recently
    // (most of whom never bought tires) — a false claim. Removed from the
    // targetSegment enum; any legacy "tire_customer" campaign falls to the
    // default below → segment='tire_customer' matches ~0 rows (safe).
    case "vip":
      // totalSpent is stored in CENTS. VIP = lifetime spend > $2,000 (200000c).
      // (Was `> 500` = >$5, which matched nearly the entire paying base.)
      return and(
        sql`${customers.totalSpent} > 200000`,
        eq(customers.smsOptOut, 0)
      )!;
    case "fleet":
      // CENTS. Fleet = lifetime spend > $5,000 (500000c).
      // (Was `> 1000` = >$10.)
      return and(
        sql`${customers.totalSpent} > 500000`,
        eq(customers.smsOptOut, 0)
      )!;
    case "recent":
      return and(
        sql`${customers.lastVisitDate} >= ${d30}`,
        sql`${customers.lastVisitDate} < ${d90}`,
        eq(customers.smsOptOut, 0)
      )!;
    default:
      return and(eq(customers.segment, segment as "recent" | "lapsed" | "new" | "unknown"), eq(customers.smsOptOut, 0))!;
  }
}

export const winbackRouter = router({
  /** List all campaigns */
  campaigns: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];
    return d.select().from(winbackCampaigns).orderBy(desc(winbackCampaigns.createdAt)).limit(100);
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
      targetSegment: z.enum(["lapsed", "dormant", "lost", "vip", "fleet", "recent"]),
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

      // Count target customers — smart filter by segment type
      const segmentFilter = buildSegmentFilter(input.targetSegment);
      const [targetCount] = await d.select({ count: sql<number>`count(*)` })
        .from(customers)
        .where(segmentFilter);

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
        .where(buildSegmentFilter(campaign.targetSegment))
        .limit(5);

      type SampleCustomer = typeof customers.$inferSelect;
      type WinbackMessageRow = typeof winbackMessages.$inferSelect;
      return sampleCustomers.map((c: SampleCustomer) => ({
        customer: `${c.firstName} ${c.lastName || ""}`.trim(),
        phone: c.phone,
        messages: messages.map((m: WinbackMessageRow) => ({
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

      // Get all target customers (exclude SMS opt-outs — TCPA compliance).
      // wave-142b — defensive .limit(10_000) cap. The 'lost' segment can
      // be thousands of rows; without a cap an admin could accidentally
      // load 50K+ customers into Node memory + queue 50K×N message
      // inserts. 10K is generous (any larger campaign should be split).
      const targetCustomers = await d.select()
        .from(customers)
        .where(buildSegmentFilter(campaign.targetSegment))
        .limit(10_000);

      const now = new Date();
      let created = 0;

      // wave-142b — was N×M individual inserts (one per customer × message).
      // For 5K customers × 3 messages that's 15K round-trips. Now batched
      // 500 rows per insert, ~30 round-trips for the same workload.
      const sendRecords: typeof winbackSends.$inferInsert[] = [];
      for (const customer of targetCustomers) {
        for (const msg of messages) {
          const scheduledAt = new Date(now.getTime() + msg.delayDays * 24 * 60 * 60 * 1000);
          sendRecords.push({
            campaignId: input.campaignId,
            customerId: customer.id,
            messageId: msg.id,
            step: msg.step,
            phone: customer.phone,
            personalizedBody: msg.body.replace(/{firstName}/g, customer.firstName),
            scheduledAt,
            status: "pending",
          });
        }
      }

      // Batch insert in chunks of 500 to stay under MySQL query size cap
      for (let i = 0; i < sendRecords.length; i += 500) {
        const chunk = sendRecords.slice(i, i + 500);
        if (chunk.length > 0) {
          await d.insert(winbackSends).values(chunk);
          created += chunk.length;
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

  /** Process pending winback sends — admin-triggered. The automatic cron
   *  path uses services/winbackProcessor.ts (claim-then-send + opt-out). */
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
      // Opt-out guard — winback_sends carries customerId; resolve opt-out
      // by exact id. Opted-out rows are marked 'failed' so they leave the
      // pending pool permanently.
      const [optRows] = await d.execute(sql`SELECT smsOptOut FROM customers WHERE id = ${send.customerId} LIMIT 1`);
      if (!!((optRows as unknown as Array<{ smsOptOut?: number }>)[0]?.smsOptOut)) {
        await d.update(winbackSends).set({ status: "failed", errorMessage: "customer opted out of SMS" }).where(eq(winbackSends.id, send.id));
        failed++;
        continue;
      }

      // At-most-once claim — flip pending -> sent BEFORE the send so a
      // crash can't leave the row 'pending' for the winbackProcessor cron
      // to re-send. Conditional WHERE blocks a concurrent run too.
      const [claimRes] = await d.execute(sql`UPDATE winback_sends SET status = 'sent', sentAt = NOW() WHERE id = ${send.id} AND status = 'pending'`);
      if (((claimRes as unknown as { affectedRows?: number }).affectedRows ?? 0) === 0) {
        continue; // already claimed
      }

      const result = await sendSms(send.phone, send.personalizedBody, { via: "shop" });

      if (result.success) {
        await d.update(winbackSends).set({
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
