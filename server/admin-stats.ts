/**
 * Admin Dashboard Statistics Aggregation
 * Collects metrics from all database tables for the admin overview.
 */

import { getDb } from "./db";
import { bookings, leads, chatSessions, dynamicArticles, notificationMessages, contentGenerationLog, users, callbackRequests, callEvents } from "../drizzle/schema";
import { eq, desc, gte, sql } from "drizzle-orm";

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
}

export interface ActivityItem {
  type: "booking" | "lead" | "article" | "chat";
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
  };

  if (!d) return defaultStats;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  try {
    // ─── BOOKINGS ─────────────────────────────────────
    const allBookings = await d.select().from(bookings).orderBy(desc(bookings.createdAt));
    const bookingStats = {
      total: allBookings.length,
      new: allBookings.filter(b => b.status === "new").length,
      confirmed: allBookings.filter(b => b.status === "confirmed").length,
      completed: allBookings.filter(b => b.status === "completed").length,
      cancelled: allBookings.filter(b => b.status === "cancelled").length,
      thisWeek: allBookings.filter(b => new Date(b.createdAt) >= weekAgo).length,
      byService: Object.entries(
        allBookings.reduce((acc, b) => {
          const svc = b.service || "Other";
          acc[svc] = (acc[svc] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      ).map(([service, count]) => ({ service, count })).sort((a, b) => b.count - a.count),
    };

    // ─── LEADS ────────────────────────────────────────
    const allLeads = await d.select().from(leads).orderBy(desc(leads.createdAt));
    const leadStats = {
      total: allLeads.length,
      new: allLeads.filter(l => l.status === "new").length,
      contacted: allLeads.filter(l => l.status === "contacted").length,
      booked: allLeads.filter(l => l.status === "booked").length,
      closed: allLeads.filter(l => l.status === "closed").length,
      lost: allLeads.filter(l => l.status === "lost").length,
      urgent: allLeads.filter(l => (l.urgencyScore ?? 0) >= 4).length,
      thisWeek: allLeads.filter(l => new Date(l.createdAt) >= weekAgo).length,
      bySource: Object.entries(
        allLeads.reduce((acc, l) => {
          const src = l.source || "unknown";
          acc[src] = (acc[src] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      ).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
      avgUrgency: allLeads.length > 0
        ? Math.round((allLeads.reduce((sum, l) => sum + (l.urgencyScore ?? 3), 0) / allLeads.length) * 10) / 10
        : 0,
    };

    // ─── CONTENT ──────────────────────────────────────
    const allArticles = await d.select().from(dynamicArticles);
    const allNotifs = await d.select().from(notificationMessages);
    const allLogs = await d.select().from(contentGenerationLog).orderBy(desc(contentGenerationLog.createdAt));
    const contentStats = {
      totalArticles: allArticles.length,
      published: allArticles.filter(a => a.status === "published").length,
      drafts: allArticles.filter(a => a.status === "draft").length,
      rejected: allArticles.filter(a => a.status === "rejected").length,
      totalNotifications: allNotifs.length,
      activeNotifications: allNotifs.filter(n => n.isActive === 1).length,
      generationLogs: allLogs.length,
      recentGenerations: allLogs.filter(l => new Date(l.createdAt) >= weekAgo).length,
    };

    // ─── CHAT ─────────────────────────────────────────
    const allChats = await d.select().from(chatSessions);
    const chatStats = {
      totalSessions: allChats.length,
      converted: allChats.filter(c => c.converted === 1).length,
      thisWeek: allChats.filter(c => new Date(c.createdAt) >= weekAgo).length,
    };

    // ─── USERS ────────────────────────────────────────
    const allUsers = await d.select().from(users);
    const userStats = {
      total: allUsers.length,
      admins: allUsers.filter(u => u.role === "admin").length,
    };

    // ─── RECENT ACTIVITY ──────────────────────────────
    const recentActivity: ActivityItem[] = [];

    // Recent bookings
    allBookings.slice(0, 5).forEach(b => {
      recentActivity.push({
        type: "booking",
        title: `${b.name} — ${b.service}`,
        subtitle: b.vehicle || "Vehicle not specified",
        timestamp: new Date(b.createdAt),
        status: b.status,
      });
    });

    // Recent leads
    allLeads.slice(0, 5).forEach(l => {
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
    allArticles.slice(0, 3).forEach(a => {
      recentActivity.push({
        type: "article",
        title: a.title,
        subtitle: `${a.category} — ${a.readTime}`,
        timestamp: new Date(a.createdAt),
        status: a.status,
      });
    });

    // Recent chats
    allChats.slice(0, 3).forEach(c => {
      recentActivity.push({
        type: "chat",
        title: c.vehicleInfo || "Vehicle Diagnosis Chat",
        subtitle: c.problemSummary ? c.problemSummary.substring(0, 80) + (c.problemSummary.length > 80 ? "..." : "") : "Chat session",
        timestamp: new Date(c.createdAt),
      });
    });

    // ─── SOURCE ATTRIBUTION ─────────────────────────
    const bookingsBySource: Record<string, number> = {};
    allBookings.forEach(b => {
      const src = b.utmSource || (b.referrer ? "referral" : "direct");
      bookingsBySource[src] = (bookingsBySource[src] || 0) + 1;
    });

    const leadsByUtmSource: Record<string, number> = {};
    allLeads.forEach(l => {
      const src = l.utmSource || (l.referrer ? "referral" : "direct");
      leadsByUtmSource[src] = (leadsByUtmSource[src] || 0) + 1;
    });

    // ─── CALL TRACKING ────────────────────────────────
    let callTrackingStats = { totalCalls: 0, thisWeek: 0, byPage: [] as { page: string; count: number }[] };
    let callsBySource: Record<string, number> = {};
    try {
      const allCalls = await d.select().from(callEvents).orderBy(desc(callEvents.createdAt));
      const callsByPage: Record<string, number> = {};
      allCalls.forEach(c => {
        const page = c.sourcePage || "unknown";
        callsByPage[page] = (callsByPage[page] || 0) + 1;
        const src = c.utmSource || (c.referrer ? "referral" : "direct");
        callsBySource[src] = (callsBySource[src] || 0) + 1;
      });
      callTrackingStats = {
        totalCalls: allCalls.length,
        thisWeek: allCalls.filter(c => new Date(c.createdAt) >= weekAgo).length,
        byPage: Object.entries(callsByPage).map(([page, count]) => ({ page, count })).sort((a, b) => b.count - a.count),
      };
    } catch {}

    // ─── CALLBACKS ─────────────────────────────────────
    let callbackStats = { total: 0, new: 0, completed: 0, thisWeek: 0 };
    try {
      const allCallbacks = await d.select().from(callbackRequests).orderBy(desc(callbackRequests.createdAt));
      callbackStats = {
        total: allCallbacks.length,
        new: allCallbacks.filter(c => c.status === "new").length,
        completed: allCallbacks.filter(c => c.status === "completed").length,
        thisWeek: allCallbacks.filter(c => new Date(c.createdAt) >= weekAgo).length,
      };
    } catch {}

    // Sort by timestamp descending
    recentActivity.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return {
      bookings: bookingStats,
      leads: leadStats,
      content: contentStats,
      chat: chatStats,
      users: userStats,
      recentActivity: recentActivity.slice(0, 15),
      sourceAttribution: {
        bookingsBySource: Object.entries(bookingsBySource).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
        leadsBySource: Object.entries(leadsByUtmSource).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
        callsBySource: Object.entries(callsBySource).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
      },
      callTracking: callTrackingStats,
      callbacks: callbackStats,
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
    } catch {}
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
