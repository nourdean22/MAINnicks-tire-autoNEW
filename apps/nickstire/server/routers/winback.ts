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
import { customers, invoices, tireOrders, serviceHistory } from "../../drizzle/schema";
import { winbackCampaigns, winbackMessages, winbackSends } from "../../drizzle/schema";
import { sendSms, withOptOut } from "../sms";
import { STORE_PHONE, STORE_NAME } from "@shared/const";

import { db } from "../lib/db-helper";

/**
 * Centrally verify which customer IDs have a verified tire purchase history.
 * Checks:
 * 1. Invoices containing 'tire'/'tires' keywords without repair/rotation/flat/patch/plug/balance/mount exclusions.
 * 2. Tire orders where paymentStatus is 'paid' or status is not 'cancelled'/'received' (meaning in-progress or completed).
 */
export async function getVerifiedTirePurchaseCustomerIds(d: any, customerIds: number[]): Promise<Set<number>> {
  const verifiedIds = new Set<number>();
  if (customerIds.length === 0) return verifiedIds;

  for (let i = 0; i < customerIds.length; i += 1000) {
    const chunk = customerIds.slice(i, i + 1000);

    // 1. Query invoices
    const invoiceRows = await d
      .select({ customerId: invoices.customerId })
      .from(invoices)
      .where(
        and(
          sql`${invoices.customerId} IN (${sql.join(chunk)})`,
          sql`(${invoices.serviceDescription} LIKE '%tire%' OR ${invoices.serviceDescription} LIKE '%tires%')`,
          sql`${invoices.serviceDescription} NOT LIKE '%repair%'`,
          sql`${invoices.serviceDescription} NOT LIKE '%rotation%'`,
          sql`${invoices.serviceDescription} NOT LIKE '%rotate%'`,
          sql`${invoices.serviceDescription} NOT LIKE '%flat%'`,
          sql`${invoices.serviceDescription} NOT LIKE '%patch%'`,
          sql`${invoices.serviceDescription} NOT LIKE '%plug%'`,
          sql`${invoices.serviceDescription} NOT LIKE '%balance%'`,
          sql`${invoices.serviceDescription} NOT LIKE '%mount%'`
        )
      );
    for (const r of invoiceRows) {
      if (r.customerId !== null) {
        verifiedIds.add(r.customerId);
      }
    }

    // 2. Query tire_orders
    const orderRows = await d
      .select({ customerId: tireOrders.customerId })
      .from(tireOrders)
      .where(
        and(
          sql`${tireOrders.customerId} IN (${sql.join(chunk)})`,
          sql`(${tireOrders.paymentStatus} = 'paid' OR ${tireOrders.status} NOT IN ('cancelled', 'received'))`
        )
      );
    for (const r of orderRows) {
      if (r.customerId !== null) {
        verifiedIds.add(r.customerId);
      }
    }

    // 3. Query serviceHistory
    const serviceHistoryRows = await d
      .select({ userId: serviceHistory.userId })
      .from(serviceHistory)
      .where(
        and(
          sql`${serviceHistory.userId} IN (${sql.join(chunk)})`,
          sql`(${serviceHistory.serviceType} LIKE '%tire%' OR ${serviceHistory.serviceType} LIKE '%tires%' OR ${serviceHistory.description} LIKE '%tire%' OR ${serviceHistory.description} LIKE '%tires%')`,
          sql`${serviceHistory.serviceType} NOT LIKE '%repair%'`,
          sql`${serviceHistory.serviceType} NOT LIKE '%rotation%'`,
          sql`${serviceHistory.serviceType} NOT LIKE '%rotate%'`,
          sql`${serviceHistory.serviceType} NOT LIKE '%flat%'`,
          sql`${serviceHistory.serviceType} NOT LIKE '%patch%'`,
          sql`${serviceHistory.serviceType} NOT LIKE '%plug%'`,
          sql`${serviceHistory.serviceType} NOT LIKE '%balance%'`,
          sql`${serviceHistory.serviceType} NOT LIKE '%mount%'`,
          sql`(${serviceHistory.description} IS NULL OR (
            ${serviceHistory.description} NOT LIKE '%repair%'
            AND ${serviceHistory.description} NOT LIKE '%rotation%'
            AND ${serviceHistory.description} NOT LIKE '%rotate%'
            AND ${serviceHistory.description} NOT LIKE '%flat%'
            AND ${serviceHistory.description} NOT LIKE '%patch%'
            AND ${serviceHistory.description} NOT LIKE '%plug%'
            AND ${serviceHistory.description} NOT LIKE '%balance%'
            AND ${serviceHistory.description} NOT LIKE '%mount%'
          ))`
        )
      );
    for (const r of serviceHistoryRows) {
      if (r.userId !== null) {
        verifiedIds.add(r.userId);
      }
    }
  }

  return verifiedIds;
}

// ─── WIN-BACK MESSAGE TEMPLATES ─────────────────────────
// Selectable segments: lapsed, dormant, lost, declined, vip, fleet, recent, tire_customer.
// Each segment targets a different customer profile with personalized messaging.
// wave-182: default templates are now placeholder-free (business voice — no
// {firstName}/{vehicleInfo}, per the no-personalization directive). Each message
// is concrete, low-pressure, kill-list-clean, and carries no planted negatives.
// personalizeWinbackBody() still substitutes those tokens IF an operator's custom
// message includes them, and wraps every send in the TCPA "Reply STOP" footer.
const WINBACK_TEMPLATES: Record<string, { step: number; delayDays: number; template: string }[]> = {
  // ── LAPSED (90-180 days, was active) — 4-step sequence ──
  lapsed: [
    {
      step: 1, delayDays: 0,
      template: `It's been a while since your last visit to ${STORE_NAME}. Due for an oil change or a once-over? Walk in any day — first-come, first-served, no appointment. $49 conventional, $80 synthetic. ${STORE_PHONE}`,
    },
    {
      step: 2, delayDays: 4,
      template: `Still here at ${STORE_NAME} whenever it's easy. Drop it off any morning for a free check — written quote, you don't pay until you say yes — and we'll reach out when it's ready. ${STORE_PHONE}`,
    },
    {
      step: 3, delayDays: 10,
      template: `${STORE_NAME} — open 7 days, walk-ins welcome. A free check tells you exactly what's going on with the car, no charge and no obligation. Pull up any day. ${STORE_PHONE}`,
    },
    {
      step: 4, delayDays: 21,
      template: `Last note from ${STORE_NAME} for now — we're here 7 days a week, no appointment. Walk in or drop off any time and we'll take care of you. ${STORE_PHONE} or nickstire.org`,
    },
  ],

  // ── DORMANT (180-365 days) — 3-step, more urgency ──
  dormant: [
    {
      step: 1, delayDays: 0,
      template: `It's been a while since ${STORE_NAME} saw you. A free check is the easy way to see where the car stands — written quote, you don't pay until you say yes. Walk in any day. ${STORE_PHONE}`,
    },
    {
      step: 2, delayDays: 7,
      template: `Still 7 days a week at ${STORE_NAME}, walk-ins welcome. Whenever you want a second set of eyes on the car, the check is free and the quote's in writing. ${STORE_PHONE}`,
    },
    {
      step: 3, delayDays: 14,
      template: `Last message from ${STORE_NAME} for now. If you've found another shop, all good. If not — we're here, 4.9 stars from 1,700+ Cleveland drivers. Walk in any day. ${STORE_PHONE}`,
    },
  ],

  // ── LOST (365+ days) — 2-step, re-introduction ──
  lost: [
    {
      step: 1, delayDays: 0,
      template: `It's been over a year since your last visit to ${STORE_NAME}, 17625 Euclid Ave. Same fair pricing, walk in any day — first-come, first-served. ${STORE_PHONE}`,
    },
    {
      step: 2, delayDays: 10,
      template: `Come back to ${STORE_NAME} and take 10% off your first service — tires, brakes, oil, whatever the car needs. No appointment, just drop in. ${STORE_PHONE}`,
    },
  ],

  // ── DECLINED WORK (had an estimate, didn't convert) — 3-step ──
  declined: [
    {
      step: 1, delayDays: 0,
      template: `${STORE_NAME} — that estimate we wrote up is still good. Free re-check whenever you're ready, written quote, you don't pay until you say yes. ${STORE_PHONE}`,
    },
    {
      step: 2, delayDays: 7,
      template: `Still here at ${STORE_NAME}. If cost was the holdup on that estimate, $10 down splits it across 4 lenders. Free re-check first, no charge. ${STORE_PHONE}`,
    },
    {
      step: 3, delayDays: 21,
      template: `Last note on that estimate from ${STORE_NAME} — stop in within the week and we'll honor it as-is. After that we'd just re-check, still free. nickstire.org or ${STORE_PHONE}`,
    },
  ],

  // ── TIRE CUSTOMERS — 2-step sequence ──
  // Targets customers who bought tires in the past (visit > 180 days ago) to prompt free rotation.
  tire_customer: [
    {
      step: 1, delayDays: 0,
      template: `It's been 6 months since your tire service at ${STORE_NAME}. Tires should be rotated every 5,000 miles to keep the wear even and get the most life out of them. Pull up any day for a free tire rotation. ${STORE_PHONE}`,
    },
    {
      step: 2, delayDays: 7,
      template: `Still here at ${STORE_NAME} whenever you're ready for that free tire rotation. No appointment needed, open 7 days. ${STORE_PHONE} or nickstire.org`,
    },
  ],

  // ── VIP / HIGH-VALUE — 2-step, exclusive tone ──
  vip: [
    {
      step: 1, delayDays: 0,
      template: `You're one of our top customers at ${STORE_NAME} and we haven't seen you in a while. Whenever the car needs anything, you get priority — walk in any day or call ${STORE_PHONE}.`,
    },
    {
      step: 2, delayDays: 10,
      template: `Heads up for our VIP customers — winter tire deals are landing before the rush, limited stock on popular sizes. Want us to hold a set for you? ${STORE_PHONE}`,
    },
  ],

  // ── FLEET / COMMERCIAL — 2-step, business tone ──
  fleet: [
    {
      step: 1, delayDays: 0,
      template: `${STORE_NAME} runs fleet and commercial accounts 7 days a week with priority scheduling. Whenever your vehicles need work, call ${STORE_PHONE} for fleet pricing.`,
    },
    {
      step: 2, delayDays: 7,
      template: `Fleet downtime adds up. ${STORE_NAME} keeps commercial accounts moving — tires, brakes, check-engine, emissions, all under one roof. Let's set up a schedule. ${STORE_PHONE}`,
    },
  ],

  // ── RECENT (30-90 days) — 1 message, light touch ──
  recent: [
    {
      step: 1, delayDays: 0,
      template: `Thanks for coming by ${STORE_NAME}. Walk-ins are always welcome 7 days a week — whenever the car needs anything, just pull up. ${STORE_PHONE}`,
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
    case "tire_customer":
      // tire_customer is revived only when invoice/service evidence proves prior tire purchase (excluding repair/rotation/etc.) or a tire order, and lastVisitDate is older than 180 days.
      return and(
        sql`${customers.lastVisitDate} IS NOT NULL`,
        sql`${customers.lastVisitDate} < ${d180}`,
        eq(customers.smsOptOut, 0),
        sql`EXISTS (
          SELECT 1 FROM invoices 
          WHERE invoices.customerId = ${customers.id} 
            AND (invoices.serviceDescription LIKE '%tire%' OR invoices.serviceDescription LIKE '%tires%')
            AND invoices.serviceDescription NOT LIKE '%repair%'
            AND invoices.serviceDescription NOT LIKE '%rotation%'
            AND invoices.serviceDescription NOT LIKE '%rotate%'
            AND invoices.serviceDescription NOT LIKE '%flat%'
            AND invoices.serviceDescription NOT LIKE '%patch%'
            AND invoices.serviceDescription NOT LIKE '%plug%'
            AND invoices.serviceDescription NOT LIKE '%balance%'
            AND invoices.serviceDescription NOT LIKE '%mount%'
        ) OR EXISTS (
          SELECT 1 FROM tire_orders 
          WHERE tire_orders.customerId = ${customers.id} 
            AND (tire_orders.paymentStatus = 'paid' OR tire_orders.status NOT IN ('cancelled', 'received'))
        ) OR EXISTS (
          SELECT 1 FROM service_history 
          WHERE service_history.userId = ${customers.id} 
            AND (service_history.serviceType LIKE '%tire%' OR service_history.serviceType LIKE '%tires%' OR service_history.description LIKE '%tire%' OR service_history.description LIKE '%tires%')
            AND service_history.serviceType NOT LIKE '%repair%'
            AND service_history.serviceType NOT LIKE '%rotation%'
            AND service_history.serviceType NOT LIKE '%rotate%'
            AND service_history.serviceType NOT LIKE '%flat%'
            AND service_history.serviceType NOT LIKE '%patch%'
            AND service_history.serviceType NOT LIKE '%plug%'
            AND service_history.serviceType NOT LIKE '%balance%'
            AND service_history.serviceType NOT LIKE '%mount%'
            AND (service_history.description IS NULL OR (
              service_history.description NOT LIKE '%repair%'
              AND service_history.description NOT LIKE '%rotation%'
              AND service_history.description NOT LIKE '%rotate%'
              AND service_history.description NOT LIKE '%flat%'
              AND service_history.description NOT LIKE '%patch%'
              AND service_history.description NOT LIKE '%plug%'
              AND service_history.description NOT LIKE '%balance%'
              AND service_history.description NOT LIKE '%mount%'
            ))
        )`
      )!;
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

/**
 * Substitute the merge tags a winback template can carry into a final SMS body.
 * Replaces {firstName} and {vehicleInfo} — the two tokens whose data lives on
 * the customer row. ({lastService} was removed from every template because no
 * last-service description is available on the customers row at send time.)
 *
 * {vehicleInfo} resolves to "year make model" from the enriched vehicle fields,
 * falling back to whatever parts exist, then to a neutral "vehicle" so a
 * customer NEVER receives a literal "{vehicleInfo}". Must be applied anywhere a
 * personalizedBody is built (activate) or previewed so the two stay in sync.
 */
export function personalizeWinbackBody(
  body: string,
  customer: Pick<typeof customers.$inferSelect, "firstName" | "vehicleYear" | "vehicleMake" | "vehicleModel">,
  hasTirePurchase: boolean = true
): string {
  let finalBody = body;
  if (!hasTirePurchase) {
    if (finalBody.includes("free tire rotation") || finalBody.includes("tire service") || finalBody.includes("got tires") || finalBody.includes("tire rotation")) {
      finalBody = `Still need tires or service? We're here at ${STORE_NAME} whenever you're ready. Pull up any day for a free 27-point check, walk-ins welcome 7 days a week. ${STORE_PHONE}`;
    }
  }

  const vehicleInfo =
    [customer.vehicleYear, customer.vehicleMake, customer.vehicleModel]
      .map((p) => String(p ?? "").trim())
      .filter((p) => p.length > 0)
      .join(" ")
      .trim() || "vehicle";
  // wave-182: every winback send is bulk promotional → TCPA requires opt-out.
  // Wrap centrally here so all segments + any operator custom message comply
  // (idempotent: withOptOut no-ops if the body already carries a STOP line).
  return withOptOut(
    finalBody
      .replace(/{firstName}/g, customer.firstName)
      .replace(/{vehicleInfo}/g, vehicleInfo),
  );
}

export const winbackRouter = router({
  /** Calculate campaign readiness metrics */
  campaignReadiness: adminProcedure
    .input(z.object({
      targetSegment: z.enum(["lapsed", "dormant", "lost", "vip", "fleet", "recent", "tire_customer"]),
      customMessages: z.array(z.object({
        step: z.number(),
        delayDays: z.number(),
        body: z.string(),
      })).optional(),
    }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return { netTargetCount: 0, projectedValueCents: 0, previewMessages: [] };

      const segmentFilter = buildSegmentFilter(input.targetSegment);
      const [stats] = await d.select({
        count: sql<number>`count(*)`,
        avgSpent: sql<number>`COALESCE(AVG(${customers.totalSpent}), 0)`,
      })
        .from(customers)
        .where(segmentFilter);

      const netTargetCount = stats?.count ?? 0;
      // 5% projected conversion rate
      const projectedValueCents = Math.round(netTargetCount * (stats?.avgSpent ?? 10000) * 0.05);

      const [recentCustomer] = await d.select()
        .from(customers)
        .where(segmentFilter)
        .orderBy(desc(customers.lastVisitDate))
        .limit(1);

      let previewMessages: Array<{ step: number; body: string }> = [];
      if (recentCustomer) {
        const tirePurchaseCustomerIds = await getVerifiedTirePurchaseCustomerIds(d, [recentCustomer.id]);
        const hasTire = tirePurchaseCustomerIds.has(recentCustomer.id);

        const customMsgs = input.customMessages;
        if (customMsgs && customMsgs.length > 0) {
          previewMessages = customMsgs.map((m) => ({
            step: m.step,
            body: personalizeWinbackBody(m.body, recentCustomer, hasTire),
          }));
        } else {
          const defaults = WINBACK_TEMPLATES[input.targetSegment] || WINBACK_TEMPLATES.lapsed;
          previewMessages = defaults.map((tmpl) => ({
            step: tmpl.step,
            body: personalizeWinbackBody(tmpl.template, recentCustomer, hasTire),
          }));
        }
      }

      return {
        netTargetCount,
        projectedValueCents,
        previewMessages,
      };
    }),

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

  /** Get segment counts for all cohorts in parallel */
  segmentCounts: adminProcedure.query(async () => {
    const d = await db();
    if (!d) {
      return {
        lapsed: 0,
        dormant: 0,
        lost: 0,
        vip: 0,
        fleet: 0,
        recent: 0,
        tire_customer: 0,
      };
    }

    const segments = ["lapsed", "dormant", "lost", "vip", "fleet", "recent", "tire_customer"] as const;
    const countPromises = segments.map(async (seg) => {
      const filter = buildSegmentFilter(seg);
      const [row] = await d.select({ count: sql<number>`count(*)` })
        .from(customers)
        .where(filter);
      return { [seg]: row?.count ?? 0 };
    });

    const results = await Promise.all(countPromises);
    return Object.assign({}, ...results) as Record<typeof segments[number], number>;
  }),

  /** Create a new win-back campaign */
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      targetSegment: z.enum(["lapsed", "dormant", "lost", "vip", "fleet", "recent", "tire_customer"]),
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

      const sampleCustomerIds = sampleCustomers.map((c: any) => c.id);
      const tirePurchaseCustomerIds = await getVerifiedTirePurchaseCustomerIds(d, sampleCustomerIds);

      type SampleCustomer = typeof customers.$inferSelect;
      type WinbackMessageRow = typeof winbackMessages.$inferSelect;
      return sampleCustomers.map((c: SampleCustomer) => {
        const hasTirePurchase = tirePurchaseCustomerIds.has(c.id);
        const qualifiedReason = campaign.targetSegment === "tire_customer"
          ? (hasTirePurchase ? "Verified tire purchase" : "No verified tire purchase (using fallback generic copy)")
          : `Qualified by segment: ${campaign.targetSegment}`;
        return {
          customer: `${c.firstName} ${c.lastName || ""}`.trim(),
          phone: c.phone,
          qualifiedReason,
          messages: messages.map((m: WinbackMessageRow) => ({
            step: m.step,
            delayDays: m.delayDays,
            body: personalizeWinbackBody(m.body, c, hasTirePurchase),
          })),
        };
      });
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

      const targetCustomerIds = targetCustomers.map((c: any) => c.id);
      const tirePurchaseCustomerIds = await getVerifiedTirePurchaseCustomerIds(d, targetCustomerIds);

      const now = new Date();
      let created = 0;

      // wave-142b — was N×M individual inserts (one per customer × message).
      // For 5K customers × 3 messages that's 15K round-trips. Now batched
      // 500 rows per insert, ~30 round-trips for the same workload.
      const sendRecords: typeof winbackSends.$inferInsert[] = [];
      for (const customer of targetCustomers) {
        const hasTirePurchase = tirePurchaseCustomerIds.has(customer.id);
        for (const msg of messages) {
          const scheduledAt = new Date(now.getTime() + msg.delayDays * 24 * 60 * 60 * 1000);
          sendRecords.push({
            campaignId: input.campaignId,
            customerId: customer.id,
            messageId: msg.id,
            step: msg.step,
            phone: customer.phone,
            personalizedBody: personalizeWinbackBody(msg.body, customer, hasTirePurchase),
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
