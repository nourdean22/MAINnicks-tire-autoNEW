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
  // Only learn from substantial interactions
  if (command.length < 10 || response.length < 50) return;

  const { invokeLLM } = await import("../_core/llm");

  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You extract learnable insights from operator interactions at Nick's Tire & Auto.

Given a command and response, identify if there's anything worth remembering for future interactions.

Rules:
- Only extract genuinely useful insights (not obvious things)
- Focus on preferences, patterns, decisions, and lessons
- Skip if there's nothing meaningful to learn
- Be specific — "Nour prefers X over Y" not "Nour has preferences"

Respond with JSON:
{
  "shouldLearn": true/false,
  "memories": [
    { "type": "preference|insight|lesson|pattern|customer", "content": "the insight" }
  ]
}

If nothing to learn, return { "shouldLearn": false, "memories": [] }`,
        },
        {
          role: "user",
          content: `Command: ${command.slice(0, 500)}\n\nResponse: ${response.slice(0, 1000)}`,
        },
      ],
      maxTokens: 300,
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
              confidence: 0.7,
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

  try {
    switch (eventType) {
      case "invoice_created":
      case "invoice_paid": {
        const amount = data.totalAmount || 0;
        await remember({
          type: "pattern",
          content: `Invoice $${amount} on ${day} ${period}. Customer: ${data.customerName || "unknown"}`,
          source: "event_bus",
          confidence: 0.8,
        });
        break;
      }
      case "lead_captured": {
        await remember({
          type: "pattern",
          content: `New lead from ${data.source || "website"} on ${day} ${period}. Urgency: ${data.urgencyScore || "?"}`,
          source: "event_bus",
          confidence: 0.6,
        });
        break;
      }
      case "booking_created": {
        await remember({
          type: "customer",
          content: `${data.name || "Customer"} booked ${data.service || "service"} on ${day} ${period}`,
          source: "event_bus",
          confidence: 0.7,
        });
        break;
      }
      case "tire_order_placed": {
        await remember({
          type: "pattern",
          content: `Tire order: ${data.quantity || "?"}x ${data.tireBrand || ""} ${data.tireModel || ""}. Customer: ${data.customerName || "unknown"}`,
          source: "event_bus",
          confidence: 0.8,
        });
        break;
      }
      case "payment_received": {
        await remember({
          type: "insight",
          content: `Payment $${data.amount || 0} received ${period} on ${day}. Card ending ${data.cardLast4 || "????"}`,
          source: "event_bus",
          confidence: 0.9,
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

function simpleHash(str: string): string {
  let hash = 0;
  const normalized = str.toLowerCase().trim().replace(/\s+/g, " ");
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
