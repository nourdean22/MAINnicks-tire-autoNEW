/**
 * Chat router — AI chat assistant for customer interactions.
 * When the AI detects wantsAppointment, auto-creates a lead and fires Telegram alert.
 */
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { chatWithAssistant, scoreLead, extractMemories } from "../gemini";
import { z } from "zod";
import { eq, desc, and, sql } from "drizzle-orm";
import { chatSessions, leads, conversationMemory } from "../../drizzle/schema";
import type { InsertConversationMemory } from "../../drizzle/schema";
import { sanitizeText } from "../sanitize";
import { alertNewLead } from "../services/telegram";
import { BUSINESS } from "@shared/business";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

/**
 * Try to extract a name from the chat messages (customer introduces themselves).
 * Looks for patterns like "I'm John", "My name is John", "This is John", etc.
 */
function extractNameFromMessages(messages: Array<{ role: string; content: string }>): string | null {
  const userMessages = messages.filter(m => m.role === "user").map(m => m.content).join("\n");
  const patterns = [
    /(?:my name is|i'm|i am|this is|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /^([A-Z][a-z]+)\s+here/im,
  ];
  for (const pattern of patterns) {
    const match = userMessages.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

/**
 * Try to extract a phone number from chat messages.
 */
function extractPhoneFromMessages(messages: Array<{ role: string; content: string }>): string | null {
  const userMessages = messages.filter(m => m.role === "user").map(m => m.content).join("\n");
  const match = userMessages.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  return match?.[0] || null;
}

/**
 * Auto-create a lead from chat data. Fire-and-forget — never blocks the chat response.
 */
async function createChatLead(
  d: NonNullable<Awaited<ReturnType<typeof db>>>,
  sessionId: number,
  info: { vehicle?: string; problem?: string },
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  const name = extractNameFromMessages(messages) || "Chat Visitor";
  const phone = extractPhoneFromMessages(messages) || "";

  // Score the lead
  let scoring = { score: 3, reason: "Chat lead wants to book", recommendedService: "General Repair" };
  if (info.problem) {
    try {
      scoring = await scoreLead(info.problem, info.vehicle);
    } catch (err) { console.error("[Chat] Lead scoring failed, using defaults:", err instanceof Error ? err.message : err); }
  }

  const insertedRows = await d.insert(leads).values({
    name,
    phone,
    vehicle: info.vehicle || null,
    problem: info.problem || null,
    source: "chat",
    urgencyScore: scoring.score,
    urgencyReason: scoring.reason,
    recommendedService: scoring.recommendedService,
  }).$returningId();

  const leadId = insertedRows[0]?.id ?? null;

  // Link lead to chat session and mark as converted
  if (leadId) {
    await d.update(chatSessions).set({
      leadId,
      converted: 1,
    }).where(eq(chatSessions.id, sessionId));
  }

  // Dispatch to NOUR OS event bus (non-blocking)
  if (leadId) {
    import("../services/eventBus").then(({ emit }) =>
      emit.leadCaptured({
        id: leadId,
        name,
        phone,
        source: "chat",
        urgencyScore: scoring.score,
      })
    ).catch(() => {});
  }

  // Telegram alert
  alertNewLead({
    name,
    phone: phone || undefined,
    service: scoring.recommendedService,
    source: "ai-chat",
  }).catch(() => {});
}

/**
 * Derive a visitor key from chat messages for memory lookup.
 * Uses phone number if shared, otherwise falls back to sessionId-based key.
 */
function deriveVisitorKey(
  messages: Array<{ role: string; content: string }>,
  sessionId?: number,
): string | null {
  const phone = extractPhoneFromMessages(messages);
  if (phone) {
    // Normalize phone to digits only for consistent matching
    return `phone:${phone.replace(/\D/g, "")}`;
  }
  // Without a phone, we can't reliably track across sessions
  // sessionId is per-session so it won't help for cross-session memory
  return null;
}

/**
 * Compute a composite memory score combining confidence, reinforcements, and recency.
 * Higher = more valuable memory to inject into context.
 */
function computeMemoryScore(mem: {
  confidence: number;
  reinforcements: number;
  conversionHits?: number | null;
  lastAccessed: Date;
}): number {
  const now = Date.now();
  const ageMs = now - new Date(mem.lastAccessed).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Recency: 1.0 for today, decays toward 0 over ~90 days
  const recencyScore = Math.max(0, 1 - ageDays / 90);
  // Reinforcement bonus: each reinforcement adds diminishing value (log scale)
  const reinforcementScore = Math.min(0.3, Math.log2(Math.max(1, mem.reinforcements)) * 0.1);
  // Conversion bonus: memories that led to conversions get a boost
  const conversionBonus = (mem.conversionHits ?? 0) > 0 ? 0.15 : 0;

  return mem.confidence * 0.5 + recencyScore * 0.25 + reinforcementScore + conversionBonus;
}

/**
 * Look up existing memories for a visitor. Returns formatted context string.
 * Applies memory scoring, decay for stale memories, and prunes dead ones.
 */
async function lookupMemories(
  d: NonNullable<Awaited<ReturnType<typeof db>>>,
  visitorKey: string,
): Promise<{ formatted: string | undefined; memoryIds: number[] }> {
  const memories = await d
    .select()
    .from(conversationMemory)
    .where(eq(conversationMemory.visitorKey, visitorKey))
    .limit(30);

  if (memories.length === 0) return { formatted: undefined, memoryIds: [] };

  // --- Memory decay: reduce confidence by 0.01 per week of inactivity ---
  const now = Date.now();
  const decayUpdates: Promise<unknown>[] = [];
  const memoriesToDelete: number[] = [];

  for (const mem of memories) {
    const ageMs = now - new Date(mem.lastAccessed).getTime();
    const weeksInactive = Math.floor(ageMs / (1000 * 60 * 60 * 24 * 7));
    if (weeksInactive > 0) {
      const decayedConfidence = Math.max(0, mem.confidence - weeksInactive * 0.01);
      if (decayedConfidence < 0.3) {
        memoriesToDelete.push(mem.id);
      } else if (decayedConfidence !== mem.confidence) {
        // Apply decay (fire-and-forget)
        decayUpdates.push(
          d.update(conversationMemory)
            .set({ confidence: decayedConfidence })
            .where(eq(conversationMemory.id, mem.id))
        );
        mem.confidence = decayedConfidence; // Update in-memory for scoring
      }
    }
  }

  // Delete dead memories (confidence < 0.3) fire-and-forget
  if (memoriesToDelete.length > 0) {
    Promise.all(
      memoriesToDelete.map(id =>
        d.delete(conversationMemory).where(eq(conversationMemory.id, id))
      )
    ).catch(() => {});
  }
  if (decayUpdates.length > 0) {
    Promise.all(decayUpdates).catch(() => {});
  }

  // Filter out dead memories from the working set
  const liveMemories = memories.filter((m: any) => !memoriesToDelete.includes(m.id));
  if (liveMemories.length === 0) return { formatted: undefined, memoryIds: [] };

  // Score and sort by composite memoryScore
  const scored = liveMemories
    .map((m: any) => ({ ...m, memoryScore: computeMemoryScore(m) }))
    .sort((a: any, b: any) => b.memoryScore - a.memoryScore)
    .slice(0, 10); // Top 10 most relevant

  // Update lastAccessed for retrieved memories (fire-and-forget)
  const activeIds = scored.map((m: any) => m.id);
  Promise.all(
    activeIds.map((id: any) =>
      d.update(conversationMemory)
        .set({ lastAccessed: new Date() })
        .where(eq(conversationMemory.id, id))
    )
  ).catch(() => {});

  const formatted = scored
    .map((m: any) => `- [${m.category}] ${m.content}`)
    .join("\n");

  return { formatted, memoryIds: activeIds };
}

/**
 * Save extracted memories to the database. Handles deduplication by reinforcing
 * existing memories with matching content instead of creating duplicates.
 */
async function saveMemories(
  d: NonNullable<Awaited<ReturnType<typeof db>>>,
  visitorKey: string,
  sessionId: number,
  memories: Array<{ category: string; content: string; confidence: number }>,
): Promise<void> {
  for (const mem of memories) {
    // Check for existing similar memory (same visitor + category + content substring match)
    const existing = await d
      .select()
      .from(conversationMemory)
      .where(
        and(
          eq(conversationMemory.visitorKey, visitorKey),
          eq(conversationMemory.category, mem.category),
        )
      )
      .limit(20);

    // Simple dedup: if content is substantially similar, reinforce instead of inserting
    const duplicate = existing.find((e: any) =>
      e.content.toLowerCase().includes(mem.content.toLowerCase().slice(0, 30)) ||
      mem.content.toLowerCase().includes(e.content.toLowerCase().slice(0, 30))
    );

    if (duplicate) {
      await d.update(conversationMemory).set({
        reinforcements: duplicate.reinforcements + 1,
        lastAccessed: new Date(),
        confidence: Math.min(1, duplicate.confidence + 0.05),
      }).where(eq(conversationMemory.id, duplicate.id));
    } else {
      await d.insert(conversationMemory).values({
        visitorKey,
        category: mem.category,
        content: mem.content,
        sessionId,
        confidence: mem.confidence,
      });
    }
  }
}

/**
 * Consolidate memories when a visitor has too many (10+).
 * Merges similar memories within the same category and removes low-confidence ones.
 * Runs fire-and-forget — never blocks the chat response.
 */
async function consolidateMemories(
  d: NonNullable<Awaited<ReturnType<typeof db>>>,
  visitorKey: string,
): Promise<void> {
  const allMemories = await d
    .select()
    .from(conversationMemory)
    .where(eq(conversationMemory.visitorKey, visitorKey))
    .orderBy(desc(conversationMemory.confidence));

  // Only consolidate when there are 10+ memories
  if (allMemories.length < 10) return;

  // Group by category
  const byCategory = new Map<string, typeof allMemories>();
  for (const mem of allMemories) {
    const group = byCategory.get(mem.category) || [];
    group.push(mem);
    byCategory.set(mem.category, group);
  }

  const toDelete: number[] = [];

  for (const [_category, mems] of byCategory) {
    if (mems.length <= 1) continue;

    // Find pairs with similar content (simple substring overlap check)
    const merged = new Set<number>();
    for (let i = 0; i < mems.length; i++) {
      if (merged.has(mems[i].id)) continue;
      for (let j = i + 1; j < mems.length; j++) {
        if (merged.has(mems[j].id)) continue;
        const a = mems[i].content.toLowerCase();
        const b = mems[j].content.toLowerCase();
        // Check if content is substantially similar (30-char prefix overlap)
        const overlap = a.includes(b.slice(0, 30)) || b.includes(a.slice(0, 30));
        if (overlap) {
          // Keep the one with higher confidence, absorb the other's reinforcements
          const keeper = mems[i].confidence >= mems[j].confidence ? mems[i] : mems[j];
          const absorbed = keeper === mems[i] ? mems[j] : mems[i];
          await d.update(conversationMemory).set({
            reinforcements: keeper.reinforcements + absorbed.reinforcements,
            confidence: Math.min(1, keeper.confidence + 0.05),
            conversionHits: (keeper.conversionHits ?? 0) + (absorbed.conversionHits ?? 0),
          }).where(eq(conversationMemory.id, keeper.id));
          toDelete.push(absorbed.id);
          merged.add(absorbed.id);
        }
      }
    }
  }

  // Delete merged duplicates
  if (toDelete.length > 0) {
    await Promise.all(
      toDelete.map(id =>
        d.delete(conversationMemory).where(eq(conversationMemory.id, id))
      )
    );
  }
}

/**
 * Boost confidence of memories that were active during a conversion.
 * Called when a chat session converts to a lead.
 */
async function reinforceMemoriesOnConversion(
  d: NonNullable<Awaited<ReturnType<typeof db>>>,
  memoryIds: number[],
): Promise<void> {
  if (memoryIds.length === 0) return;
  await Promise.all(
    memoryIds.map(id =>
      d.update(conversationMemory).set({
        confidence: sql`LEAST(1, ${conversationMemory.confidence} + 0.1)`,
        conversionHits: sql`${conversationMemory.conversionHits} + 1`,
        lastAccessed: new Date(),
      }).where(eq(conversationMemory.id, id))
    )
  );
}

/**
 * Append a booking CTA to Nick AI's reply when the customer wants to book.
 */
function appendBookingCta(reply: string): string {
  // Don't double-add if the reply already mentions booking or the phone number prominently
  if (reply.includes("nickstire.org") && reply.includes(BUSINESS.phone.display)) {
    return reply;
  }

  return (
    reply +
    `\n\nReady to get this taken care of? Book online at nickstire.org or call us directly at ${BUSINESS.phone.display} — we'll get you in fast.`
  );
}

// ─── SMART CONTEXT WINDOW ─────────────────────────────

/** Patterns that indicate a message contains high-value info we must preserve */
const CONTACT_PATTERNS = [
  /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/, // phone
  /\b[\w.-]+@[\w.-]+\.\w{2,}\b/,           // email
  /\b(appointment|book|schedule|come in|drop off|bring it)\b/i, // booking intent
];
const VEHICLE_PATTERNS = [
  /\b(20\d{2}|19\d{2})\b.*\b(toyota|honda|ford|chevy|chevrolet|nissan|hyundai|kia|bmw|mercedes|audi|dodge|jeep|ram|gmc|buick|cadillac|lexus|acura|infiniti|mazda|subaru|volkswagen|vw|volvo|chrysler|lincoln|mitsubishi|pontiac|saturn)\b/i,
  /\b(toyota|honda|ford|chevy|chevrolet|nissan|hyundai|kia|bmw|mercedes|audi|dodge|jeep|ram|gmc|buick|cadillac|lexus|acura|infiniti|mazda|subaru|volkswagen|vw|volvo|chrysler|lincoln|mitsubishi|pontiac|saturn)\b.*\b(20\d{2}|19\d{2})\b/i,
  /\b(camry|civic|f-150|accord|altima|corolla|mustang|rav4|cr-v|silverado|escape|explorer|impala|malibu|rogue|sentra|elantra|sonata|sorento|soul|outback|forester|jetta|passat|wrangler|grand cherokee|tahoe|suburban)\b/i,
];

/**
 * Smart context window: instead of blindly keeping the last 30 messages,
 * prioritize keeping the FIRST user message (original problem), any messages
 * with contact info or vehicle details, and compress the middle.
 */
function buildSmartContext(
  messages: Array<{ role: string; content: string }>,
  maxMessages: number = 30,
): Array<{ role: string; content: string }> {
  if (messages.length <= maxMessages) return messages;

  const isHighValue = (msg: { role: string; content: string }): boolean => {
    if (msg.role !== "user") return false;
    return (
      CONTACT_PATTERNS.some(p => p.test(msg.content)) ||
      VEHICLE_PATTERNS.some(p => p.test(msg.content))
    );
  };

  // Always keep: first user message, last 10 messages, any high-value messages
  const firstUserIdx = messages.findIndex(m => m.role === "user");
  const keepIndices = new Set<number>();

  // 1. Keep the first user message (original problem)
  if (firstUserIdx >= 0) {
    keepIndices.add(firstUserIdx);
  }

  // 2. Keep the last 10 messages (recent context)
  const tailStart = Math.max(0, messages.length - 10);
  for (let i = tailStart; i < messages.length; i++) {
    keepIndices.add(i);
  }

  // 3. Keep any high-value messages from the middle
  for (let i = 0; i < messages.length; i++) {
    if (isHighValue(messages[i])) {
      keepIndices.add(i);
      // Also keep the assistant reply right after (context for the info)
      if (i + 1 < messages.length && messages[i + 1].role === "assistant") {
        keepIndices.add(i + 1);
      }
    }
  }

  // Build sorted result
  const sortedIndices = Array.from(keepIndices).sort((a, b) => a - b);

  // If we still have too many, we need to summarize
  if (sortedIndices.length > maxMessages) {
    // Keep first user message + last (maxMessages - 1) from sorted
    const finalIndices = [
      sortedIndices[0],
      ...sortedIndices.slice(-(maxMessages - 1)),
    ];
    const uniqueIndices = [...new Set(finalIndices)].sort((a, b) => a - b);
    return uniqueIndices.map(i => messages[i]);
  }

  // Check for gaps and insert a summary marker
  const final: Array<{ role: string; content: string }> = [];
  let lastIdx = -1;
  for (const idx of sortedIndices) {
    if (lastIdx >= 0 && idx - lastIdx > 1) {
      const skipped = idx - lastIdx - 1;
      final.push({
        role: "system" as string,
        content: `[${skipped} earlier messages summarized — conversation continued about the customer's vehicle concerns]`,
      });
    }
    final.push(messages[idx]);
    lastIdx = idx;
  }

  return final;
}

/**
 * Detect customer sentiment from recent messages.
 * Simple keyword-based detection — fast, no LLM call needed.
 */
function detectSentiment(
  messages: Array<{ role: string; content: string }>,
): "positive" | "neutral" | "negative" | "frustrated" {
  const recent = messages
    .filter(m => m.role === "user")
    .slice(-3)
    .map(m => m.content.toLowerCase())
    .join(" ");

  const frustratedSignals = /\b(ridiculous|terrible|worst|scam|rip.?off|waste|never coming back|unacceptable|angry|furious|disgusted)\b/;
  const negativeSignals = /\b(expensive|too much|can't afford|not sure|worried|concerned|hesitant|doubt|disappointed|unhappy|annoyed|frustrated)\b/;
  const positiveSignals = /\b(great|awesome|perfect|excellent|love|thanks|thank you|appreciate|sounds good|let's do it|book it|when can i)\b/;

  if (frustratedSignals.test(recent)) return "frustrated";
  if (negativeSignals.test(recent)) return "negative";
  if (positiveSignals.test(recent)) return "positive";
  return "neutral";
}

export const chatRouter = router({
  /** Admin: list recent chat sessions with transcripts */
  sessions: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];
    return d.select().from(chatSessions).orderBy(desc(chatSessions.createdAt)).limit(50);
  }),

  message: publicProcedure
    .input(z.object({
      sessionId: z.number().optional(),
      message: z.string().min(1).max(2000),
    }))
    .mutation(async ({ input }) => {
      const d = await db();

      let sessionMessages: Array<{ role: string; content: string }> = [];
      let sessionId = input.sessionId;

      if (sessionId && d) {
        const existing = await d.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1);
        if (existing.length > 0) {
          try {
            sessionMessages = JSON.parse(existing[0].messagesJson);
          } catch (err) {
            console.error("[Chat] Failed to parse session messages JSON:", err instanceof Error ? err.message : err);
          }
        }
      }

      const cleanMessage = sanitizeText(input.message);
      sessionMessages.push({ role: "user", content: cleanMessage });

      // Smart context window: preserve high-value messages, compress middle
      sessionMessages = buildSmartContext(sessionMessages, 30);

      // Look up cross-session memories for returning visitors
      let memoryContext: string | undefined;
      let activeMemoryIds: number[] = [];
      const visitorKey = deriveVisitorKey(sessionMessages, sessionId ?? undefined);
      if (visitorKey && d) {
        try {
          const memResult = await lookupMemories(d, visitorKey);
          memoryContext = memResult.formatted;
          activeMemoryIds = memResult.memoryIds;
        } catch (err) {
          console.error("[Chat] Memory lookup failed:", err);
        }
      }

      // Detect sentiment for prompt adaptation
      const sentiment = detectSentiment(sessionMessages);

      // Feed live business intel into Nick AI — REAL shop load, not just bookings
      let businessIntel: { todayBookings?: number; estimatedWaitMinutes?: number; availableSlots?: string[] } | undefined;
      try {
        const { getDb } = await import("../db");
        const { sql: rawSql } = await import("drizzle-orm");
        const d = await getDb();
        if (d) {
          // Active work orders = cars physically in the shop right now
          const [woRows] = await d.execute(rawSql`
            SELECT COUNT(*) as cnt FROM work_orders
            WHERE status IN ('in_progress', 'approved', 'waiting_parts', 'quality_check')
          `);
          const activeWOs = Number((woRows as any)?.[0]?.cnt || 0);

          // Today's confirmed bookings = expected arrivals
          const [bkRows] = await d.execute(rawSql`
            SELECT COUNT(*) as cnt FROM bookings
            WHERE createdAt >= CURDATE() AND status IN ('new', 'confirmed')
          `);
          const todayBookings = Number((bkRows as any)?.[0]?.cnt || 0);

          // Real wait estimate: active WOs * 45min avg, capped at 3 hours
          // If no active WOs, minimal wait (walk-in friendly)
          const estimatedWaitMinutes = activeWOs === 0 ? 0 : Math.min(180, activeWOs * 45);

          // Best times to come in (from historical data)
          let availableSlots: string[] = [];
          const etHour = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }), 10);
          if (etHour < 10) availableSlots.push("Right now — mornings are best for same-day service");
          else if (etHour < 14) availableSlots.push("Drop off now, done by end of day");
          else availableSlots.push("Drop off today, ready by tomorrow morning");

          businessIntel = { todayBookings: todayBookings + activeWOs, estimatedWaitMinutes, availableSlots };
        }
      } catch {}

      const { reply, extractedInfo } = await chatWithAssistant(sessionMessages, memoryContext, {
        customerSentiment: sentiment,
        conversationLength: sessionMessages.length,
        businessIntel,
      });

      // If wantsAppointment, enhance the reply with booking CTA
      let finalReply = reply;
      if (extractedInfo?.wantsAppointment) {
        finalReply = appendBookingCta(reply);
      }

      sessionMessages.push({ role: "assistant", content: finalReply });

      if (d) {
        if (sessionId) {
          await d.update(chatSessions).set({
            messagesJson: JSON.stringify(sessionMessages),
            vehicleInfo: extractedInfo?.vehicle || undefined,
            problemSummary: extractedInfo?.problem || undefined,
          }).where(eq(chatSessions.id, sessionId));
        } else {
          const result = await d.insert(chatSessions).values({
            messagesJson: JSON.stringify(sessionMessages),
            vehicleInfo: extractedInfo?.vehicle || null,
            problemSummary: extractedInfo?.problem || null,
          });
          sessionId = Number(result[0].insertId);
        }
      }

      // Fire-and-forget: auto-create lead when booking intent detected
      if (extractedInfo?.wantsAppointment && d && sessionId) {
        // Check if this session already converted (don't create duplicate leads)
        const session = await d.select({ converted: chatSessions.converted })
          .from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1);

        if (session[0]?.converted !== 1) {
          createChatLead(d, sessionId, {
            vehicle: extractedInfo.vehicle,
            problem: extractedInfo.problem,
          }, sessionMessages).then(() => {
            // Reinforce memories that were active during this conversion
            if (activeMemoryIds.length > 0 && d) {
              reinforceMemoriesOnConversion(d, activeMemoryIds).catch(err => {
                console.error("[Chat] Memory reinforcement failed:", err);
              });
            }
          }).catch(err => {
            console.error("[Chat] Auto-lead creation failed:", err);
          });
        }
      }

      // Fire-and-forget: extract, save memories, and consolidate for cross-session recall
      if (visitorKey && d && sessionId) {
        extractMemories(sessionMessages)
          .then(memories => {
            if (memories.length > 0) {
              saveMemories(d, visitorKey, sessionId!, memories)
                .then(() => {
                  // After saving, consolidate if there are too many memories
                  consolidateMemories(d, visitorKey).catch(err => {
                    console.error("[Chat] Memory consolidation failed:", err);
                  });
                })
                .catch(err => {
                  console.error("[Chat] Memory save failed:", err);
                });
            }
          })
          .catch(err => {
            console.error("[Chat] Memory extraction failed:", err);
          });
      }

      return { sessionId, reply: finalReply, extractedInfo };
    }),
});
