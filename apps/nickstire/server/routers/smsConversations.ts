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
  getDbTyped
} from "../db";
import { sendSms } from "../sms";
import { sanitizeText, sanitizePhone } from "../sanitize";
import { logAdminAction } from "../services/auditTrail";
import { bookings, nickgptDrafts } from "../../drizzle/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { draftSmsReply } from "../services/nickgpt-client";
import { classifyIntent } from "../services/classifiers";
import { createLogger } from "../lib/logger";

const log = createLogger("sms-conversations-router");

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
    .mutation(async ({ input, ctx }) => {
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

        // Audit the manual operator SMS send — highest daily-use, TCPA-relevant
        // outbound action; was silent before. Records who texted which customer.
        // Fire-and-forget so an audit miss never blocks the send.
        logAdminAction({
          action: "customer.sms_manual_send",
          entityType: "sms_conversation",
          entityId: conversation.id,
          details: `Manual SMS to ${normalized}: "${input.message.slice(0, 80)}${input.message.length > 80 ? "…" : ""}"`,
          newValue: result.success ? "sent" : "failed",
          actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
        }).catch(() => { /* audit must never break the send */ });

        // ROS-058 human_pending: an operator reply is the PROOF a human
        // answered — close the open obligations for this conversation. This
        // covers both free-form replies and approved-draft sends (both exit
        // through here). Never blocks the send.
        if (result.success) {
          const { resolveHumanPendingForConversation } = await import("../services/smsResponseJobs");
          resolveHumanPendingForConversation(conversation.id, "human_replied")
            .catch(() => { /* resolution miss must never break the send */ });
        }

        return { success: result.success, conversationId: conversation.id };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Operation failed" });
      }
    }),

  /** Suggest a draft reply for a customer (admin) */
  suggestDraft: adminProcedure
    .input(z.object({
      phone: z.string().min(10).max(30),
      conversationId: z.number().int().optional(),
      inboundMessage: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const cleanPhone = sanitizePhone(input.phone);
      const normalized = cleanPhone.replace(/\D/g, "").slice(-10);
      let conversationContext: Array<{ role: "user" | "assistant"; content: string }> = [];
      let inboundMessage = input.inboundMessage ? sanitizeText(input.inboundMessage) : undefined;

      if (input.conversationId) {
        const dbMessages = await getConversationMessages(input.conversationId, 10);
        if (dbMessages && dbMessages.length > 0) {
          conversationContext = dbMessages.map((msg: any) => ({
            role: msg.direction === "inbound" ? ("user" as const) : ("assistant" as const),
            content: msg.body,
          }));
          if (!inboundMessage) {
            const lastInbound = [...dbMessages].reverse().find((m) => m.direction === "inbound");
            if (lastInbound) {
              inboundMessage = lastInbound.body;
            }
          }
        }
      }

      if (!inboundMessage) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No inbound message found or provided to draft a reply.",
        });
      }

      // 1. Fetch active booking context
      const db = await getDbTyped();
      let activeBookingCtx: { vehicle: string | null; stage: string; service: string } | undefined = undefined;
      if (db) {
        try {
          const activeBookings = await db.select()
            .from(bookings)
            .where(
              and(
                eq(bookings.phone, normalized),
                sql`${bookings.status} IN ('new', 'confirmed')`
              )
            )
            .orderBy(desc(bookings.createdAt))
            .limit(1);

          if (activeBookings && activeBookings.length > 0) {
            const b = activeBookings[0];
            activeBookingCtx = {
              vehicle: b.vehicle,
              stage: b.stage,
              service: b.service,
            };
          }
        } catch (err) {
          log.warn("Failed to fetch active booking context", err);
        }
      }

      // 2. Classify intent
      let intent = "general";
      let confidence = 0.5;
      try {
        const classification = await classifyIntent(inboundMessage);
        if (classification.ok) {
          intent = classification.topLabel;
          confidence = classification.topScore;
        }
      } catch (err) {
        log.warn("Intent classification failed, falling back to general", err);
      }

      // 3. Draft reply
      const draftResult = await draftSmsReply({
        inboundMessage,
        conversationContext,
        activeBooking: activeBookingCtx,
      });

      if (!draftResult.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Draft generation failed: ${draftResult.error}`,
        });
      }

      // 4. Persist draft
      let draftId: number | null = null;
      if (db) {
        try {
          const [inserted] = await db.insert(nickgptDrafts).values({
            customerPhone: normalized,
            inboundMessage,
            draftReply: draftResult.draft,
            intent,
            confidence,
            provider: draftResult.source,
            latencyMs: draftResult.latencyMs,
            status: "draft",
            autoSent: false,
          });
          draftId = inserted.insertId;
        } catch (err) {
          log.warn("Failed to persist NickGPT draft to database", err);
        }
      }

      return {
        draftId,
        draft: draftResult.draft,
        intent,
        confidence,
        provider: draftResult.source,
        latencyMs: draftResult.latencyMs,
      };
    }),

  /** ROS-058: Needs-Reply truth — human-pending obligations + SLA. Throws on
   *  DB unavailability so the client renders UNKNOWN, never zero. */
  humanPendingSummary: adminProcedure.query(async () => {
    const { humanPendingSummary } = await import("../services/smsResponseJobs");
    return humanPendingSummary();
  }),

  /** ROS-058: an operator explicitly closes a waiting conversation as needing
   *  no reply — the ONLY way an obligation ends without a human answer. */
  markNoReplyNeeded: adminProcedure
    .input(z.object({ conversationId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const { resolveHumanPendingForConversation } = await import("../services/smsResponseJobs");
      const closed = await resolveHumanPendingForConversation(input.conversationId, "no_reply_required");
      logAdminAction({
        action: "customer.sms_manual_send",
        entityType: "sms_conversation",
        entityId: input.conversationId,
        details: `Marked no-reply-needed (${closed} obligation${closed === 1 ? "" : "s"} closed)`,
        newValue: "no_reply_required",
        actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
      }).catch(() => { /* audit must never block */ });
      return { closed };
    }),

  /** Save operator feedback/rating on a draft (admin) */
  saveFeedback: adminProcedure
    .input(z.object({
      draftId: z.number().int(),
      operatorReply: z.string().optional(),
      rating: z.enum(["good", "bad"]).optional(),
      status: z.enum(["draft", "approved", "edited", "rejected"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDbTyped();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      try {
        await db.update(nickgptDrafts)
          .set({
            ...(input.operatorReply !== undefined ? { operatorReply: sanitizeText(input.operatorReply) } : {}),
            ...(input.rating !== undefined ? { rating: input.rating } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            updatedAt: new Date(),
          })
          .where(eq(nickgptDrafts.id, input.draftId));

        return { success: true };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Feedback save failed" });
      }
    }),

  /** Get stats and last draft details for the dashboard widget (admin) */
  getNickGptStats: adminProcedure
    .query(async () => {
      const db = await getDbTyped();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      try {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const draftsToday = await db.select()
          .from(nickgptDrafts)
          .where(gte(nickgptDrafts.createdAt, startOfToday));

        const draftsGeneratedToday = draftsToday.length;
        const draftsApprovedToday = draftsToday.filter((d) => d.status === "approved" || d.status === "edited" || d.autoSent).length;
        const totalActed = draftsToday.filter((d) => ["approved", "edited", "rejected"].includes(d.status)).length;
        // No drafts acted on today = no rate to report. Returning 100 here
        // painted a fabricated-perfect number on an empty denominator; null lets
        // the UI render "—" so a quiet day never reads as flawless performance.
        const approvalRate = totalActed > 0
          ? Math.round((draftsToday.filter((d) => ["approved", "edited"].includes(d.status)).length / totalActed) * 100)
          : null;

        const lastDrafts = await db.select()
          .from(nickgptDrafts)
          .orderBy(desc(nickgptDrafts.createdAt))
          .limit(1);

        const lastDraft = lastDrafts.length > 0 ? {
          id: lastDrafts[0].id,
          customerPhone: lastDrafts[0].customerPhone,
          inboundMessage: lastDrafts[0].inboundMessage,
          draftReply: lastDrafts[0].draftReply,
          intent: lastDrafts[0].intent,
          confidence: lastDrafts[0].confidence,
          provider: lastDrafts[0].provider,
          createdAt: lastDrafts[0].createdAt,
        } : null;

        return {
          draftsGeneratedToday,
          draftsApprovedToday,
          approvalRate,
          lastDraft,
        };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Stats fetch failed" });
      }
    }),
});
