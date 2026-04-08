/**
 * Growth Engines (#44-50)
 *
 * analyzeChatFunnel, analyzeReviewSentiment, analyzeWebsiteJourneys,
 * analyzeCallPatterns, analyzeNewCustomerVelocity, analyzeReferralNetwork,
 * forecastPortfolioLTV
 */

import { sql } from "drizzle-orm";
import { RawRow, extractRows, extractOne, db } from "./shared";

// ═══════════════════════════════════════════════════════════
// #44 CHAT CONVERSION FUNNEL
// ═══════════════════════════════════════════════════════════

export async function analyzeChatFunnel(): Promise<{
  opened: number;
  engaged: number;
  sharedInfo: number;
  convertedToLead: number;
  booked: number;
  dropOffStage: string;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT cs.id, cs.messagesJson, cs.converted, cs.leadId,
        (SELECT l.status FROM leads l WHERE l.id = cs.leadId) as leadStatus
      FROM chat_sessions cs
      WHERE cs.createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    `);

    const results = extractRows(rows);
    const sessions = results;

    let opened = sessions.length;
    let engaged = 0;
    let sharedInfo = 0;
    let convertedToLead = 0;
    let booked = 0;

    for (const s of sessions) {
      try {
        const messages: Array<{ role?: string; content?: string }> = JSON.parse(String(s.messagesJson || "[]"));
        const userMessages = messages.filter((m) => m.role === "user");
        if (userMessages.length >= 3) engaged++;

        // Shared info: user provided phone or name in messages
        const hasContactInfo = userMessages.some((m) => {
          const content = String(m.content || "");
          return /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(content) || content.length > 20;
        });
        if (hasContactInfo) sharedInfo++;
      } catch {
        // invalid JSON — skip message parsing
      }

      if (Number(s.converted) === 1 || s.leadId) convertedToLead++;
      if (s.leadStatus === "booked" || s.leadStatus === "completed") booked++;
    }

    // Find biggest drop-off
    const funnelSteps = [
      { name: "opened→engaged", from: opened, to: engaged },
      { name: "engaged→sharedInfo", from: engaged, to: sharedInfo },
      { name: "sharedInfo→lead", from: sharedInfo, to: convertedToLead },
      { name: "lead→booked", from: convertedToLead, to: booked },
    ];
    let maxDrop = 0;
    let dropOffStage = "None";
    for (const step of funnelSteps) {
      if (step.from > 0) {
        const dropRate = (step.from - step.to) / step.from;
        if (dropRate > maxDrop) { maxDrop = dropRate; dropOffStage = step.name; }
      }
    }

    return { opened, engaged, sharedInfo, convertedToLead, booked, dropOffStage };
  } catch {
    return { opened: 0, engaged: 0, sharedInfo: 0, convertedToLead: 0, booked: 0, dropOffStage: "Unknown" };
  }
}

// ═══════════════════════════════════════════════════════════
// #45 REVIEW SENTIMENT BREAKDOWN
// ═══════════════════════════════════════════════════════════

export async function analyzeReviewSentiment(): Promise<{
  topics: Array<{ topic: string; positive: number; negative: number; neutral: number; score: number }>;
  overallSentiment: number;
  trendingPositive: string[];
  trendingNegative: string[];
}> {
  try {
    const TOPIC_PATTERNS: Record<string, RegExp> = {
      pricing: /price|cost|expensive|cheap|affordable|deal|fair|overcharge|rip.?off|worth/i,
      "wait time": /wait|slow|fast|quick|took.?long|hours|prompt|delay|time/i,
      quality: /quality|great.?work|perfect|excellent|terrible|sloppy|professional|thorough|right/i,
      friendliness: /friendly|nice|rude|helpful|kind|welcom|attitude|courteous|pleasant|mean/i,
      cleanliness: /clean|dirty|neat|messy|organized|tidy|filthy/i,
      communication: /communicat|explain|inform|updat|call|text|told|honest|transparent/i,
      trust: /trust|honest|reliable|recommend|integrity|dependable|scam/i,
    };

    const rows = await (await db()).execute(sql`
      SELECT review_text, review_rating
      FROM review_replies
      WHERE review_text IS NOT NULL AND review_text != ''
        AND review_date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
    `);

    const results = extractRows(rows);
    const reviews = results;

    const topicStats: Record<string, { positive: number; negative: number; neutral: number }> = {};
    for (const topic of Object.keys(TOPIC_PATTERNS)) {
      topicStats[topic] = { positive: 0, negative: 0, neutral: 0 };
    }

    let totalRating = 0;

    for (const r of reviews) {
      const text = String(r.review_text || "");
      const rating = Number(r.review_rating || 3);
      totalRating += rating;

      for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS)) {
        if (pattern.test(text)) {
          if (rating >= 4) topicStats[topic].positive++;
          else if (rating <= 2) topicStats[topic].negative++;
          else topicStats[topic].neutral++;
        }
      }
    }

    const topics = Object.entries(topicStats).map(([topic, data]) => {
      const total = data.positive + data.negative + data.neutral;
      const score = total > 0 ? Math.round(((data.positive - data.negative) / total) * 100) : 0;
      return { topic, ...data, score };
    }).sort((a, b) => b.score - a.score);

    const overallSentiment = reviews.length > 0 ? Math.round((totalRating / reviews.length) * 10) / 10 : 0;
    const trendingPositive = topics.filter(t => t.score > 50 && (t.positive + t.negative + t.neutral) > 3).map(t => t.topic);
    const trendingNegative = topics.filter(t => t.score < -20 && (t.positive + t.negative + t.neutral) > 3).map(t => t.topic);

    return { topics, overallSentiment, trendingPositive, trendingNegative };
  } catch {
    return { topics: [], overallSentiment: 0, trendingPositive: [], trendingNegative: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// #46 WEBSITE JOURNEY ANALYSIS
// ═══════════════════════════════════════════════════════════

export async function analyzeWebsiteJourneys(): Promise<{
  topLandingPages: Array<{ page: string; leads: number; conversionRate: number }>;
  topConversionPaths: Array<{ path: string; count: number }>;
}> {
  try {
    // Landing pages that generate leads
    const pageRows = await (await db()).execute(sql`
      SELECT landingPage as page,
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('booked', 'completed') THEN 1 ELSE 0 END) as converted
      FROM leads
      WHERE landingPage IS NOT NULL AND landingPage != ''
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY landingPage
      ORDER BY total DESC
      LIMIT 15
    `);

    const pageResults = extractRows(pageRows);
    const topLandingPages = pageResults.map((r: RawRow) => ({
      page: String(r.page || ""),
      leads: Number(r.total || 0),
      conversionRate: Number(r.total) > 0 ? Math.round((Number(r.converted) / Number(r.total)) * 100) : 0,
    }));

    // Source→landing page paths
    const pathRows = await (await db()).execute(sql`
      SELECT CONCAT(COALESCE(source, 'direct'), ' → ', COALESCE(landingPage, '/')) as path,
        COUNT(*) as cnt
      FROM leads
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY CONCAT(COALESCE(source, 'direct'), ' → ', COALESCE(landingPage, '/'))
      ORDER BY cnt DESC
      LIMIT 10
    `);

    const pathResults = extractRows(pathRows);
    const topConversionPaths = pathResults.map((r: RawRow) => ({
      path: String(r.path || ""),
      count: Number(r.cnt || 0),
    }));

    return { topLandingPages, topConversionPaths };
  } catch {
    return { topLandingPages: [], topConversionPaths: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// #47 CALL PATTERN ANALYSIS
// ═══════════════════════════════════════════════════════════

export async function analyzeCallPatterns(): Promise<{
  hourlyVolume: Array<{ hour: number; calls: number }>;
  topSourcePages: Array<{ page: string; calls: number }>;
  callToBookingRate: number;
  peakCallHour: number;
}> {
  try {
    // Hourly distribution
    const hourRows = await (await db()).execute(sql`
      SELECT HOUR(createdAt) as hr, COUNT(*) as cnt
      FROM call_events
      WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY HOUR(createdAt)
      ORDER BY hr
    `);

    const hourResults = extractRows(hourRows);
    const hourlyVolume: Array<{ hour: number; calls: number }> = [];
    let peakCallHour = 0;
    let peakCount = 0;

    for (const r of hourResults) {
      const hr = Number(r.hr);
      const calls = Number(r.cnt || 0);
      hourlyVolume.push({ hour: hr, calls });
      if (calls > peakCount) { peakCount = calls; peakCallHour = hr; }
    }

    // Source pages
    const srcRows = await (await db()).execute(sql`
      SELECT sourcePage as page, COUNT(*) as cnt
      FROM call_events
      WHERE sourcePage IS NOT NULL AND sourcePage != ''
        AND createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY sourcePage
      ORDER BY cnt DESC
      LIMIT 10
    `);

    const srcResults = extractRows(srcRows);
    const topSourcePages = srcResults.map((r: RawRow) => ({
      page: String(r.page || ""),
      calls: Number(r.cnt || 0),
    }));

    // Call-to-booking rate: calls that have matching phone in bookings
    const convRows = await (await db()).execute(sql`
      SELECT
        COUNT(DISTINCT ce.id) as totalCalls,
        COUNT(DISTINCT b.id) as matchedBookings
      FROM call_events ce
      LEFT JOIN bookings b ON RIGHT(b.phone, 10) = RIGHT(ce.phoneNumber, 10)
        AND b.createdAt >= ce.createdAt
        AND b.createdAt <= DATE_ADD(ce.createdAt, INTERVAL 7 DAY)
      WHERE ce.createdAt >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    `);

    const conv = extractOne(convRows);
    const totalCalls = Number(conv.totalCalls || 0);
    const matchedBookings = Number(conv.matchedBookings || 0);
    const callToBookingRate = totalCalls > 0 ? Math.round((matchedBookings / totalCalls) * 100) : 0;

    return { hourlyVolume, topSourcePages, callToBookingRate, peakCallHour };
  } catch {
    return { hourlyVolume: [], topSourcePages: [], callToBookingRate: 0, peakCallHour: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #48 NEW CUSTOMER VELOCITY
// ═══════════════════════════════════════════════════════════

export async function analyzeNewCustomerVelocity(): Promise<{
  thisMonth: number;
  lastMonth: number;
  velocity: number;
  trend: "accelerating" | "decelerating" | "steady";
  projectedYearEnd: number;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT
        SUM(CASE WHEN firstVisitDate >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 ELSE 0 END) as thisMonth,
        SUM(CASE WHEN firstVisitDate >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 1 MONTH), '%Y-%m-01')
                   AND firstVisitDate < DATE_FORMAT(NOW(), '%Y-%m-01') THEN 1 ELSE 0 END) as lastMonth,
        SUM(CASE WHEN firstVisitDate >= DATE_SUB(NOW(), INTERVAL 12 MONTH) THEN 1 ELSE 0 END) as lastYear
      FROM customers
      WHERE firstVisitDate IS NOT NULL
    `);

    const r = extractOne(rows);
    const thisMonth = Number(r.thisMonth || 0);
    const lastMonth = Number(r.lastMonth || 0);
    const lastYear = Number(r.lastYear || 0);
    const velocity = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0;
    const trend = velocity > 10 ? "accelerating" : velocity < -10 ? "decelerating" : "steady";

    // Project year-end based on monthly average
    const avgPerMonth = lastYear / 12;
    const monthsRemaining = 12 - new Date().getMonth();
    const projectedYearEnd = Math.round(lastYear + avgPerMonth * monthsRemaining);

    return { thisMonth, lastMonth, velocity, trend, projectedYearEnd };
  } catch {
    return { thisMonth: 0, lastMonth: 0, velocity: 0, trend: "steady", projectedYearEnd: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #49 REFERRAL NETWORK MAP
// ═══════════════════════════════════════════════════════════

export async function analyzeReferralNetwork(): Promise<{
  topReferrers: Array<{ name: string; phone: string; referralCount: number; convertedCount: number; totalRevenue: number }>;
  networkSize: number;
  avgReferralValue: number;
}> {
  try {
    // Single aggregated query: referrals + revenue in one pass (no N+1)
    const rows = await (await db()).execute(sql`
      SELECT r.referrerName as name, r.referrerPhone as phone,
        COUNT(DISTINCT r.id) as referralCount,
        SUM(CASE WHEN r.status IN ('visited', 'redeemed') THEN 1 ELSE 0 END) as convertedCount,
        COALESCE(SUM(i.totalAmount), 0) as totalRev
      FROM referrals r
      LEFT JOIN customers c ON RIGHT(c.phone, 10) = RIGHT(r.refereePhone, 10)
      LEFT JOIN invoices i ON i.customerId = c.id
      GROUP BY r.referrerPhone, r.referrerName
      ORDER BY totalRev DESC
      LIMIT 30
    `);

    const results = extractRows(rows);
    const topReferrers: Array<{ name: string; phone: string; referralCount: number; convertedCount: number; totalRevenue: number }> = [];

    for (const r of results) {
      topReferrers.push({
        name: String(r.name || ""),
        phone: String(r.phone || ""),
        referralCount: Number(r.referralCount || 0),
        convertedCount: Number(r.convertedCount || 0),
        totalRevenue: Math.round(Number(r.totalRev || 0) / 100),
      });
    }

    const networkSize = topReferrers.reduce((s, r) => s + r.referralCount, 0);
    const totalRefRevenue = topReferrers.reduce((s, r) => s + r.totalRevenue, 0);
    const avgReferralValue = networkSize > 0 ? Math.round(totalRefRevenue / networkSize) : 0;

    topReferrers.sort((a, b) => b.totalRevenue - a.totalRevenue);
    return { topReferrers: topReferrers.slice(0, 15), networkSize, avgReferralValue };
  } catch {
    return { topReferrers: [], networkSize: 0, avgReferralValue: 0 };
  }
}

// ═══════════════════════════════════════════════════════════
// #50 LIFETIME VALUE FORECAST
// ═══════════════════════════════════════════════════════════

export async function forecastPortfolioLTV(): Promise<{
  totalProjectedLTV: number;
  avgCustomerLTV: number;
  ltvBySegment: Array<{ segment: string; count: number; avgLTV: number; totalLTV: number }>;
  growthRate: number;
}> {
  try {
    const rows = await (await db()).execute(sql`
      SELECT c.id, c.totalSpent, c.totalVisits, c.firstVisitDate, c.lastVisitDate,
        c.customerType
      FROM customers c
      WHERE c.totalVisits >= 1 AND c.firstVisitDate IS NOT NULL
    `);

    const results = extractRows(rows);
    const customers_data = results;

    const segments: Record<string, { count: number; totalLTV: number }> = {
      "VIP (10+ visits)": { count: 0, totalLTV: 0 },
      "Loyal (5-9 visits)": { count: 0, totalLTV: 0 },
      "Repeat (2-4 visits)": { count: 0, totalLTV: 0 },
      "Single visit": { count: 0, totalLTV: 0 },
      "Commercial": { count: 0, totalLTV: 0 },
    };

    let totalProjectedLTV = 0;
    let recentSpend = 0;
    let olderSpend = 0;

    for (const c of customers_data) {
      const spent = Number(c.totalSpent || 0) / 100;
      const visits = Number(c.totalVisits || 1);
      const firstDate = c.firstVisitDate ? new Date(String(c.firstVisitDate)) : new Date();
      const lastDate = c.lastVisitDate ? new Date(String(c.lastVisitDate)) : new Date();
      const tenureDays = Math.max(1, (Date.now() - firstDate.getTime()) / 86400000);
      const daysSinceLast = (Date.now() - lastDate.getTime()) / 86400000;

      // Project 5-year LTV based on current spend velocity
      const spendPerDay = spent / tenureDays;
      const retentionFactor = daysSinceLast > 365 ? 0.2 : daysSinceLast > 180 ? 0.5 : daysSinceLast > 90 ? 0.8 : 1.0;
      const projectedLTV = Math.round(spendPerDay * 365 * 5 * retentionFactor);

      totalProjectedLTV += projectedLTV;

      // Segment
      let segment: string;
      if (c.customerType === "commercial") segment = "Commercial";
      else if (visits >= 10) segment = "VIP (10+ visits)";
      else if (visits >= 5) segment = "Loyal (5-9 visits)";
      else if (visits >= 2) segment = "Repeat (2-4 visits)";
      else segment = "Single visit";

      segments[segment].count++;
      segments[segment].totalLTV += projectedLTV;

      // Growth rate: last 6 months vs prior 6 months
      if (lastDate.getTime() > Date.now() - 180 * 86400000) recentSpend += spent;
      else if (lastDate.getTime() > Date.now() - 360 * 86400000) olderSpend += spent;
    }

    const avgCustomerLTV = customers_data.length > 0 ? Math.round(totalProjectedLTV / customers_data.length) : 0;

    const ltvBySegment = Object.entries(segments)
      .filter(([, data]) => data.count > 0)
      .map(([segment, data]) => ({
        segment,
        count: data.count,
        avgLTV: Math.round(data.totalLTV / data.count),
        totalLTV: Math.round(data.totalLTV),
      }))
      .sort((a, b) => b.totalLTV - a.totalLTV);

    const growthRate = olderSpend > 0 ? Math.round(((recentSpend - olderSpend) / olderSpend) * 100) : 0;

    return { totalProjectedLTV: Math.round(totalProjectedLTV), avgCustomerLTV, ltvBySegment, growthRate };
  } catch {
    return { totalProjectedLTV: 0, avgCustomerLTV: 0, ltvBySegment: [], growthRate: 0 };
  }
}
