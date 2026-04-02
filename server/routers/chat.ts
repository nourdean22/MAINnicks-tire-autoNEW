/**
 * Chat router — AI chat assistant for customer interactions.
 * When the AI detects wantsAppointment, auto-creates a lead and fires Telegram alert.
 */
import { publicProcedure, router } from "../_core/trpc";
import { chatWithAssistant, scoreLead, extractMemories } from "../gemini";
import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
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
    import("../nour-os-bridge").then(({ onLeadCaptured }) =>
      onLeadCaptured({
        id: leadId,
        name,
        phone,
        source: "chat",
        urgencyScore: scoring.score,
        interest: scoring.recommendedService,
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
 * Look up existing memories for a visitor. Returns formatted context string.
 */
async function lookupMemories(
  d: NonNullable<Awaited<ReturnType<typeof db>>>,
  visitorKey: string,
): Promise<string | undefined> {
  const memories = await d
    .select()
    .from(conversationMemory)
    .where(eq(conversationMemory.visitorKey, visitorKey))
    .orderBy(desc(conversationMemory.lastAccessed))
    .limit(10);

  if (memories.length === 0) return undefined;

  // Update lastAccessed for retrieved memories (fire-and-forget)
  const memoryIds = memories.map(m => m.id);
  Promise.all(
    memoryIds.map(id =>
      d.update(conversationMemory)
        .set({ lastAccessed: new Date() })
        .where(eq(conversationMemory.id, id))
    )
  ).catch(() => {});

  return memories
    .map(m => `- [${m.category}] ${m.content}`)
    .join("\n");
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
    const duplicate = existing.find(e =>
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

export const chatRouter = router({
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

      // Cap session history to prevent unbounded growth
      if (sessionMessages.length > 30) {
        sessionMessages = sessionMessages.slice(-30);
      }

      // Look up cross-session memories for returning visitors
      let memoryContext: string | undefined;
      const visitorKey = deriveVisitorKey(sessionMessages, sessionId ?? undefined);
      if (visitorKey && d) {
        try {
          memoryContext = await lookupMemories(d, visitorKey);
        } catch (err) {
          console.error("[Chat] Memory lookup failed:", err);
        }
      }

      const { reply, extractedInfo } = await chatWithAssistant(sessionMessages, memoryContext);

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
          }, sessionMessages).catch(err => {
            console.error("[Chat] Auto-lead creation failed:", err);
          });
        }
      }

      // Fire-and-forget: extract and save memories for cross-session recall
      if (visitorKey && d && sessionId) {
        extractMemories(sessionMessages)
          .then(memories => {
            if (memories.length > 0) {
              saveMemories(d, visitorKey, sessionId!, memories).catch(err => {
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
