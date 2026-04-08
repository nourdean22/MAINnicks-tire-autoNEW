/**
 * Admin Dashboard Statistics Aggregation
 * Collects metrics from all database tables for the admin overview.
 */

import { getDb } from "./db";
import { bookings, leads, chatSessions, dynamicArticles, notificationMessages, contentGenerationLog, users, callbackRequests, callEvents, invoices, customers, workOrders } from "../drizzle/schema";
import { eq, desc, gte, sql, and } from "drizzle-orm";

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
  /** ALG invoice data — the real source of truth for completed sales */
  shopFloor: {
    /** Completed sales (paid invoices) */
    invoicesToday: number;
    invoicesThisWeek: number;
    invoicesThisMonth: number;
    /** Revenue from invoices (in dollars) */
    revenueToday: number;
    revenueThisWeek: number;
    revenueThisMonth: number;
    /** Average ticket from invoices */
    avgTicket: number;
    /** Walk-in estimates (from ALG — customers who got quotes) */
    estimatesToday: number;
    estimatesThisWeek: number;
    /** Conversion: estimates that became invoices */
    conversionRate: number;
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
    shopFloor: { invoicesToday: 0, invoicesThisWeek: 0, invoicesThisMonth: 0, revenueToday: 0, revenueThisWeek: 0, revenueThisMonth: 0, avgTicket: 0, estimatesToday: 0, estimatesThisWeek: 0, conversionRate: 0, paymentMethods: [], totalCustomers: 0, vipCustomers: 0 },
  };

  if (!d) return defaultStats;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  try {
    // ─── BOOKINGS ─────────────────────────────────────
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const allBookings: Booking[] = await d.select().from(bookings)
      .where(gte(bookings.createdAt, ninetyDaysAgo))
      .orderBy(desc(bookings.createdAt))
      .limit(1000);
    const bookingStats = {
      total: allBookings.length,
      new: allBookings.filter((b) => b.status === "new").length,
      confirmed: allBookings.filter((b) => b.status === "confirmed").length,
      completed: allBookings.filter((b) => b.status === "completed").length,
      cancelled: allBookings.filter((b) => b.status === "cancelled").length,
      thisWeek: allBookings.filter((b) => new Date(b.createdAt) >= weekAgo).length,
      byService: Object.entries(
        allBookings.reduce((acc: Record<string, number>, b) => {
          const svc = b.service || "Other";
          acc[svc] = (acc[svc] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      ).map(([service, count]) => ({ service, count: count as number })).sort((a, b) => b.count - a.count),
    };

    // ─── LEADS ────────────────────────────────────────
    const allLeads: Lead[] = await d.select().from(leads)
      .where(gte(leads.createdAt, ninetyDaysAgo))
      .orderBy(desc(leads.createdAt))
      .limit(1000);
    const leadStats = {
      total: allLeads.length,
      new: allLeads.filter((l) => l.status === "new").length,
      contacted: allLeads.filter((l) => l.status === "contacted").length,
      booked: allLeads.filter((l) => l.status === "booked").length,
      closed: allLeads.filter((l) => l.status === "closed").length,
      lost: allLeads.filter((l) => l.status === "lost").length,
      urgent: allLeads.filter((l) => (l.urgencyScore ?? 0) >= 4).length,
      thisWeek: allLeads.filter((l) => new Date(l.createdAt) >= weekAgo).length,
      bySource: Object.entries(
        allLeads.reduce((acc: Record<string, number>, l) => {
          const src = l.source || "unknown";
          acc[src] = (acc[src] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      ).map(([source, count]) => ({ source, count: count as number })).sort((a, b) => b.count - a.count),
      avgUrgency: allLeads.length > 0
        ? Math.round((allLeads.reduce((sum: number, l) => sum + (l.urgencyScore ?? 3), 0) / allLeads.length) * 10) / 10
        : 0,
    };

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
    const allUsers: User[] = await d.select().from(users);
    const userStats = {
      total: allUsers.length,
      admins: allUsers.filter((u) => u.role === "admin").length,
    };

    // ─── RECENT ACTIVITY ──────────────────────────────
    const recentActivity: ActivityItem[] = [];

    // Recent bookings
    allBookings.slice(0, 5).forEach((b) => {
      recentActivity.push({
        type: "booking",
        title: `${b.name} — ${b.service}`,
        subtitle: b.vehicle || "Vehicle not specified",
        timestamp: new Date(b.createdAt),
        status: b.status,
      });
    });

    // Recent leads
    allLeads.slice(0, 5).forEach((l) => {
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

    // Recent work orders
    try {
      const recentWOs: WorkOrder[] = await d.select().from(workOrders).orderBy(desc(workOrders.updatedAt)).limit(5);
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
      console.error("[AdminStats] Work order activity failed:", err instanceof Error ? err.message : err);
    }

    // ─── SOURCE ATTRIBUTION ─────────────────────────
    const bookingsBySource: Record<string, number> = {};
    allBookings.forEach((b) => {
      const src = b.utmSource || (b.referrer ? "referral" : "direct");
      bookingsBySource[src] = (bookingsBySource[src] || 0) + 1;
    });

    const leadsByUtmSource: Record<string, number> = {};
    allLeads.forEach((l) => {
      const src = l.utmSource || (l.referrer ? "referral" : "direct");
      leadsByUtmSource[src] = (leadsByUtmSource[src] || 0) + 1;
    });

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
      console.error("[AdminStats] Call tracking stats failed:", err instanceof Error ? err.message : err);
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
      console.error("[AdminStats] Callback stats failed:", err instanceof Error ? err.message : err);
    }

    // Sort by timestamp descending
    recentActivity.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // ─── SHOP FLOOR (ALG Invoice/Estimate Data) ──────────
    let shopFloorStats = defaultStats.shopFloor;
    try {
      const todayStart = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
      const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

      const [
        invoicesTodayRes, invoicesWeekRes, invoicesMonthRes,
        revTodayRes, revWeekRes, revMonthRes,
        estimatesTodayRes, estimatesWeekRes,
        totalEstimatesMonth, totalInvoicesMonth,
        paymentMethodsRes,
        totalCustRes, vipCustRes,
      ] = await Promise.all([
        d.select({ count: sql<number>`count(*)` }).from(invoices).where(gte(invoices.invoiceDate, todayStart)),
        d.select({ count: sql<number>`count(*)` }).from(invoices).where(gte(invoices.invoiceDate, weekAgo)),
        d.select({ count: sql<number>`count(*)` }).from(invoices).where(gte(invoices.invoiceDate, monthStart)),
        d.select({ total: sql<number>`COALESCE(SUM(totalAmount), 0)` }).from(invoices).where(and(gte(invoices.invoiceDate, todayStart), eq(invoices.paymentStatus, "paid"))),
        d.select({ total: sql<number>`COALESCE(SUM(totalAmount), 0)` }).from(invoices).where(and(gte(invoices.invoiceDate, weekAgo), eq(invoices.paymentStatus, "paid"))),
        d.select({ total: sql<number>`COALESCE(SUM(totalAmount), 0)` }).from(invoices).where(and(gte(invoices.invoiceDate, monthStart), eq(invoices.paymentStatus, "paid"))),
        // Estimates = leads with a recommended service (AI-classified as needing specific work)
        d.select({ count: sql<number>`count(*)` }).from(leads).where(and(gte(leads.createdAt, todayStart), sql`${leads.recommendedService} IS NOT NULL`)),
        d.select({ count: sql<number>`count(*)` }).from(leads).where(and(gte(leads.createdAt, weekAgo), sql`${leads.recommendedService} IS NOT NULL`)),
        d.select({ count: sql<number>`count(*)` }).from(leads).where(and(gte(leads.createdAt, monthStart), sql`${leads.recommendedService} IS NOT NULL`)),
        d.select({ count: sql<number>`count(*)` }).from(invoices).where(gte(invoices.invoiceDate, monthStart)),
        d.execute(sql`SELECT paymentMethod, COUNT(*) as cnt, SUM(totalAmount) as total FROM invoices WHERE invoiceDate >= ${monthStart.toISOString().slice(0, 10)} GROUP BY paymentMethod ORDER BY cnt DESC`).then(([rows]: [Record<string, unknown>[]]) => rows),
        d.select({ count: sql<number>`count(*)` }).from(customers),
        d.select({ count: sql<number>`count(*)` }).from(customers).where(gte(customers.totalVisits, 3)),
      ]);

      const invoiceCountMonth = invoicesMonthRes[0]?.count ?? 0;
      const revenueMonth = (revMonthRes[0]?.total ?? 0) / 100; // cents to dollars
      const estCountMonth = totalEstimatesMonth[0]?.count ?? 0;

      shopFloorStats = {
        invoicesToday: invoicesTodayRes[0]?.count ?? 0,
        invoicesThisWeek: invoicesWeekRes[0]?.count ?? 0,
        invoicesThisMonth: invoiceCountMonth,
        revenueToday: (revTodayRes[0]?.total ?? 0) / 100,
        revenueThisWeek: (revWeekRes[0]?.total ?? 0) / 100,
        revenueThisMonth: revenueMonth,
        avgTicket: invoiceCountMonth > 0 ? Math.round(revenueMonth / invoiceCountMonth) : 0,
        estimatesToday: estimatesTodayRes[0]?.count ?? 0,
        estimatesThisWeek: estimatesWeekRes[0]?.count ?? 0,
        conversionRate: estCountMonth > 0 ? Math.round((invoiceCountMonth / (invoiceCountMonth + estCountMonth)) * 100) : 0,
        paymentMethods: (paymentMethodsRes as Record<string, unknown>[]).map((r) => ({ method: (r.paymentMethod as string) || "unknown", count: (r.cnt as number) ?? 0, total: ((r.total as number) ?? 0) / 100 })),
        totalCustomers: totalCustRes[0]?.count ?? 0,
        vipCustomers: vipCustRes[0]?.count ?? 0,
      };
    } catch (err) {
      console.error("[AdminStats] Shop floor stats error:", err instanceof Error ? err.message : err);
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
      shopFloor: shopFloorStats,
    };
  } catch (error) {
    console.error("[AdminStats] Error fetching stats:", error);
    return defaultStats;
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
      console.error("[AdminStats] Dynamic blog post count failed:", err instanceof Error ? err.message : err);
    }
  }

  // Import sheets info
  const { isSheetConfigured, getSpreadsheetUrl } = await import("./sheets-sync");

  return {
    domains: ["nickstire.org", "www.nickstire.org", "autonicks.com", "www.autonicks.com"],
    sitemapPageCount: 68, // 68 URLs in sitemap as of March 2026
    totalBlogPosts: 6 + dynamicBlogPosts, // 6 hardcoded + dynamic
    hardcodedBlogPosts: 6,
    dynamicBlogPosts,
    googleReviewRating: null, // fetched separately via reviews.google
    googleReviewCount: null,
    sheetsConfigured: isSheetConfigured(),
    sheetsUrl: getSpreadsheetUrl(),
    indexedPages: 57, // From GSC: 68 sitemap - 11 not indexed = 57 indexed
    notIndexedPages: 11, // From GSC: 6 crawled + 5 discovered not indexed
    crawledNotIndexed: 6, // From GSC: crawled but not indexed
    discoveredNotIndexed: 5, // From GSC: discovered but not indexed
  };
}
