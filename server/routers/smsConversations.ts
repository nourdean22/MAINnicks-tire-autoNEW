/**
 * SMS Conversations Router
 * Handles 2-way SMS messaging with customers via Twilio.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure } from "../_core/trpc";
import {
  getOrCreateConversation, addSmsMessage, getConversations,
  getConversationMessages, markConversationRead, getUnreadConversationCount,
} from "../db";
import { sendSms } from "../sms";
import { sanitizeText, sanitizePhone } from "../sanitize";

export const smsConversationsRouter = router({
  /** Get all conversations sorted by most recent (admin) */
  list: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(async ({ input }) => {
      return getConversations(input?.limit ?? 50);
    }),

  /** Get messages for a specific conversation (admin) */
  messages: adminProcedure
    .input(z.object({
      conversationId: z.number().int(),
      limit: z.number().int().min(1).max(500).default(100),
    }))
    .query(async ({ input }) => {
      return getConversationMessages(input.conversationId, input.limit);
    }),

  /** Mark a conversation as read (admin) */
  markRead: adminProcedure
    .input(z.object({ conversationId: z.number().int() }))
    .mutation(async ({ input }) => {
      try {
        await markConversationRead(input.conversationId);
        return { success: true };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),

  /** Get unread conversation count (admin) */
  unreadCount: adminProcedure.query(async () => {
    return { count: await getUnreadConversationCount() };
  }),

  /** Send an outbound SMS to a customer (admin) */
  send: adminProcedure
    .input(z.object({
      phone: z.string().min(10).max(15),
      message: z.string().min(1).max(1600),
      customerName: z.string().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        const cleanPhone = sanitizePhone(input.phone);
        const cleanMessage = sanitizeText(input.message);
        const cleanName = input.customerName ? sanitizeText(input.customerName) : undefined;
        const normalized = cleanPhone.replace(/\D/g, "").slice(-10);

        // Get or create conversation
        const conversation = await getOrCreateConversation(normalized, cleanName);

        // Send via Twilio
        const result = await sendSms(normalized, cleanMessage);

        // Record the outbound message
        await addSmsMessage({
          conversationId: conversation.id,
          direction: "outbound",
          body: input.message,
          twilioSid: result.sid || undefined,
          status: result.success ? "sent" : "failed",
        });

        return { success: result.success, conversationId: conversation.id };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),
});

/**
 * Handle an inbound SMS from Twilio webhook.
 * Called from the Express route handler.
 */
export async function handleInboundSms(from: string, body: string, twilioSid?: string) {
  const normalized = from.replace(/\D/g, "").slice(-10);
  const conversation = await getOrCreateConversation(normalized);

  await addSmsMessage({
    conversationId: conversation.id,
    direction: "inbound",
    body,
    twilioSid: twilioSid || undefined,
    status: "received",
  });

  return { conversationId: conversation.id };
}
