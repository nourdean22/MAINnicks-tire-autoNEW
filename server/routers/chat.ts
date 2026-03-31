/**
 * Chat router — AI chat assistant for customer interactions.
 * When the AI detects wantsAppointment, auto-creates a lead and fires Telegram alert.
 */
import { publicProcedure, router } from "../_core/trpc";
import { chatWithAssistant, scoreLead } from "../gemini";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { chatSessions, leads } from "../../drizzle/schema";
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
    } catch { /* keep default */ }
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
          } catch {}
        }
      }

      const cleanMessage = sanitizeText(input.message);
      sessionMessages.push({ role: "user", content: cleanMessage });

      // Cap session history to prevent unbounded growth
      if (sessionMessages.length > 30) {
        sessionMessages = sessionMessages.slice(-30);
      }

      const { reply, extractedInfo } = await chatWithAssistant(sessionMessages);

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

      return { sessionId, reply: finalReply, extractedInfo };
    }),
});
