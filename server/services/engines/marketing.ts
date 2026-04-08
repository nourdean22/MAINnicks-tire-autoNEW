/**
 * Marketing Engines (#29-34)
 *
 * analyzeChannelROI, analyzeReviewVelocity, analyzeSmsEngagement,
 * analyzeLeadResponseTime, analyzeContentPerformance, analyzeCompetitorGap
 */

import { smsCampaigns } from "../../../drizzle/schema";
import { sql, gte } from "drizzle-orm";
import { RawRow, extractRows, extractOne, db } from "./shared";

// ═══════════════════════════════════════════════════════════
// #29 CHANNEL ROI
// ═══════════════════════════════════════════════════════════

export async function analyzeChannelROI(): Promise<{
  channels: Array<{ channel: string; leads: number; conversions: number; revenue: number; costPerLead: number; roi: string }>;
  bestChannel: string;
  worstChannel: string;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT l.source as channel,
        COUNT(DISTINCT l.id) as leadCount,
        COUNT(DISTINCT CASE WHEN l.status IN ('booked', 'completed') THEN l.id END) as conversions,
        COALESCE(SUM(i.totalAmount), 0) as totalRev
      FROM leads l
      LEFT JOIN customers c ON RIGHT(c.phone, 10) = RIGHT(l.phone, 10)
      LEFT JOIN invoices i ON i.customerId = c.id AND i.invoiceDate >= l.createdAt
      WHERE l.createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY l.source
      ORDER BY totalRev DESC
    `);

    const results = extractRows(rows);
    const channels: Array<{ channel: string; leads: number; conversions: number; revenue: number; costPerLead: number; roi: string }> = [];

    for (const r of results) {
      const leads = Number(r.leadCount || 0);
      const conversions = Number(r.conversions || 0);
      const revenue = Math.round(Number(r.totalRev || 0) / 100);
      const costPerLead = 0; // No ad spend data in DB — placeholder
      const roi = leads > 0 ? `${Math.round((conversions / leads) * 100)}% conversion` : "N/A";
      channels.push({ channel: String(r.channel || "unknown"), leads, conversions, revenue, costPerLead, roi });
    }

    const best = channels.length > 0 ? channels[0].channel : "N/A";
    const worst = channels.length > 0 ? channels[channels.length - 1].channel : "N/A";

    return { channels, bestChannel: best, worstChannel: worst };
  } catch {
    return { channels: [], bestChannel: "N/A", worstChannel: "N/A" };
  }
}

// ═══════════════════════════════════════════════════════════
// #30 REVIEW VELOCITY
// ═══════════════════════════════════════════════════════════

export async function analyzeReviewVelocity(): Promise<{
  thisMonth: number;
  lastMonth: number;
  velocity: number;
  trend: "accelerating" | "decelerating" | "steady";
  projectedAnnual: number;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT
        SUM(CASE WHEN review_date >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 ELSE 0 END) as thisMonth,
        SUM(CASE WHEN review_date >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m-01')
                   AND review_date < DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 ELSE 0 END) as lastMonth,
        COUNT(*) as totalReviews
      FROM review_replies
      WHERE review_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
    `);

    const r = extractOne(rows);
    const thisMonth = Number(r.thisMonth || 0);
    const lastMonth = Number(r.lastMonth || 0);
    const totalReviews = Number(r.totalReviews || 0);
    const velocity = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0;
    const trend = velocity > 10 ? "accelerating" : velocity < -10 ? "decelerating" : "steady";
    const recentMonthlyRate = thisMonth > 0 ? thisMonth : lastMonth;
    const projectedAnnual = Math.round(recentMonthlyRate * 12);

    return { thisMonth, lastMonth, velocity, trend, projectedAnnual };
  } catch {
    return { thisMonth: 0, lastMonth: 0, velocity: 0, trend: "steady", projectedAnnual: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #31 SMS ENGAGEMENT
// ═══════════════════════════════════════════════════════════

export async function analyzeSmsEngagement(): Promise<{
  byCampaign: Array<{ campaign: string; sent: number; replies: number; optOuts: number; responseRate: number }>;
  bestPerforming: string;
  optOutRate: number;
}> {
  try {
    const campaigns = await (await db()).select({
      id: smsCampaigns.id, name: smsCampaigns.name,
      sentCount: smsCampaigns.sentCount,
    }).from(smsCampaigns)
      .where(gte(smsCampaigns.createdAt, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`));

    const byCampaign: Array<{ campaign: string; sent: number; replies: number; optOuts: number; responseRate: number }> = [];
    let totalSent = 0;
    let totalOptOuts = 0;

    for (const camp of campaigns) {
      const sent = camp.sentCount || 0;
      totalSent += sent;

      // Count replies — inbound messages within 48h of campaign sends
      const replyRows = await (await db()).execute(sql`
        SELECT COUNT(*) as cnt FROM sms_messages
        WHERE direction = 'inbound'
          AND createdAt >= (SELECT MIN(createdAt) FROM sms_campaign_sends WHERE campaignId = ${camp.id})
          AND createdAt <= DATE_ADD((SELECT MAX(createdAt) FROM sms_campaign_sends WHERE campaignId = ${camp.id}), INTERVAL 48 HOUR)
      `);
      const replies = Number(extractOne(replyRows).cnt || 0);

      // Opt-outs approximation
      const optRows = await (await db()).execute(sql`
        SELECT COUNT(*) as cnt FROM sms_messages
        WHERE direction = 'inbound' AND LOWER(body) IN ('stop', 'unsubscribe', 'opt out', 'cancel')
          AND createdAt >= (SELECT MIN(createdAt) FROM sms_campaign_sends WHERE campaignId = ${camp.id})
      `);
      const optOuts = Number(extractOne(optRows).cnt || 0);
      totalOptOuts += optOuts;

      byCampaign.push({
        campaign: camp.name, sent, replies, optOuts,
        responseRate: sent > 0 ? Math.round((replies / sent) * 100) : 0,
      });
    }

    byCampaign.sort((a, b) => b.responseRate - a.responseRate);
    return {
      byCampaign,
      bestPerforming: byCampaign.length > 0 ? byCampaign[0].campaign : "N/A",
      optOutRate: totalSent > 0 ? Math.round((totalOptOuts / totalSent) * 100 * 100) / 100 : 0,
    };
  } catch {
    return { byCampaign: [], bestPerforming: "N/A", optOutRate: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #32 LEAD RESPONSE TIME
// ═══════════════════════════════════════════════════════════

export async function analyzeLeadResponseTime(): Promise<{
  avgMinutes: number;
  under5min: number;
  under30min: number;
  over1hour: number;
  conversionBySpeed: Array<{ bucket: string; leads: number; converted: number; rate: number }>;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT l.id, l.status,
        TIMESTAMPDIFF(MINUTE, l.createdAt, l.contactedAt) as responseMinutes
      FROM leads l
      WHERE l.createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        AND l.contactedAt IS NOT NULL
    `);

    const results = extractRows(rows);
    const data = results;

    let totalMinutes = 0;
    let under5 = 0;
    let under30 = 0;
    let over60 = 0;
    const buckets: Record<string, { leads: number; converted: number }> = {
      "Under 5 min": { leads: 0, converted: 0 },
      "5-30 min": { leads: 0, converted: 0 },
      "30-60 min": { leads: 0, converted: 0 },
      "Over 1 hour": { leads: 0, converted: 0 },
    };

    for (const r of data) {
      const mins = Number(r.responseMinutes || 0);
      const converted = ["booked", "completed"].includes(String(r.status || ""));
      totalMinutes += mins;

      if (mins < 5) { under5++; buckets["Under 5 min"].leads++; if (converted) buckets["Under 5 min"].converted++; }
      else if (mins < 30) { under30++; buckets["5-30 min"].leads++; if (converted) buckets["5-30 min"].converted++; }
      else if (mins < 60) { buckets["30-60 min"].leads++; if (converted) buckets["30-60 min"].converted++; }
      else { over60++; buckets["Over 1 hour"].leads++; if (converted) buckets["Over 1 hour"].converted++; }
    }

    const conversionBySpeed = Object.entries(buckets).map(([bucket, d]) => ({
      bucket, leads: d.leads, converted: d.converted,
      rate: d.leads > 0 ? Math.round((d.converted / d.leads) * 100) : 0,
    }));

    return {
      avgMinutes: data.length > 0 ? Math.round(totalMinutes / data.length) : 0,
      under5min: under5, under30min: under30 + under5, over1hour: over60,
      conversionBySpeed,
    };
  } catch {
    return { avgMinutes: 0, under5min: 0, under30min: 0, over1hour: 0, conversionBySpeed: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// #33 CONTENT PERFORMANCE
// ═══════════════════════════════════════════════════════════

export async function analyzeContentPerformance(): Promise<{
  topPages: Array<{ page: string; leads: number; bookings: number; conversionRate: number }>;
  topReferrers: Array<{ source: string; visits: number; leads: number }>;
}> {
  try {
    // Analyze landing pages that generate leads
    const pageRows = await (await db()).execute(sql`
      SELECT landingPage as page,
        COUNT(*) as leadCount,
        SUM(CASE WHEN status IN ('booked', 'completed') THEN 1 ELSE 0 END) as bookingCount
      FROM leads
      WHERE landingPage IS NOT NULL AND landingPage != ''
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY landingPage
      ORDER BY leadCount DESC
      LIMIT 15
    `);

    const pageResults = extractRows(pageRows);
    const topPages = pageResults.map((r: RawRow) => ({
      page: String(r.page || ""),
      leads: Number(r.leadCount || 0),
      bookings: Number(r.bookingCount || 0),
      conversionRate: Number(r.leadCount) > 0 ? Math.round((Number(r.bookingCount) / Number(r.leadCount)) * 100) : 0,
    }));

    // Analyze referrers
    const refRows = await (await db()).execute(sql`
      SELECT referrer as source,
        COUNT(*) as visits,
        SUM(CASE WHEN status != 'new' THEN 1 ELSE 0 END) as leadCount
      FROM leads
      WHERE referrer IS NOT NULL AND referrer != ''
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY referrer
      ORDER BY visits DESC
      LIMIT 10
    `);

    const refResults = extractRows(refRows);
    const topReferrers = refResults.map((r: RawRow) => ({
      source: String(r.source || ""),
      visits: Number(r.visits || 0),
      leads: Number(r.leadCount || 0),
    }));

    return { topPages, topReferrers };
  } catch {
    return { topPages: [], topReferrers: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// #34 COMPETITOR GAP ANALYSIS
// ═══════════════════════════════════════════════════════════

export async function analyzeCompetitorGap(): Promise<{
  us: { rating: number; reviewCount: number; responseRate: number };
  competitors: Array<{ name: string; rating: number; reviewCount: number; gap: string }>;
  advantage: string;
}> {
  try {
    // Our review stats from review_replies table
    const ourRows = await (await db()).execute(sql`
      SELECT
        ROUND(AVG(review_rating), 1) as avgRating,
        COUNT(*) as totalReviews,
        SUM(CASE WHEN final_reply IS NOT NULL AND final_reply != '' THEN 1 ELSE 0 END) as repliedCount
      FROM review_replies
      WHERE review_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
    `);

    const our = extractOne(ourRows);
    const rating = Number(our.avgRating || 4.5);
    const reviewCount = Number(our.totalReviews || 0);
    const repliedCount = Number(our.repliedCount || 0);
    const responseRate = reviewCount > 0 ? Math.round((repliedCount / reviewCount) * 100) : 0;

    // Known Cleveland-area competitor benchmarks (static — updated periodically)
    const competitors = [
      { name: "Conrad's Tire Express", rating: 4.3, reviewCount: 450, gap: "" },
      { name: "Rad Air Complete Car Care", rating: 4.4, reviewCount: 380, gap: "" },
      { name: "Tire Choice Auto Service", rating: 3.9, reviewCount: 200, gap: "" },
      { name: "Midas Cleveland", rating: 3.7, reviewCount: 160, gap: "" },
    ];

    for (const c of competitors) {
      const ratingDiff = Math.round((rating - c.rating) * 10) / 10;
      const countDiff = reviewCount - c.reviewCount;
      c.gap = ratingDiff > 0
        ? `+${ratingDiff} stars ahead, ${countDiff > 0 ? `+${countDiff}` : countDiff} reviews`
        : `${ratingDiff} stars behind, ${countDiff > 0 ? `+${countDiff}` : countDiff} reviews`;
    }

    const beatingAll = competitors.every(c => rating >= c.rating);
    const advantage = beatingAll
      ? `Leading all competitors with ${rating} stars and ${responseRate}% response rate`
      : `Focus on review collection — ${reviewCount} reviews vs avg ${Math.round(competitors.reduce((s, c) => s + c.reviewCount, 0) / competitors.length)} competitor reviews`;

    return { us: { rating, reviewCount, responseRate }, competitors, advantage };
  } catch {
    return {
      us: { rating: 0, reviewCount: 0, responseRate: 0 },
      competitors: [],
      advantage: "Unable to analyze",
    };
  }
}
