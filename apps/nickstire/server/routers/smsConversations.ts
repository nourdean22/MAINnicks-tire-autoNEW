/**
 * SMS Conversations Router
 * Two-way SMS messaging with customers. Outbound routes through the
 * F25e shop gateway (Twilio fallback); inbound replies are recorded by
 * the SMS Gateway webhook (routes/webhooks/sms-gateway.ts).
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
      // Map DB columns → the shape the admin SMS inbox (SmsSection.tsx)
      // expects. sms_conversations stores `phone` / `lastMessagePreview`;
      // the client ConversationRow type reads `customerPhone` /
      // `lastMessage`. Without this projection both arrive undefined —
      // every thread shows a blank phone + "No messages", and replying
      // in-thread posts phone:undefined which the send input's
      // z.string().min(10) rejects.
      const rows = await getConversations(input?.limit ?? 50);
      return rows.map((c) => ({
        id: c.id,
        customerPhone: c.phone,
        customerName: c.customerName,
        lastMessage: c.lastMessagePreview,
        lastMessageAt: c.lastMessageAt,
        unreadCount: c.unreadCount,
      }));
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

        // Wave-105: route admin replies through the shop gateway (F25e at
        // 216-862-0005) so customers see the text from the shop's real
        // number — same line they already trust. Falls back to Twilio if
        // the gateway is offline.
        const result = await sendSms(normalized, cleanMessage, { via: "shop" });

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
