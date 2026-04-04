/**
 * Nick AI Memory — Persistent learning system.
 *
 * Nick learns from every interaction, stores insights, patterns, and
 * lessons in the database. Gets smarter over time.
 *
 * Memory types:
 * - insight: Business pattern or observation (e.g., "Tuesdays are slow")
 * - lesson: Something learned from an outcome (e.g., "Follow-up within 1hr converts 3x better")
 * - preference: Nour's preferences and decisions (e.g., "Prefers direct tone, no fluff")
 * - pattern: Recurring data pattern (e.g., "Brake jobs spike after first freeze")
 * - customer: Customer behavior insight (e.g., "Returning customers prefer morning drop-offs")
 */

import { createLogger } from "../lib/logger";
import { sql, desc, eq } from "drizzle-orm";

const log = createLogger("nick-memory");

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

export interface NickMemory {
  id: number;
  type: "insight" | "lesson" | "preference" | "pattern" | "customer";
  content: string;
  source: string;
  confidence: number;
  uses: number;
  createdAt: string;
}

/**
 * Store a new memory or reinforce an existing one
 */
export async function remember(params: {
  type: "insight" | "lesson" | "preference" | "pattern" | "customer";
  content: string;
  source: string;
  confidence?: number;
}): Promise<void> {
  const d = await db();
  if (!d) return;

  try {
    // Check for similar existing memory
    const { shopSettings } = await import("../../drizzle/schema");

    // Use shopSettings as a simple KV store for Nick's memories
    // Key format: nick_memory_{type}_{hash}
    const hash = simpleHash(params.content);
    const key = `nick_memory_${params.type}_${hash}`;

    const existing = await d.select().from(shopSettings).where(eq(shopSettings.key, key)).limit(1);

    if (existing.length > 0) {
      // Reinforce — increment uses and update confidence
      const data = JSON.parse(existing[0].value);
      data.uses = (data.uses || 1) + 1;
      data.confidence = Math.min(1.0, (data.confidence || 0.7) + 0.05);
      data.lastReinforced = new Date().toISOString();
      await d.update(shopSettings).set({ value: JSON.stringify(data) }).where(eq(shopSettings.key, key));
      log.info(`Memory reinforced: ${params.type} — ${params.content.slice(0, 50)}...`);
    } else {
      // New memory
      await d.insert(shopSettings).values({
        key,
        value: JSON.stringify({
          type: params.type,
          content: params.content,
          source: params.source,
          confidence: params.confidence || 0.7,
          uses: 1,
          createdAt: new Date().toISOString(),
          lastReinforced: new Date().toISOString(),
        }),
      });
      log.info(`Memory stored: ${params.type} — ${params.content.slice(0, 50)}...`);
    }
  } catch (err) {
    log.error("Memory store failed:", { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Recall memories by type or all
 */
export async function recall(params?: {
  type?: "insight" | "lesson" | "preference" | "pattern" | "customer";
  limit?: number;
}): Promise<NickMemory[]> {
  const d = await db();
  if (!d) return [];

  try {
    const { shopSettings } = await import("../../drizzle/schema");
    const prefix = params?.type ? `nick_memory_${params.type}_` : "nick_memory_";

    const rows = await d.select().from(shopSettings)
      .where(sql`${shopSettings.key} LIKE ${prefix + "%"}`)
      .limit(params?.limit || 50);

    return rows.map(r => {
      try {
        const data = JSON.parse(r.value);
        return {
          id: r.id,
          type: data.type || "insight",
          content: data.content || "",
          source: data.source || "",
          confidence: data.confidence || 0.7,
          uses: data.uses || 1,
          createdAt: data.createdAt || "",
        };
      } catch { return null; }
    }).filter(Boolean) as NickMemory[];
  } catch {
    return [];
  }
}

/**
 * Get memories formatted for injection into Nick AI's context
 */
export async function getMemoryContext(): Promise<string> {
  const memories = await recall({ limit: 30 });
  if (memories.length === 0) return "";

  // Sort by confidence * uses (most reliable + most used first)
  memories.sort((a, b) => (b.confidence * b.uses) - (a.confidence * a.uses));

  const grouped: Record<string, string[]> = {};
  for (const m of memories.slice(0, 20)) {
    if (!grouped[m.type]) grouped[m.type] = [];
    grouped[m.type].push(`- ${m.content} (confidence: ${Math.round(m.confidence * 100)}%, used ${m.uses}x)`);
  }

  let context = "\n\nNICK AI MEMORY (learned over time):";
  for (const [type, items] of Object.entries(grouped)) {
    context += `\n${type.toUpperCase()}:\n${items.join("\n")}`;
  }
  return context;
}

/**
 * Auto-learn from operator command interactions
 */
export async function learnFromInteraction(command: string, response: string): Promise<void> {
  if (command.length < 10 || response.length < 50) return;

  const { invokeLLM } = await import("../_core/llm");

  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are Nick AI's learning engine for Nick's Tire & Auto (Cleveland, OH).

ANALYZE this operator interaction and extract DETAILED, ACTIONABLE memories.

MEMORY TYPES:
- preference: How Nour likes things done. WHY matters. Include the reasoning.
  Example: "Nour wants estimates sent via Auto Labor Guide, not email. Reason: ALG is the CRM, keeps everything in one place."
- insight: Business observation with EVIDENCE and IMPLICATION.
  Example: "Walk-in customers on Saturdays tend to need tire services (3 of last 5 Saturday walk-ins were tire-related). Implication: stock popular tire sizes for weekend."
- lesson: Something that worked or failed, with CAUSE and EFFECT.
  Example: "Following up on estimates within 2 hours converts 3x better than next-day follow-up. Cause: customer is still in decision mode."
- pattern: Recurring behavior with FREQUENCY and CONTEXT.
  Example: "Nour checks revenue every morning before 8am. Pattern: daily, first thing. Use this to time the morning brief."
- customer: Customer-specific intelligence with HISTORY.
  Example: "JELKS, TINA is a repeat customer (2 visits). Vehicles: 2004 Mercury Mountaineer, 2013 VW Jetta. High-value: $300 total."
- decision: A decision Nour made with REASONING and ALTERNATIVES considered.
  Example: "Decided to use Snap Finance over Synchrony. Reason: faster approval, no credit check, virtual CC flow works with our system."

RULES:
- Be SPECIFIC — include names, numbers, dates, amounts
- Include the WHY / REASONING behind every memory
- Include CONTEXT — when, where, what triggered this
- Cross-reference related memories if applicable
- Skip if nothing meaningful to learn
- Max 3 memories per interaction, quality over quantity

Respond with JSON:
{
  "shouldLearn": true/false,
  "reasoning": "why these memories matter for future decisions",
  "memories": [
    { "type": "preference|insight|lesson|pattern|customer|decision", "content": "detailed memory with reasoning" }
  ]
}`,
        },
        {
          role: "user",
          content: `Command: ${command.slice(0, 800)}\n\nResponse: ${response.slice(0, 1500)}`,
        },
      ],
      maxTokens: 500,
    });

    const raw = result.choices?.[0]?.message?.content;
    if (raw && typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.shouldLearn && parsed.memories?.length) {
          for (const mem of parsed.memories.slice(0, 3)) {
            await remember({
              type: mem.type || "insight",
              content: mem.content,
              source: "operator_interaction",
              confidence: 0.75,
            });
          }
        }
      } catch {}
    }
  } catch {}
}

/**
 * Learn from business events (called by event bus on every high-value event)
 */
export async function learnFromEvent(eventType: string, data: Record<string, any>): Promise<void> {
  const now = new Date();
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getDay()];
  const hour = now.getHours();
  const period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

  try {
    switch (eventType) {
      case "invoice_created": {
        // totalAmount arrives in DOLLARS from event bus callers (they already convert cents→dollars)
        const amount = Math.round(data.totalAmount || 0);
        await remember({
          type: "pattern",
          content: `INVOICE: $${amount} on ${day} ${dateStr} at ${hour}:00 (${period}). Customer: ${data.customerName || "unknown"}. Vehicle: ${data.vehicleInfo || "N/A"}. Service: ${data.serviceDescription?.slice(0, 80) || "N/A"}. Source: ${data.source || "manual"}. Context: This tells us what services are being done, when, and for how much.`,
          source: "event_bus",
          confidence: 0.85,
        });
        break;
      }
      case "invoice_paid": {
        const amount = data.totalAmount || 0;
        await remember({
          type: "insight",
          content: `PAYMENT: $${amount} collected on ${day} ${dateStr} ${period}. Customer: ${data.customerName || "unknown"}. Method: ${data.method || "card"}. Reasoning: Payment timing tells us when customers prefer to pay and which payment methods they use. ${day} ${period} payments should inform staffing decisions.`,
          source: "event_bus",
          confidence: 0.9,
        });
        break;
      }
      case "lead_captured": {
        await remember({
          type: "pattern",
          content: `LEAD: New lead from "${data.source || "website"}" on ${day} ${dateStr} ${period}. Urgency: ${data.urgencyScore || "?"}/5. Name: ${data.name || "unknown"}. Phone: ${data.phone || "N/A"}. Context: Lead source and timing patterns help optimize marketing spend. High-urgency leads (4-5) need immediate callback. Track which sources produce the most conversions.`,
          source: "event_bus",
          confidence: 0.7,
        });
        break;
      }
      case "booking_created": {
        await remember({
          type: "customer",
          content: `DROP-OFF: ${data.name || "Customer"} dropped off for "${data.service || "service"}" on ${day} ${dateStr} ${period}. Vehicle: ${data.vehicle || "N/A"}. Install preference: ${data.installPreference || "walk-in"}. Context: Drop-off timing helps predict bay utilization. ${period} drop-offs on ${day}s should inform scheduling. Track which services are most popular per day.`,
          source: "event_bus",
          confidence: 0.75,
        });
        break;
      }
      case "booking_completed": {
        await remember({
          type: "lesson",
          content: `JOB COMPLETED: ${data.name || "Customer"}'s ${data.service || "repair"} finished on ${day} ${dateStr}. Reasoning: Completed jobs = revenue won. Track completion rate (jobs started vs finished same day). Fast turnaround = happy customers = more referrals.`,
          source: "event_bus",
          confidence: 0.8,
        });
        break;
      }
      case "tire_order_placed": {
        await remember({
          type: "pattern",
          content: `TIRE ORDER: ${data.quantity || "?"}x ${data.tireBrand || ""} ${data.tireModel || ""} (${data.tireSize || ""}). Customer: ${data.customerName || "unknown"}. Total: $${data.totalAmount || 0}. Ordered ${day} ${dateStr} ${period}. Context: Track which tire brands/sizes sell most. Popular sizes should be stocked. ${data.tireBrand || "Brand"} demand informs inventory decisions.`,
          source: "event_bus",
          confidence: 0.85,
        });
        break;
      }
      case "payment_received": {
        await remember({
          type: "insight",
          content: `CC PAYMENT: $${data.amount || 0} from ${data.customerName || "customer"} on ${day} ${dateStr} ${period}. Card: ****${data.cardLast4 || "????"}. Order: ${data.orderNumber || "N/A"}. Invoice: ${data.invoiceNumber || "N/A"}. Reasoning: Online CC payments before in-person visit indicate trust in the system. Track online vs in-person payment ratio to measure digital adoption.`,
          source: "event_bus",
          confidence: 0.9,
        });
        break;
      }
      case "estimate_generated": {
        await remember({
          type: "pattern",
          content: `ESTIMATE: ${data.repairTitle || "Repair"} for ${data.vehicle || "vehicle"}. Range: $${data.grandTotalLow || 0}-$${data.grandTotalHigh || 0}. Customer: ${data.customerName || "walk-in"}. Generated ${day} ${dateStr} ${period}. Context: Estimates that don't convert to invoices = lost revenue. Track estimate→invoice conversion by service type. High-value estimates need priority follow-up within 2 hours.`,
          source: "event_bus",
          confidence: 0.7,
        });
        break;
      }
      case "callback_requested": {
        await remember({
          type: "pattern",
          content: `CALLBACK: ${data.name || "Customer"} requested callback on ${day} ${dateStr} ${period}. Phone: ${data.phone || "N/A"}. Reason: ${data.reason || "general inquiry"}. Context: Callback timing reveals when customers need us most. ${period} callbacks on ${day}s inform staffing. Fast callback response = higher conversion. Track time-to-callback.`,
          source: "event_bus",
          confidence: 0.8,
        });
        break;
      }
      case "emergency_request": {
        await remember({
          type: "lesson",
          content: `EMERGENCY: ${data.name || "Customer"} called after-hours on ${day} ${dateStr} ${period}. Problem: ${data.problem || "not specified"}. Urgency: ${data.urgency || "high"}. Context: Emergencies reveal service gaps. Track what problems come in after hours — these are the services customers can't wait for. Consider extending hours if a pattern emerges.`,
          source: "event_bus",
          confidence: 0.95,
        });
        break;
      }
      case "review_detected": {
        const rating = data.rating || 3;
        await remember({
          type: rating >= 4 ? "insight" : "lesson",
          content: `REVIEW: ${rating}★ from ${data.customerName || "customer"} on ${day} ${dateStr}. Text: "${(data.reviewText || "").slice(0, 120)}". Context: ${rating >= 4 ? "Positive reviews reveal what we do well — double down." : "Low reviews reveal pain points — fix immediately."} Track rating trends weekly. Respond within 24h.`,
          source: "event_bus",
          confidence: 0.85,
        });
        break;
      }
      case "campaign_sent": {
        await remember({
          type: "insight",
          content: `CAMPAIGN: SMS campaign sent on ${day} ${dateStr}. Platforms: ${Array.isArray(data.platforms) ? data.platforms.join(", ") : "sms"}. Success: ${data.success ? "yes" : "no"}. Context: Track which campaigns drive leads within 48h. A/B test message timing and content. ${day} ${period} sends — compare response rates by day.`,
          source: "event_bus",
          confidence: 0.7,
        });
        break;
      }
      case "stage_changed": {
        await remember({
          type: "pattern",
          content: `STAGE CHANGE: ${data.workOrderId ? "WO#" + data.workOrderId : data.callbackId ? "Callback#" + data.callbackId : "Item"} moved to "${data.newStatus || "unknown"}" on ${day} ${dateStr} ${period}. Changed by: ${data.changedBy || "system"}. Context: Stage transitions reveal workflow speed. Track time between stages to find bottlenecks. Blocked items need escalation.`,
          source: "event_bus",
          confidence: 0.65,
        });
        break;
      }
      case "social_posted": {
        await remember({
          type: "insight",
          content: `SOCIAL POST: Published to ${Array.isArray(data.platforms) ? data.platforms.join(", ") : "social"} on ${day} ${dateStr} ${period}. Context: Track which post types and times drive the most engagement and leads.`,
          source: "event_bus",
          confidence: 0.5,
        });
        break;
      }
    }
  } catch {}
}

/**
 * Push memories to statenour-os so both systems share the same learned knowledge
 */
export async function syncMemoriesToStatenour(): Promise<number> {
  const memories = await recall({ limit: 30 });
  if (memories.length === 0) return 0;

  const statenourUrl = process.env.STATENOUR_SYNC_URL || "https://statenour-os.vercel.app";
  const syncKey = process.env.STATENOUR_SYNC_KEY || "";
  if (!syncKey) return 0;

  try {
    await fetch(`${statenourUrl}/api/sync/nour-os`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-sync-key": syncKey },
      body: JSON.stringify({
        module: "insights",
        data: {
          insightType: "nick_memories",
          title: `Nick AI has ${memories.length} learned memories`,
          detail: memories.slice(0, 10).map(m => `[${m.type}] ${m.content}`).join("\n"),
          metadata: { memoryCount: memories.length, topTypes: Object.entries(
            memories.reduce((acc, m) => { acc[m.type] = (acc[m.type] || 0) + 1; return acc; }, {} as Record<string, number>)
          )},
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    return memories.length;
  } catch { return 0; }
}

/**
 * Warm-up: load critical memories into a compact string for fast context injection
 */
export async function getWarmupContext(): Promise<string> {
  const memories = await recall({ limit: 15 });
  if (memories.length === 0) return "";

  // Sort by confidence × uses (most reliable first)
  memories.sort((a, b) => (b.confidence * b.uses) - (a.confidence * a.uses));

  // Group by type and format compactly
  const lines: string[] = [];
  for (const m of memories.slice(0, 10)) {
    lines.push(`[${m.type}|${Math.round(m.confidence * 100)}%|${m.uses}x] ${m.content}`);
  }

  return lines.length > 0 ? `\n\nNICK'S LEARNED KNOWLEDGE (${memories.length} memories):\n${lines.join("\n")}` : "";
}

// ─── MEMORY INTELLIGENCE ─────────────────────────────

// Track what Nour asks about — predict needs before he asks
const questionPatterns: Record<string, number[]> = {};

export function trackQuestion(topic: string): void {
  const key = topic.toLowerCase().slice(0, 50);
  if (!questionPatterns[key]) questionPatterns[key] = [];
  questionPatterns[key].push(Date.now());
  if (questionPatterns[key].length > 50) questionPatterns[key] = questionPatterns[key].slice(-50);
  // Cap keys
  if (Object.keys(questionPatterns).length > 100) {
    const sorted = Object.entries(questionPatterns).sort((a, b) => b[1].length - a[1].length);
    const keep = new Set(sorted.slice(0, 50).map(([k]) => k));
    for (const k of Object.keys(questionPatterns)) {
      if (!keep.has(k)) delete questionPatterns[k];
    }
  }
}

/** Get topics Nour asks about most — these should be surfaced proactively */
export function getTopQuestions(limit = 5): Array<{ topic: string; count: number; lastAsked: string }> {
  return Object.entries(questionPatterns)
    .map(([topic, timestamps]) => ({
      topic,
      count: timestamps.length,
      lastAsked: new Date(Math.max(...timestamps)).toISOString(),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Memory decay — reduce confidence of old, unused memories.
 * Called from the feedback cycle. Prevents stale knowledge from dominating.
 */
export async function decayMemories(): Promise<number> {
  const d = await db();
  if (!d) return 0;
  const { shopSettings } = await import("../../drizzle/schema");

  try {
    const rows = await d.select().from(shopSettings)
      .where(sql`${shopSettings.key} LIKE 'nick_memory_%'`)
      .limit(200);

    let decayed = 0;
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    for (const row of rows) {
      try {
        const data = JSON.parse(row.value);
        const lastUsed = new Date(data.lastReinforced || data.createdAt).getTime();
        const age = now - lastUsed;

        // Decay confidence by 5% for every 30 days of inactivity
        if (age > thirtyDaysMs && data.confidence > 0.3) {
          const decayFactor = Math.floor(age / thirtyDaysMs) * 0.05;
          data.confidence = Math.max(0.1, data.confidence - decayFactor);
          await d.update(shopSettings).set({ value: JSON.stringify(data) }).where(sql`${shopSettings.id} = ${row.id}`);
          decayed++;
        }

        // Prune dead memories (confidence < 0.15 and unused for 90d)
        if (data.confidence < 0.15 && age > thirtyDaysMs * 3) {
          await d.delete(shopSettings).where(sql`${shopSettings.id} = ${row.id}`);
          decayed++;
        }
      } catch {}
    }
    return decayed;
  } catch { return 0; }
}

/**
 * Detect contradictions — find memories that conflict with new data.
 * Returns memories that may need updating.
 */
export async function findContradictions(newContent: string): Promise<NickMemory[]> {
  const memories = await recall({ limit: 30 });
  if (memories.length === 0) return [];

  // Simple keyword overlap + contradiction signals
  const newWords = new Set(newContent.toLowerCase().split(/\s+/).filter(w => w.length > 4));
  const contradictions: NickMemory[] = [];

  for (const m of memories) {
    const memWords = new Set(m.content.toLowerCase().split(/\s+/).filter(w => w.length > 4));
    const overlap = [...newWords].filter(w => memWords.has(w)).length;

    // High overlap but different conclusion = potential contradiction
    if (overlap >= 3 && m.confidence < 0.8) {
      contradictions.push(m);
    }
  }

  return contradictions.slice(0, 3);
}

/**
 * Proactive memory triggers — check if any memory-based alert should fire.
 * Called from the feedback cycle. Returns alerts that Nick should send.
 */
export async function getProactiveMemoryAlerts(): Promise<string[]> {
  const alerts: string[] = [];
  const memories = await recall({ limit: 30 });

  const now = new Date();
  const dayName = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
  const hour = parseInt(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }), 10);

  for (const m of memories) {
    // Pattern memories that match current day/time
    if (m.type === "pattern" && m.confidence > 0.7) {
      const content = m.content.toLowerCase();
      const dayLower = dayName.toLowerCase();

      // "Tuesdays are slow" → alert on Tuesday morning
      if (content.includes(dayLower) && content.includes("slow") && hour >= 8 && hour <= 10) {
        alerts.push(`Memory alert: "${m.content.slice(0, 100)}..." — heads up, this matches today.`);
      }

      // "Brake jobs spike after first freeze" → seasonal pattern
      if (content.includes("spike") || content.includes("surge")) {
        alerts.push(`Pattern reminder: ${m.content.slice(0, 120)}`);
      }
    }

    // Lessons about follow-up timing
    if (m.type === "lesson" && m.confidence > 0.8 && m.content.toLowerCase().includes("follow-up")) {
      if (hour >= 9 && hour <= 11) {
        alerts.push(`Lesson reminder: ${m.content.slice(0, 120)}`);
      }
    }
  }

  // Question pattern alerts — surface what Nour usually asks about at this time
  const topQs = getTopQuestions(3);
  for (const q of topQs) {
    if (q.count >= 3) {
      alerts.push(`You often ask about "${q.topic}" (${q.count}x) — here's a proactive check.`);
    }
  }

  return alerts.slice(0, 5); // Max 5 proactive alerts
}

function simpleHash(str: string): string {
  let hash = 0;
  const normalized = str.toLowerCase().trim().replace(/\s+/g, " ");
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
