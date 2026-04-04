/**
 * Feedback Loop — Makes EVERY connection bidirectional.
 *
 * Tracks outcomes of actions, alerts, and recommendations.
 * Feeds results back into Nick AI's memory so he gets smarter
 * about what works and what doesn't.
 *
 * This is the missing piece: not just DOING things,
 * but LEARNING from the results of doing things.
 */

import { createLogger } from "../lib/logger";
import { sql } from "drizzle-orm";

const log = createLogger("feedback-loop");

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

// ─── EVENT ANALYTICS (track patterns over time) ──────

const eventCounts: Record<string, number[]> = {};

/**
 * Record an event occurrence for pattern detection.
 * Called from event bus on every event.
 */
export function recordEventOccurrence(eventType: string): void {
  // Safety cap — prevent unbounded key growth from unexpected event types
  if (!eventCounts[eventType] && Object.keys(eventCounts).length >= 50) return;
  if (!eventCounts[eventType]) eventCounts[eventType] = [];
  eventCounts[eventType].push(Date.now());

  // Keep last 100 timestamps per type
  if (eventCounts[eventType].length > 100) {
    eventCounts[eventType] = eventCounts[eventType].slice(-100);
  }
}

/**
 * Detect anomalies in event frequency.
 * Returns events that are unusually high or low vs their average.
 */
export function detectAnomalies(): Array<{ type: string; current: number; average: number; deviation: string }> {
  const anomalies: Array<{ type: string; current: number; average: number; deviation: string }> = [];
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;

  for (const [type, timestamps] of Object.entries(eventCounts)) {
    const lastHour = timestamps.filter(t => t > hourAgo).length;
    const last24h = timestamps.filter(t => t > dayAgo).length;
    const avgPerHour = last24h / 24;

    if (avgPerHour > 0 && lastHour > avgPerHour * 3) {
      anomalies.push({ type, current: lastHour, average: Math.round(avgPerHour * 10) / 10, deviation: "HIGH" });
    }
    if (avgPerHour > 2 && lastHour === 0) {
      anomalies.push({ type, current: 0, average: Math.round(avgPerHour * 10) / 10, deviation: "LOW" });
    }
  }

  return anomalies;
}

// ─── ALERT OUTCOME TRACKING ──────────────────────────

/**
 * Track if a proactive alert led to action.
 * Called when we detect activity after sending an alert.
 */
export async function trackAlertOutcome(alertType: string, outcome: "acted" | "ignored" | "unknown"): Promise<void> {
  try {
    const { remember } = await import("./nickMemory");
    await remember({
      type: "lesson",
      content: `Alert "${alertType}" was ${outcome}. ${outcome === "acted" ? "This type of alert drives action — keep sending." : outcome === "ignored" ? "This alert type may need a different approach or timing." : "Outcome unknown."}`,
      source: "feedback_loop",
      confidence: outcome === "acted" ? 0.9 : 0.5,
    });
  } catch {}
}

// ─── SELF-REVIEW FEEDBACK ────────────────────────────

/**
 * Store self-review results in memory for quality tracking.
 */
export async function recordReviewResult(contentType: string, score: number, issues: string[]): Promise<void> {
  try {
    const { remember } = await import("./nickMemory");
    if (score < 7) {
      await remember({
        type: "lesson",
        content: `Self-review scored ${score}/10 for ${contentType}. Issues: ${issues.join(", ")}. Learning: improve ${issues[0] || "quality"} in future ${contentType} content.`,
        source: "self_review",
        confidence: 0.85,
      });
    }
    if (score >= 9) {
      await remember({
        type: "lesson",
        content: `Self-review scored ${score}/10 for ${contentType}. This format/approach works well — replicate for future ${contentType}.`,
        source: "self_review",
        confidence: 0.8,
      });
    }
  } catch {}
}

// ─── BRIEF DELIVERY TRACKING ─────────────────────────

let lastBriefSentAt: string | null = null;
let lastBriefResponseAt: string | null = null;

export function recordBriefSent(): void {
  lastBriefSentAt = new Date().toISOString();
}

export function recordBriefResponse(): void {
  lastBriefResponseAt = new Date().toISOString();
}

export function getBriefEngagement(): { sent: string | null; responded: string | null; engagementRate: string } {
  return {
    sent: lastBriefSentAt,
    responded: lastBriefResponseAt,
    engagementRate: lastBriefSentAt && lastBriefResponseAt ? "engaged" : lastBriefSentAt ? "sent_no_response" : "none",
  };
}

// ─── REVENUE IMPACT TRACKING ─────────────────────────

/**
 * Compare revenue before and after an action was taken.
 * Called after alerts to measure if they drove results.
 */
// Store pending impact measurements — checked in the feedback cycle
const pendingImpacts: Array<{ action: string; beforeRevenue: number; timestamp: number; date: string }> = [];

export async function measureRevenueImpact(actionName: string, beforeRevenue: number): Promise<void> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  pendingImpacts.push({ action: actionName, beforeRevenue, timestamp: Date.now(), date: today });
  // Cap to prevent unbounded growth
  if (pendingImpacts.length > 20) pendingImpacts.splice(0, pendingImpacts.length - 20);
}

/** Check stored impact measurements — called from feedback cycle */
export async function checkPendingImpacts(): Promise<number> {
  if (pendingImpacts.length === 0) return 0;
  const now = Date.now();
  const twoHoursMs = 2 * 60 * 60 * 1000;
  let checked = 0;

  // Only check impacts that are at least 2 hours old AND same day (cross-day comparison is invalid)
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const ready = pendingImpacts.filter(p => now - p.timestamp > twoHoursMs && p.date === today);
  // Discard stale cross-day entries
  const stale = pendingImpacts.filter(p => p.date !== today && now - p.timestamp > twoHoursMs);
  for (const s of stale) { const idx = pendingImpacts.indexOf(s); if (idx !== -1) pendingImpacts.splice(idx, 1); }
  if (ready.length === 0) return 0;

  try {
    const { getShopPulse } = await import("./nickIntelligence");
    const { remember } = await import("./nickMemory");
    const pulse = await getShopPulse();
    const currentRevenue = pulse.today.revenue;

    for (const impact of ready) {
      const delta = currentRevenue - impact.beforeRevenue;
      const idx = pendingImpacts.indexOf(impact);
      if (idx !== -1) pendingImpacts.splice(idx, 1);

      await remember({
        type: "lesson",
        content: `After "${impact.action}" action, revenue ${delta > 0 ? "increased" : "changed"} by $${delta} over ${Math.round((now - impact.timestamp) / 3600000)}h. ${delta > 100 ? "This intervention type appears effective." : delta > 0 ? "Modest impact." : "No measurable revenue impact."}`,
        source: "feedback_loop",
        confidence: delta > 100 ? 0.8 : 0.5,
      });
      checked++;
    }
  } catch {}
  return checked;
}

// ─── FULL FEEDBACK CYCLE ─────────────────────────────

/**
 * Run the complete feedback cycle — checks all outcomes.
 * Called every 2 hours by the scheduler.
 */
export async function runFeedbackCycle(): Promise<{ recordsProcessed?: number; details?: string }> {
  let processed = 0;

  // 1. Check event anomalies
  const anomalies = detectAnomalies();
  if (anomalies.length > 0) {
    try {
      const { sendTelegram } = await import("./telegram");
      const { remember } = await import("./nickMemory");

      for (const a of anomalies) {
        await remember({
          type: "pattern",
          content: `Event anomaly: ${a.type} is ${a.deviation} — ${a.current} in last hour vs ${a.average}/hr average. ${a.deviation === "HIGH" ? "Surge detected." : "Drought detected."}`,
          source: "feedback_loop",
          confidence: 0.75,
        });
        processed++;
      }

      if (anomalies.some(a => a.deviation === "HIGH")) {
        await sendTelegram(
          `📊 NICK AI — Event anomaly detected\n\n` +
          anomalies.map(a => `${a.type}: ${a.current} (avg ${a.average}/hr) — ${a.deviation}`).join("\n")
        );
      }
    } catch {}
  }

  // 2. Check brief engagement
  const brief = getBriefEngagement();
  if (brief.sent && !brief.responded) {
    processed++;
  }

  // 3. Check pending revenue impact measurements
  try {
    const impactChecked = await checkPendingImpacts();
    processed += impactChecked;
  } catch {}

  // 4. Memory decay — reduce stale memories, prune dead ones
  try {
    const { decayMemories } = await import("./nickMemory");
    const decayed = await decayMemories();
    if (decayed > 0) {
      log.info(`Memory decay: ${decayed} memories aged or pruned`);
      processed += decayed;
    }
  } catch {}

  // 4. Proactive memory alerts — fire Telegram for memory-driven insights
  try {
    const { getProactiveMemoryAlerts } = await import("./nickMemory");
    const memAlerts = await getProactiveMemoryAlerts();
    if (memAlerts.length > 0) {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(
        `🧠 NICK AI — Proactive (from memory)\n\n` +
        memAlerts.join("\n\n")
      );
      processed += memAlerts.length;
    }
  } catch {}

  // 5. Revenue pacing — check if today is tracking ahead or behind
  try {
    const { getShopPulse, projectRevenue } = await import("./nickIntelligence");
    const [pulse, revenue] = await Promise.all([getShopPulse(), projectRevenue()]);
    const currentHour = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }), 10);
    const hoursOpen = Math.max(1, currentHour - 7); // Shop opens at 7am
    const totalBusinessHours = 14; // 7am-9pm = 14 hours
    const expectedByNow = revenue.avgDailyRevenue * (hoursOpen / totalBusinessHours);
    const pacing = pulse.today.revenue / Math.max(expectedByNow, 1);

    if (pacing < 0.5 && pulse.today.revenue > 0 && expectedByNow > 100) {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(
        `📉 Revenue pacing: $${pulse.today.revenue} today vs $${Math.round(expectedByNow)} expected by now (${Math.round(pacing * 100)}% of pace). Avg daily: $${revenue.avgDailyRevenue}.`
      );
      processed++;
    } else if (pacing > 1.5 && pulse.today.revenue > 200) {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(
        `🔥 Revenue pacing: $${pulse.today.revenue} today — ${Math.round(pacing * 100)}% of expected! Ahead of daily average ($${revenue.avgDailyRevenue}).`
      );
      processed++;
    }
  } catch {}

  return { recordsProcessed: processed, details: `${anomalies.length} anomalies, brief: ${brief.engagementRate}` };
}
