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

import { db } from "../lib/db-helper";

import { BUSINESS } from "@shared/business";
const log = createLogger("feedback-loop");

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
    // An unknown outcome is not a lesson: 'Alert "proactive" was unknown. Outcome
    // unknown.' reached 2,517 uses and a permanent seat in Nick's prompt (2026-09-22).
    const { alertOutcomeMemoryContent } = await import("./memoryWriterGuards");
    const content = alertOutcomeMemoryContent(alertType, outcome);
    if (!content) return;
    const { remember } = await import("./nickMemory");
    await remember({
      type: "lesson",
      content,
      source: "feedback_loop",
      confidence: outcome === "acted" ? 0.9 : 0.5,
    });
  } catch (e) { log.warn("[feedbackLoop:trackAlertOutcome] memory save for alert outcome failed:", e); }
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
  } catch (e) { log.warn("[feedbackLoop:recordReviewResult] memory save for review result failed:", e); }
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
    } catch (e) { log.warn("[feedbackLoop:feedbackCycle] anomaly detection + memory save failed:", e); }
  }

  // 2. Check brief engagement
  const brief = getBriefEngagement();
  if (brief.sent && !brief.responded) {
    processed++;
  }

  // 4. Memory decay — reduce stale memories, prune dead ones
  try {
    const { decayMemories } = await import("./nickMemory");
    const decayed = await decayMemories();
    if (decayed > 0) {
      log.info(`Memory decay: ${decayed} memories aged or pruned`);
      processed += decayed;
    }
  } catch (e) { log.warn("[feedbackLoop:feedbackCycle] memory decay failed:", e); }

  // 4. Proactive memory alerts — fire Telegram for memory-driven insights
  try {
    const { getProactiveMemoryAlerts } = await import("./nickMemory");
    const memAlerts = await getProactiveMemoryAlerts();
    if (memAlerts.length > 0) {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(
        `🧠 NICK AI — Proactive (from memory)\n\n` +
        memAlerts.join("\n\n"), "digest"
      );
      processed += memAlerts.length;
    }
  } catch (e) { log.warn("[feedbackLoop:feedbackCycle] proactive memory alerts failed:", e); }

  return { recordsProcessed: processed, details: `${anomalies.length} anomalies, brief: ${brief.engagementRate}` };
}
