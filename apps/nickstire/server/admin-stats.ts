/**
 * Admin Dashboard Statistics Aggregation
 * Collects metrics from all database tables for the admin overview.
 */

import { getDb } from "./db";
import { bookings, leads, chatSessions, dynamicArticles, notificationMessages, contentGenerationLog, users, callbackRequests, callEvents, invoices, customers, workOrders, algEstimates, tireOrders } from "../drizzle/schema";
import { eq, desc, gte, sql, and } from "drizzle-orm";

import { BUSINESS } from "@shared/business";
import { createLogger } from "./lib/logger";

const log = createLogger("admin-stats");
type Booking = typeof bookings.$inferSelect;
type Lead = typeof leads.$inferSelect;
type Article = typeof dynamicArticles.$inferSelect;
type Notification = typeof notificationMessages.$inferSelect;
type GenLog = typeof contentGenerationLog.$inferSelect;
type Chat = typeof chatSessions.$inferSelect;
type User = typeof users.$inferSelect;
type CallEvent = typeof callEvents.$inferSelect;
type Callback = typeof callbackRequests.$inferSelect;
type WorkOrder = typeof workOrders.$inferSelect;

export interface DashboardStats {
  // wave-181.3 · stamped by the outer catch when the stats pipeline
  // throws. Consumers should check _degraded before trusting any field.
  _degraded?: boolean;
  _errorId?: string;
  bookings: {
    total: number;
    new: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    thisWeek: number;
    byService: { service: string; count: number }[];
  };
  leads: {
    total: number;
    new: number;
    contacted: number;
    booked: number;
    closed: number;
    lost: number;
    urgent: number;
    thisWeek: number;
    bySource: { source: string; count: number }[];
    avgUrgency: number;
  };
  content: {
    totalArticles: number;
    published: number;
    drafts: number;
    rejected: number;
    totalNotifications: number;
    activeNotifications: number;
    generationLogs: number;
    recentGenerations: number;
  };
  chat: {
    totalSessions: number;
    converted: number;
    thisWeek: number;
  };
  users: {
    total: number;
    admins: number;
  };
  recentActivity: ActivityItem[];
  sourceAttribution: {
    bookingsBySource: { source: string; count: number }[];
    leadsBySource: { source: string; count: number }[];
    callsBySource: { source: string; count: number }[];
  };
  callTracking: {
    totalCalls: number;
    thisWeek: number;
    byPage: { page: string; count: number }[];
  };
  callbacks: {
    total: number;
    new: number;
    completed: number;
    thisWeek: number;
  };
  memberships: {
    warning: number;
  };
  tires: {
    new: number;
  };
  /** ALG invoice data — the real source of truth for completed sales */
  shopFloor: {
    /** Completed sales (paid invoices) — SOURCE: invoices table (ALG mirror) */
    invoicesToday: number;
    invoicesThisWeek: number;
    invoicesThisMonth: number;
    /** Revenue from invoices (in dollars) — SOURCE: invoices table (ALG mirror) */
    revenueToday: number;
    revenueThisWeek: number;
    revenueThisMonth: number;
    /**
     * When invoice data was last ingested from ALG (ISO string, null when
     * the table is empty). The mirror is probe-driven (overnight 3 AM +
     * evening 8 PM + on-demand), so "today" figures can legitimately lag —
     * the UI shows this timestamp so a $0 day reads as "not synced yet",
     * never as a silent lie.
     */
    dataAsOf: string | null;
    /** Average ticket from invoices */
    avgTicket: number;
    /**
     * Real ALG walk-in estimates (declined / pending work).
     *
     * SOURCE: alg_estimates table — synced via
     * server/services/shopDriverEstimateSync.ts (pulse tier, shop-protected).
     *
     * An ALG estimate WITHOUT a matching invoice in the alg_estimates row
     * = declined sale = recovery target. See `declinedWorkCount` /
     * `declinedWorkValue` below for the recoverable dollar exposure.
     */
    estimatesToday: number;
    estimatesThisWeek: number;
    /**
     * Real ALG conversion rate (percentage).
     *
     * Formula: matched_invoices / total_alg_estimates_this_month * 100
     * where a match = same customerPhone, invoice totalAmount within
     * ±10% of estimatedAmount, and invoiceDate within 30d of the
     * estimateDate. Returns 0 when the alg_estimates table is empty
     * (sync hasn't run yet).
     */
    conversionRate: number;
    /**
     * Declined-work signal — count of ALG estimates this month with NO
     * matching invoice (customer walked, didn't get the work done).
     * These feed the 7d / 30d SMS recovery engine.
     */
    declinedWorkCount: number;
    /**
     * Total dollar value of the unmatched (declined) ALG estimates this
     * month. In dollars (already /100'd from cents).
     */
    declinedWorkValue: number;
    /** Payment method breakdown */
    paymentMethods: { method: string; count: number; total: number }[];
    /** Total customers in DB */
    totalCustomers: number;
    /** VIP customers (3+ visits) */
    vipCustomers: number;
  };
}

export interface ActivityItem {
  type: "booking" | "lead" | "article" | "chat" | "workOrder";
  title: string;
  subtitle: string;
  timestamp: Date;
  status?: string;
  urgency?: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const d = await getDb();

  const defaultStats: DashboardStats = {
    bookings: { total: 0, new: 0, confirmed: 0, completed: 0, cancelled: 0, thisWeek: 0, byService: [] },
    leads: { total: 0, new: 0, contacted: 0, booked: 0, closed: 0, lost: 0, urgent: 0, thisWeek: 0, bySource: [], avgUrgency: 0 },
    content: { totalArticles: 0, published: 0, drafts: 0, rejected: 0, totalNotifications: 0, activeNotifications: 0, generationLogs: 0, recentGenerations: 0 },
    chat: { totalSessions: 0, converted: 0, thisWeek: 0 },
    users: { total: 0, admins: 0 },
    recentActivity: [],
    sourceAttribution: { bookingsBySource: [], leadsBySource: [], callsBySource: [] },
    callTracking: { totalCalls: 0, thisWeek: 0, byPage: [] },
    callbacks: { total: 0, new: 0, completed: 0, thisWeek: 0 },
    memberships: { warning: 0 },
    tires: { new: 0 },
    shopFloor: { invoicesToday: 0, invoicesThisWeek: 0, invoicesThisMonth: 0, revenueToday: 0, revenueThisWeek: 0, revenueThisMonth: 0, dataAsOf: null, avgTicket: 0, estimatesToday: 0, estimatesThisWeek: 0, conversionRate: 0, declinedWorkCount: 0, declinedWorkValue: 0, paymentMethods: [], totalCustomers: 0, vipCustomers: 0 },
  };

  if (!d) return defaultStats;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  try {
    // ─── BOOKINGS ─────────────────────────────────────
    // wave-158 — full SQL-aggregate rewrite. Was wave-149 hybrid (column-
    // restricted SELECT + JS filter); now COUNT/SUM(CASE WHEN) + GROUP BY
    // aggregates + a separate LIMIT 5 for recent activity. Bandwidth per
    // dashboard load: ~30 small aggregate rows + 5 thin recent rows + small
    // GROUP BY tables, vs 500 fat rows previously. ~99% reduction overall.
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // 1. Booking status counts + thisWeek in a single aggregate query
    const [bookingAgg] = await d.select({
      total: sql<number>`COUNT(*)`,
      new: sql<number>`SUM(CASE WHEN ${bookings.status} = 'new' THEN 1 ELSE 0 END)`,
      confirmed: sql<number>`SUM(CASE WHEN ${bookings.status} = 'confirmed' THEN 1 ELSE 0 END)`,
      completed: sql<number>`SUM(CASE WHEN ${bookings.status} = 'completed' THEN 1 ELSE 0 END)`,
      cancelled: sql<number>`SUM(CASE WHEN ${bookings.status} = 'cancelled' THEN 1 ELSE 0 END)`,
      thisWeek: sql<number>`SUM(CASE WHEN ${bookings.createdAt} >= ${weekAgo} THEN 1 ELSE 0 END)`,
    }).from(bookings).where(gte(bookings.createdAt, ninetyDaysAgo));

    // 2. Booking byService — GROUP BY aggregate
    // wave-181.30: GROUP BY the raw column, not the COALESCE expression.
    // TiDB's ONLY_FULL_GROUP_BY treats `COALESCE(service,…)` and
    // `COALESCE(bookings.service,…)` as different expressions (Drizzle
    // emits unqualified in SELECT, qualified in GROUP BY) and rejects
    // the query. NULL is its own group; the COALESCE on SELECT just
    // relabels that group. Same final result.
    const bookingByServiceRows = await d.select({
      service: sql<string>`COALESCE(${bookings.service}, 'Other')`,
      count: sql<number>`COUNT(*)`,
    }).from(bookings)
      .where(gte(bookings.createdAt, ninetyDaysAgo))
      .groupBy(bookings.service)
      .orderBy(sql`COUNT(*) DESC`);

    // 3. Recent 5 bookings for the activity feed (column-restricted)
    type BookingRecent = Pick<Booking, "name" | "service" | "vehicle" | "status" | "createdAt">;
    const recentBookings: BookingRecent[] = await d.select({
      name: bookings.name,
      service: bookings.service,
      vehicle: bookings.vehicle,
      status: bookings.status,
      createdAt: bookings.createdAt,
    }).from(bookings)
      .where(gte(bookings.createdAt, ninetyDaysAgo))
      .orderBy(desc(bookings.createdAt))
      .limit(5);

    // 4. Booking source attribution — GROUP BY with COALESCE fallback
    // wave-181.30: see byService comment above. Group by raw columns
    // (utmSource + referrer-null-ness) so TiDB's strict ONLY_FULL_GROUP_BY
    // is satisfied. The SELECT-side COALESCE/CASE relabels groups; the
    // reducer below sums on collision (multiple groups → same label).
    const bookingBySourceRows = await d.select({
      src: sql<string>`COALESCE(${bookings.utmSource}, CASE WHEN ${bookings.referrer} IS NOT NULL THEN 'referral' ELSE 'direct' END)`,
      count: sql<number>`COUNT(*)`,
    }).from(bookings)
      .where(gte(bookings.createdAt, ninetyDaysAgo))
      .groupBy(bookings.utmSource, bookings.referrer);

    const bookingStats = {
      total: Number(bookingAgg?.total ?? 0),
      new: Number(bookingAgg?.new ?? 0),
      confirmed: Number(bookingAgg?.confirmed ?? 0),
      completed: Number(bookingAgg?.completed ?? 0),
      cancelled: Number(bookingAgg?.cancelled ?? 0),
      thisWeek: Number(bookingAgg?.thisWeek ?? 0),
      byService: bookingByServiceRows.map((r: { service: string; count: number }) => ({ service: r.service, count: Number(r.count) })),
    };
    const bookingsBySource: Record<string, number> = {};
    for (const row of bookingBySourceRows) {
      // wave-181.30 · sum on collision — the new GROUP BY can split utmSource='x'
      // by referrer-null-ness into 2 groups that both COALESCE to label 'x'.
      bookingsBySource[row.src] = (bookingsBySource[row.src] ?? 0) + Number(row.count);
    }

    // ─── LEADS ────────────────────────────────────────
    // wave-158 — same aggregate treatment as bookings
    // `new` and `urgent` feed the Today action pills + MorningBrief priority
    // line — they exclude callback-linked duplicate leads (the same person is
    // already counted on the callback surfaces; see shared/leadSource.ts).
    // Pipeline-state counters (total/contacted/booked/...) stay raw.
    const [leadAgg] = await d.select({
      total: sql<number>`COUNT(*)`,
      new: sql<number>`SUM(CASE WHEN ${leads.status} = 'new' AND NOT (${leads.source} = 'callback' AND ${leads.callbackId} IS NOT NULL) THEN 1 ELSE 0 END)`,
      contacted: sql<number>`SUM(CASE WHEN ${leads.status} = 'contacted' THEN 1 ELSE 0 END)`,
      booked: sql<number>`SUM(CASE WHEN ${leads.status} = 'booked' THEN 1 ELSE 0 END)`,
      closed: sql<number>`SUM(CASE WHEN ${leads.status} = 'closed' THEN 1 ELSE 0 END)`,
      lost: sql<number>`SUM(CASE WHEN ${leads.status} = 'lost' THEN 1 ELSE 0 END)`,
      // Urgency only matters while a lead is in-flight — a booked/closed/lost
      // lead has been actioned and must not bleed into "urgent" (matches the
      // Sales Pipeline's wave-128 rule so Overview and Pipeline agree).
      urgent: sql<number>`SUM(CASE WHEN COALESCE(${leads.urgencyScore}, 0) >= 4 AND ${leads.status} NOT IN ('booked', 'completed', 'closed', 'lost') AND NOT (${leads.source} = 'callback' AND ${leads.callbackId} IS NOT NULL) THEN 1 ELSE 0 END)`,
      thisWeek: sql<number>`SUM(CASE WHEN ${leads.createdAt} >= ${weekAgo} THEN 1 ELSE 0 END)`,
      avgUrgencySum: sql<number>`COALESCE(SUM(COALESCE(${leads.urgencyScore}, 3)), 0)`,
    }).from(leads).where(gte(leads.createdAt, ninetyDaysAgo));

    // wave-181.30: GROUP BY raw column (same TiDB strict-mode fix as bookings).
    const leadBySourceRows = await d.select({
      source: sql<string>`COALESCE(${leads.source}, 'unknown')`,
      count: sql<number>`COUNT(*)`,
    }).from(leads)
      .where(gte(leads.createdAt, ninetyDaysAgo))
      .groupBy(leads.source)
      .orderBy(sql`COUNT(*) DESC`);

    type LeadRecent = Pick<Lead, "name" | "problem" | "recommendedService" | "status" | "urgencyScore" | "createdAt">;
    const recentLeads: LeadRecent[] = await d.select({
      name: leads.name,
      problem: leads.problem,
      recommendedService: leads.recommendedService,
      status: leads.status,
      urgencyScore: leads.urgencyScore,
      createdAt: leads.createdAt,
    }).from(leads)
      .where(gte(leads.createdAt, ninetyDaysAgo))
      .orderBy(desc(leads.createdAt))
      .limit(5);

    // wave-181.30: GROUP BY raw columns (same fix as bookings).
    const leadByUtmSourceRows = await d.select({
      src: sql<string>`COALESCE(${leads.utmSource}, CASE WHEN ${leads.referrer} IS NOT NULL THEN 'referral' ELSE 'direct' END)`,
      count: sql<number>`COUNT(*)`,
    }).from(leads)
      .where(gte(leads.createdAt, ninetyDaysAgo))
      .groupBy(leads.utmSource, leads.referrer);

    const leadTotal = Number(leadAgg?.total ?? 0);
    const leadStats = {
      total: leadTotal,
      new: Number(leadAgg?.new ?? 0),
      contacted: Number(leadAgg?.contacted ?? 0),
      booked: Number(leadAgg?.booked ?? 0),
      closed: Number(leadAgg?.closed ?? 0),
      lost: Number(leadAgg?.lost ?? 0),
      urgent: Number(leadAgg?.urgent ?? 0),
      thisWeek: Number(leadAgg?.thisWeek ?? 0),
      bySource: leadBySourceRows.map((r: { source: string; count: number }) => ({ source: r.source, count: Number(r.count) })),
      avgUrgency: leadTotal > 0
        ? Math.round((Number(leadAgg?.avgUrgencySum ?? 0) / leadTotal) * 10) / 10
        : 0,
    };
    const leadsByUtmSource: Record<string, number> = {};
    for (const row of leadByUtmSourceRows) {
      // wave-181.30 · sum on collision (see bookings comment above).
      leadsByUtmSource[row.src] = (leadsByUtmSource[row.src] ?? 0) + Number(row.count);
    }

    // ─── CONTENT ──────────────────────────────────────
    const allArticles: Article[] = await d.select().from(dynamicArticles).limit(500);
    const allNotifs: Notification[] = await d.select().from(notificationMessages).limit(500);
    const allLogs: GenLog[] = await d.select().from(contentGenerationLog).orderBy(desc(contentGenerationLog.createdAt)).limit(500);
    const contentStats = {
      totalArticles: allArticles.length,
      published: allArticles.filter((a) => a.status === "published").length,
      drafts: allArticles.filter((a) => a.status === "draft").length,
      rejected: allArticles.filter((a) => a.status === "rejected").length,
      totalNotifications: allNotifs.length,
      activeNotifications: allNotifs.filter((n) => n.isActive === 1).length,
      generationLogs: allLogs.length,
      recentGenerations: allLogs.filter((l) => new Date(l.createdAt) >= weekAgo).length,
    };

    // ─── CHAT ─────────────────────────────────────────
    const allChats: Chat[] = await d.select().from(chatSessions)
      .where(gte(chatSessions.createdAt, ninetyDaysAgo))
      .limit(500);
    const chatStats = {
      totalSessions: allChats.length,
      converted: allChats.filter((c) => c.converted === 1).length,
      thisWeek: allChats.filter((c) => new Date(c.createdAt) >= weekAgo).length,
    };

    // ─── USERS ────────────────────────────────────────
    // wave-168: SQL aggregate instead of full-table fetch. Same class of
    // bug wave-158 fixed for bookings/leads. Today users is small but any
    // OAuth signup growth compounds the cost — same fix surface.
    const [userAgg] = await d.select({
      total: sql<number>`COUNT(*)`,
      admins: sql<number>`SUM(CASE WHEN ${users.role} = 'admin' THEN 1 ELSE 0 END)`,
    }).from(users);
    const userStats = {
      total: Number(userAgg?.total ?? 0),
      admins: Number(userAgg?.admins ?? 0),
    };

    // ─── RECENT ACTIVITY ──────────────────────────────
    const recentActivity: ActivityItem[] = [];

    // Recent bookings — wave-158 uses the pre-fetched recentBookings (5 rows)
    recentBookings.forEach((b) => {
      recentActivity.push({
        type: "booking",
        title: `${b.name} — ${b.service}`,
        subtitle: b.vehicle || "Vehicle not specified",
        timestamp: new Date(b.createdAt),
        status: b.status,
      });
    });

    // Recent leads — wave-158 uses pre-fetched recentLeads (5 rows)
    recentLeads.forEach((l) => {
      recentActivity.push({
        type: "lead",
        title: `${l.name} — ${l.recommendedService || "General"}`,
        subtitle: l.problem ? l.problem.substring(0, 80) + (l.problem.length > 80 ? "..." : "") : "No problem described",
        timestamp: new Date(l.createdAt),
        status: l.status,
        urgency: l.urgencyScore ?? 3,
      });
    });

    // Recent articles
    allArticles.slice(0, 3).forEach((a) => {
      recentActivity.push({
        type: "article",
        title: a.title,
        subtitle: `${a.category} — ${a.readTime}`,
        timestamp: new Date(a.createdAt),
        status: a.status,
      });
    });

    // Recent chats
    allChats.slice(0, 3).forEach((c) => {
      recentActivity.push({
        type: "chat",
        title: c.vehicleInfo || "Vehicle Diagnosis Chat",
        subtitle: c.problemSummary ? c.problemSummary.substring(0, 80) + (c.problemSummary.length > 80 ? "..." : "") : "Chat session",
        timestamp: new Date(c.createdAt),
      });
    });

    // Recent work orders — wave-142b: bound by updatedAt to avoid full
    // table scan if idx_work_orders_updated_at isn't selected; 90 days
    // is always sufficient for "recent" activity surfacing.
    try {
      const recentWOs: WorkOrder[] = await d.select().from(workOrders)
        .where(gte(workOrders.updatedAt, ninetyDaysAgo))
        .orderBy(desc(workOrders.updatedAt))
        .limit(5);
      recentWOs.forEach((wo) => {
        const vehicle = [wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(" ");
        const amount = wo.total ? `$${(Number(wo.total)).toLocaleString()}` : "";
        recentActivity.push({
          type: "workOrder",
          title: `WO #${wo.orderNumber} — ${wo.serviceDescription?.substring(0, 50) || "Service"}`,
          subtitle: [vehicle, wo.status?.replace(/_/g, " "), amount].filter(Boolean).join(" · "),
          timestamp: new Date(wo.updatedAt),
          status: wo.status,
        });
      });
    } catch (err) {
      log.error("[AdminStats] Work order activity failed:", err instanceof Error ? err.message : err);
    }

    // ─── SOURCE ATTRIBUTION ─────────────────────────
    // wave-158 — bookingsBySource and leadsByUtmSource are computed via
    // SQL GROUP BY in the bookings/leads aggregate blocks above.

    // ─── CALL TRACKING ────────────────────────────────
    let callTrackingStats = { totalCalls: 0, thisWeek: 0, byPage: [] as { page: string; count: number }[] };
    let callsBySource: Record<string, number> = {};
    try {
      const allCalls: CallEvent[] = await d.select().from(callEvents)
        .where(gte(callEvents.createdAt, ninetyDaysAgo))
        .orderBy(desc(callEvents.createdAt))
        .limit(1000);
      const callsByPage: Record<string, number> = {};
      allCalls.forEach((c) => {
        const page = c.sourcePage || "unknown";
        callsByPage[page] = (callsByPage[page] || 0) + 1;
        const src = c.utmSource || (c.referrer ? "referral" : "direct");
        callsBySource[src] = (callsBySource[src] || 0) + 1;
      });
      callTrackingStats = {
        totalCalls: allCalls.length,
        thisWeek: allCalls.filter((c) => new Date(c.createdAt) >= weekAgo).length,
        byPage: Object.entries(callsByPage).map(([page, count]) => ({ page, count })).sort((a, b) => b.count - a.count),
      };
    } catch (err) {
      log.error("[AdminStats] Call tracking stats failed:", err instanceof Error ? err.message : err);
    }

    // ─── CALLBACKS ─────────────────────────────────────
    let callbackStats = { total: 0, new: 0, completed: 0, thisWeek: 0 };
    try {
      const allCallbacks: Callback[] = await d.select().from(callbackRequests)
        .where(gte(callbackRequests.createdAt, ninetyDaysAgo))
        .orderBy(desc(callbackRequests.createdAt))
        .limit(500);
      callbackStats = {
        total: allCallbacks.length,
        new: allCallbacks.filter((c) => c.status === "new").length,
        completed: allCallbacks.filter((c) => c.status === "completed").length,
        thisWeek: allCallbacks.filter((c) => new Date(c.createdAt) >= weekAgo).length,
      };
    } catch (err) {
      log.error("[AdminStats] Callback stats failed:", err instanceof Error ? err.message : err);
    }

    // Sort by timestamp descending
    recentActivity.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // ─── SHOP FLOOR (ALG Invoice/Estimate Data) ──────────
    let shopFloorStats = defaultStats.shopFloor;
    try {
      const todayStart = new Date(new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone }));
      const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

      const [
        invoicesTodayRes, invoicesWeekRes, invoicesMonthRes,
        revTodayRes, revWeekRes, revMonthRes,
        // REAL ALG ESTIMATES — walk-in quotes synced from ShopDriver. These
        // replace the previous leads-with-recommendedService hack. See
        // server/services/shopDriverEstimateSync.ts.
        algEstTodayRes, algEstWeekRes, algEstMonthRes,
        algEstMatchedMonthRes, algEstUnmatchedMonthRes, algEstUnmatchedValueRes,
        paymentMethodsRes,
        totalCustRes, vipCustRes,
        lastIngestRes,
      ] = await Promise.all([
        // Wave-97 fix: counts now use the SAME population as revenue
        // (paid-only AND invoiceNumber NOT LIKE 'Estimate#%' to filter
        // any leaked rows still in the table pre-cleanup). This makes
        // avgTicket = revenue/count math consistent.
        d.select({ count: sql<number>`count(*)` }).from(invoices).where(and(gte(invoices.invoiceDate, todayStart), eq(invoices.paymentStatus, "paid"), sql`${invoices.invoiceNumber} NOT LIKE 'Estimate#%'`)),
        d.select({ count: sql<number>`count(*)` }).from(invoices).where(and(gte(invoices.invoiceDate, weekAgo), eq(invoices.paymentStatus, "paid"), sql`${invoices.invoiceNumber} NOT LIKE 'Estimate#%'`)),
        d.select({ count: sql<number>`count(*)` }).from(invoices).where(and(gte(invoices.invoiceDate, monthStart), eq(invoices.paymentStatus, "paid"), sql`${invoices.invoiceNumber} NOT LIKE 'Estimate#%'`)),
        d.select({ total: sql<number>`COALESCE(SUM(totalAmount), 0)` }).from(invoices).where(and(gte(invoices.invoiceDate, todayStart), eq(invoices.paymentStatus, "paid"), sql`${invoices.invoiceNumber} NOT LIKE 'Estimate#%'`)),
        d.select({ total: sql<number>`COALESCE(SUM(totalAmount), 0)` }).from(invoices).where(and(gte(invoices.invoiceDate, weekAgo), eq(invoices.paymentStatus, "paid"), sql`${invoices.invoiceNumber} NOT LIKE 'Estimate#%'`)),
        d.select({ total: sql<number>`COALESCE(SUM(totalAmount), 0)` }).from(invoices).where(and(gte(invoices.invoiceDate, monthStart), eq(invoices.paymentStatus, "paid"), sql`${invoices.invoiceNumber} NOT LIKE 'Estimate#%'`)),
        d.select({ count: sql<number>`count(*)` }).from(algEstimates).where(gte(algEstimates.estimateDate, todayStart)),
        d.select({ count: sql<number>`count(*)` }).from(algEstimates).where(gte(algEstimates.estimateDate, weekAgo)),
        d.select({ count: sql<number>`count(*)` }).from(algEstimates).where(gte(algEstimates.estimateDate, monthStart)),
        // Conversion math inputs — matched vs unmatched ALG estimates this month
        d.select({ count: sql<number>`count(*)` }).from(algEstimates).where(and(gte(algEstimates.estimateDate, monthStart), sql`${algEstimates.matchedInvoiceId} IS NOT NULL`)),
        d.select({ count: sql<number>`count(*)` }).from(algEstimates).where(and(gte(algEstimates.estimateDate, monthStart), sql`${algEstimates.matchedInvoiceId} IS NULL`)),
        d.select({ total: sql<number>`COALESCE(SUM(${algEstimates.estimatedAmount}), 0)` }).from(algEstimates).where(and(gte(algEstimates.estimateDate, monthStart), sql`${algEstimates.matchedInvoiceId} IS NULL`)),
        // paid + non-Estimate, matching the revenue population. Without these
        // two predicates this breakdown summed ALL invoices (unpaid + Estimate#
        // placeholders), so it disagreed with revenueThisMonth beside it by
        // $846.72 in the month it was found — and the whole shopFloor object is
        // forwarded to statenour by statenourSync, propagating the mismatch. The
        // sibling revenue/count queries were deliberately aligned here (wave-97);
        // this one was added below that comment and skipped both filters.
        d.execute(sql`SELECT paymentMethod, COUNT(*) as cnt, SUM(totalAmount) as total FROM invoices WHERE invoiceDate >= ${monthStart.toISOString().slice(0, 10)} AND paymentStatus = 'paid' AND invoiceNumber NOT LIKE 'Estimate#%' GROUP BY paymentMethod ORDER BY cnt DESC`).then(([rows]: [Record<string, unknown>[]]) => rows),
        d.select({ count: sql<number>`count(*)` }).from(customers),
        d.select({ count: sql<number>`count(*)` }).from(customers).where(gte(customers.totalVisits, 3)),
        // Freshness: when did the mirror last WRITE an invoice row? createdAt
        // (ingest time), not invoiceDate (business date) — a 3 AM probe
        // ingesting yesterday's tickets must read as "synced 3 AM", not
        // "current through yesterday evening".
        d.select({ last: sql<Date | string | null>`MAX(createdAt)` }).from(invoices),
      ]);

      const invoiceCountMonth = invoicesMonthRes[0]?.count ?? 0;
      const revenueMonth = (revMonthRes[0]?.total ?? 0) / 100; // cents to dollars
      const algEstCountMonth = algEstMonthRes[0]?.count ?? 0;
      const matchedCount = algEstMatchedMonthRes[0]?.count ?? 0;
      const unmatchedCount = algEstUnmatchedMonthRes[0]?.count ?? 0;
      const unmatchedValueDollars = (algEstUnmatchedValueRes[0]?.total ?? 0) / 100;
      // Real conversion: matched ALG estimates / total ALG estimates in the month.
      // If no ALG estimates (new table, empty), report 0 — UI labels this as
      // "awaiting ALG sync" so it's not misread as a real 0% conversion.
      const conversionRate = algEstCountMonth > 0
        ? Math.round((matchedCount / algEstCountMonth) * 100)
        : 0;

      shopFloorStats = {
        invoicesToday: invoicesTodayRes[0]?.count ?? 0,
        invoicesThisWeek: invoicesWeekRes[0]?.count ?? 0,
        invoicesThisMonth: invoiceCountMonth,
        revenueToday: (revTodayRes[0]?.total ?? 0) / 100,
        revenueThisWeek: (revWeekRes[0]?.total ?? 0) / 100,
        revenueThisMonth: revenueMonth,
        dataAsOf: lastIngestRes[0]?.last ? new Date(lastIngestRes[0].last).toISOString() : null,
        avgTicket: invoiceCountMonth > 0 ? Math.round(revenueMonth / invoiceCountMonth) : 0,
        estimatesToday: algEstTodayRes[0]?.count ?? 0,
        estimatesThisWeek: algEstWeekRes[0]?.count ?? 0,
        conversionRate,
        // NEW: declined-work signal — unmatched ALG estimates = walked customers
        declinedWorkCount: unmatchedCount,
        declinedWorkValue: unmatchedValueDollars,
        paymentMethods: (paymentMethodsRes as Record<string, unknown>[]).map((r) => ({ method: (r.paymentMethod as string) || "unknown", count: (r.cnt as number) ?? 0, total: ((r.total as number) ?? 0) / 100 })),
        totalCustomers: totalCustRes[0]?.count ?? 0,
        vipCustomers: vipCustRes[0]?.count ?? 0,
      };
    } catch (err) {
      log.error("[AdminStats] Shop floor stats error:", err instanceof Error ? err.message : err);
    }

    // Memberships warning count: past_due or incomplete
    let membershipsWarning = 0;
    try {
      const { memberships } = await import("../drizzle/schema");
      const [membRes] = await d.select({
        count: sql<number>`COUNT(*)`
      }).from(memberships)
        .where(sql`${memberships.status} IN ('past_due', 'incomplete')`);
      membershipsWarning = Number(membRes?.count ?? 0);
    } catch (err) {
      log.error("[AdminStats] Memberships warning check failed:", err instanceof Error ? err.message : err);
    }

    // Tires new count: status = 'received'
    let tiresNew = 0;
    try {
      const [tiresRes] = await d.select({
        count: sql<number>`COUNT(*)`
      }).from(tireOrders)
        .where(eq(tireOrders.status, "received"));
      tiresNew = Number(tiresRes?.count ?? 0);
    } catch (err) {
      log.error("[AdminStats] Tires new check failed:", err instanceof Error ? err.message : err);
    }

    return {
      bookings: bookingStats,
      leads: leadStats,
      content: contentStats,
      chat: chatStats,
      users: userStats,
      recentActivity: recentActivity.slice(0, 15),
      sourceAttribution: {
        bookingsBySource: Object.entries(bookingsBySource).map(([source, count]) => ({ source, count: count as number })).sort((a, b) => b.count - a.count),
        leadsBySource: Object.entries(leadsByUtmSource).map(([source, count]) => ({ source, count: count as number })).sort((a, b) => b.count - a.count),
        callsBySource: Object.entries(callsBySource).map(([source, count]) => ({ source, count: count as number })).sort((a, b) => b.count - a.count),
      },
      callTracking: callTrackingStats,
      callbacks: callbackStats,
      memberships: { warning: membershipsWarning },
      tires: { new: tiresNew },
      shopFloor: shopFloorStats,
    };
  } catch (error) {
    // wave-181.3 silent-failure audit finding #2 · the entire dashboard
    // was silently returning all-zeros on ANY query failure — operator
    // could not distinguish "quiet day" from "stats pipeline broken".
    // Now: log the error, alert ops via Telegram (rate-limited inside
    // sendTelegram helper), and stamp the response so the UI can surface
    // a degraded-data banner. Defaults are still returned so the page
    // renders, but consumers know the data isn't trustworthy.
    log.error("[AdminStats] FATAL: dashboard pipeline failure — returning degraded data", error);
    try {
      const { sendTelegramMessage } = await import("./services/telegram");
      await sendTelegramMessage(
        `🔴 Admin dashboard stats pipeline FAILED\n\nOne or more queries in getDashboardStats() threw. Dashboard is showing degraded (all-zero) data until fixed.\n\nError: ${error instanceof Error ? error.message : String(error)}\n\nCheck Sentry / Railway logs for the full stack.`,
        "critical"
      );
    } catch {
      // Telegram itself can fail — don't let that mask the original error.
    }
    return {
      ...defaultStats,
      _degraded: true,
      _errorId: "DASHBOARD_PIPELINE_FAILED",
    } as DashboardStats & { _degraded: true; _errorId: string };
  }
}

export interface SiteHealthInfo {
  domains: string[];
  sitemapPageCount: number;
  totalBlogPosts: number;
  hardcodedBlogPosts: number;
  dynamicBlogPosts: number;
  googleReviewRating: number | null;
  googleReviewCount: number | null;
  sheetsConfigured: boolean;
  sheetsUrl: string;
  indexedPages: number;
  notIndexedPages: number;
  crawledNotIndexed: number;
  discoveredNotIndexed: number;
}

export async function getSiteHealth(): Promise<SiteHealthInfo> {
  const d = await getDb();

  let dynamicBlogPosts = 0;
  if (d) {
    try {
      const published = await d.select().from(dynamicArticles).where(eq(dynamicArticles.status, "published"));
      dynamicBlogPosts = published.length;
    } catch (err) {
      log.error("[AdminStats] Dynamic blog post count failed:", err instanceof Error ? err.message : err);
    }
  }

  // Import sheets info
  const { isSheetConfigured, getSpreadsheetUrl } = await import("./sheets-sync");

  // wave-181.26 · sitemap page count was hardcoded to 68 (March 2026
  // snapshot). Since then wave-181 added 4 SERP-fix pages, wave-95-101
  // surfaced more route paths, and ~150 auto-generated pages exist via
  // PRERENDER_ROUTES. Pulling the live count from shared/routes.ts so
  // this number tracks the codebase automatically.
  let sitemapPageCount = 0;
  try {
    const { PRERENDER_ROUTES } = await import("@shared/routes");
    sitemapPageCount = PRERENDER_ROUTES.filter((r) => r.sitemap !== false).length;
  } catch (err) {
    log.error("[AdminStats] Sitemap count from routes.ts failed:", err instanceof Error ? err.message : err);
    sitemapPageCount = 68; // fall back to the March 2026 baseline
  }

  // wave-181.26 · "indexed" / "not indexed" used to be hardcoded from
  // March 2026 GSC. Without live GSC integration, we report `null` so
  // the admin UI knows to show a "GSC sync required" state instead of
  // displaying stale numbers as if they were current. When the
  // GOOGLE_SEARCH_CONSOLE_KEY is wired up, this will pull live counts.
  // For now: honest unknowns instead of confidently-wrong constants.
  return {
    domains: ["nickstire.org", "www.nickstire.org"],
    sitemapPageCount,
    totalBlogPosts: 6 + dynamicBlogPosts, // 6 hardcoded + dynamic
    hardcodedBlogPosts: 6,
    dynamicBlogPosts,
    googleReviewRating: null, // fetched separately via reviews.google
    googleReviewCount: null,
    sheetsConfigured: isSheetConfigured(),
    sheetsUrl: getSpreadsheetUrl(),
    indexedPages: 0, // 0 = "unknown, GSC sync required" — UI should render badge
    notIndexedPages: 0,
    crawledNotIndexed: 0,
    discoveredNotIndexed: 0,
  };
}
