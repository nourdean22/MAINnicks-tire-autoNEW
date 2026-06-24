import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { getDbTyped } from "../db";
import { smsOrchestrations, smsLearningRecommendations, nickgptTrainingExamples, appSecretKv, nickgptDrafts } from "../../drizzle/schema";
import { desc, sql, eq, and, or, like } from "drizzle-orm";
import { generateDailySmsReport, generateWeeklySmsReport, getSmsVariantPerformance } from "../services/smsLearningEngine";
import { getCustomerJourneyTimeline } from "../services/smsOrchestrator";
import { sendSms } from "../sms";
import { TRPCError } from "@trpc/server";

export const smsOrchestratorRouter = router({
  getOrchestrations: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      filter: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDbTyped();
      if (!db) return { items: [], total: 0 };

      let filterClause = sql`1=1`;
      if (input.filter) {
        if (input.filter === "sent") filterClause = sql`status = 'sent'`;
        else if (input.filter === "queued") filterClause = sql`status = 'queued'`;
        else if (input.filter === "failed") filterClause = sql`status = 'failed'`;
        else if (input.filter === "skipped") filterClause = sql`status = 'skipped'`;
        else if (input.filter === "drafted") filterClause = sql`status = 'drafted'`;
        else if (input.filter === "inbound") filterClause = sql`event_type = 'inbound_sms'`;
        else if (input.filter === "Vapi") filterClause = sql`event_type LIKE 'vapi%'`;
        else if (input.filter === "NickGPT") filterClause = sql`variant_key = 'nickgpt_v1'`;
        else if (input.filter === "reminders") filterClause = sql`event_type = 'booking_reminder'`;
        else if (input.filter === "review requests") filterClause = sql`event_type = 'review_request'`;
        else if (input.filter === "price questions") filterClause = sql`event_type LIKE 'price_question%'`;
      }

      const items = await db.select()
        .from(smsOrchestrations)
        .where(filterClause)
        .orderBy(desc(smsOrchestrations.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [countResult] = await db.select({ count: sql<number>`count(*)` })
        .from(smsOrchestrations)
        .where(filterClause);

      return {
        items,
        total: countResult?.count ?? 0,
      };
    }),

  getDailyReport: adminProcedure
    .input(z.object({ date: z.string() }))
    .query(async ({ input }) => {
      const date = new Date(input.date);
      return await generateDailySmsReport(date);
    }),

  getWeeklyReport: adminProcedure
    .input(z.object({ weekStart: z.string(), weekEnd: z.string() }))
    .query(async ({ input }) => {
      const weekStart = new Date(input.weekStart);
      const weekEnd = new Date(input.weekEnd);
      return await generateWeeklySmsReport(weekStart, weekEnd);
    }),

  getVariantPerformance: adminProcedure
    .input(z.object({ eventType: z.string(), days: z.number().int().default(30) }))
    .query(async ({ input }) => {
      return await getSmsVariantPerformance(input);
    }),

  getRecommendations: adminProcedure
    .query(async () => {
      const db = await getDbTyped();
      if (!db) return [];
      return await db.select()
        .from(smsLearningRecommendations)
        .orderBy(desc(smsLearningRecommendations.createdAt));
    }),

  reviewRecommendation: adminProcedure
    .input(z.object({
      id: z.number().int(),
      status: z.enum(["approved", "rejected"]),
      operatorName: z.string().default("operator"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDbTyped();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      await db.update(smsLearningRecommendations)
        .set({
          status: input.status,
          reviewedAt: new Date(),
          reviewedBy: input.operatorName,
        })
        .where(eq(smsLearningRecommendations.id, input.id));

      return { success: true };
    }),

  getTrainingStats: adminProcedure
    .query(async () => {
      const db = await getDbTyped();
      if (!db) return { totalCount: 0, approvedCount: 0 };

      const [totalCountRows] = await db.select({ count: sql<number>`count(*)` })
        .from(nickgptTrainingExamples);
      const [approvedCountRows] = await db.select({ count: sql<number>`count(*)` })
        .from(nickgptTrainingExamples)
        .where(eq(nickgptTrainingExamples.approvedForTraining, true));

      return {
        totalCount: totalCountRows?.count ?? 0,
        approvedCount: approvedCountRows?.count ?? 0,
      };
    }),

  exportTrainingCorpus: adminProcedure
    .mutation(async () => {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      
      try {
        await execAsync("npx tsx scripts/export-nickgpt-learning-corpus.ts");
        return { success: true };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err instanceof Error ? err.message : "Export script failed" });
      }
    }),

  getCustomerTimeline: adminProcedure
    .input(z.object({ phone: z.string() }))
    .query(async ({ input }) => {
      return await getCustomerJourneyTimeline(input.phone);
    }),

  getHumanReviewQueue: adminProcedure
    .query(async () => {
      const db = await getDbTyped();
      if (!db) return [];
      
      return await db.select()
        .from(smsOrchestrations)
        .where(and(
          eq(smsOrchestrations.requiresHumanApproval, true),
          sql`status IN ('drafted', 'received')`
        ))
        .orderBy(desc(smsOrchestrations.createdAt));
    }),

  actionHumanReview: adminProcedure
    .input(z.object({
      id: z.number().int(),
      action: z.enum(["send", "edit_and_send", "resolve", "bad_suggestion"]),
      editedMessage: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDbTyped();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const [row] = await db.select()
        .from(smsOrchestrations)
        .where(eq(smsOrchestrations.id, input.id))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Review item not found" });
      }

      if (input.action === "send" || input.action === "edit_and_send") {
        const messageToSend = input.action === "send" ? row.messageBody : (input.editedMessage || "");
        if (!messageToSend) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Message body cannot be empty" });
        }

        const sendResult = await sendSms(row.customerPhone, messageToSend, {
          via: row.providerUsed === "none" ? "shop" : row.providerUsed as any,
          variantKey: row.variantKey,
          skipPersist: false,
        });

        await db.update(smsOrchestrations)
          .set({
            messageBody: messageToSend,
            status: sendResult.success ? (sendResult.queued ? "queued" : "sent") : "failed",
            statusReason: sendResult.success ? "sent_by_operator" : "transmission_failed",
            sendResultJson: sendResult ? JSON.stringify(sendResult) : null,
          })
          .where(eq(smsOrchestrations.id, input.id));

        if (input.action === "edit_and_send") {
          const { trackDraftFeedback } = await import("../services/smsLearningEngine");
          const [latestDraft] = await db.select({ id: nickgptDrafts.id })
            .from(nickgptDrafts)
            .where(eq(nickgptDrafts.customerPhone, row.customerPhone))
            .orderBy(desc(nickgptDrafts.createdAt))
            .limit(1);
          if (latestDraft) {
            await trackDraftFeedback(latestDraft.id, "edited", messageToSend);
          }
        }
      } else if (input.action === "resolve") {
        await db.update(smsOrchestrations)
          .set({
            status: "skipped",
            statusReason: "resolved_by_operator",
          })
          .where(eq(smsOrchestrations.id, input.id));
      } else if (input.action === "bad_suggestion") {
        await db.update(smsOrchestrations)
          .set({
            status: "skipped",
            statusReason: "rejected_by_operator_bad_suggestion",
          })
          .where(eq(smsOrchestrations.id, input.id));

        const { trackDraftFeedback } = await import("../services/smsLearningEngine");
        const [latestDraft] = await db.select({ id: nickgptDrafts.id })
          .from(nickgptDrafts)
          .where(eq(nickgptDrafts.customerPhone, row.customerPhone))
          .orderBy(desc(nickgptDrafts.createdAt))
          .limit(1);
        if (latestDraft) {
          await trackDraftFeedback(latestDraft.id, "rejected", "");
        }
      }

      return { success: true };
    }),

  getRolloutModes: adminProcedure
    .query(async () => {
      const db = await getDbTyped();
      if (!db) return [];
      
      return await db.select()
        .from(appSecretKv)
        .where(or(
          like(appSecretKv.k, "sms_orch_%"),
          eq(appSecretKv.k, "sms_orchestrator_global_mode")
        ));
    }),

  setRolloutMode: adminProcedure
    .input(z.object({
      key: z.string(),
      value: z.enum(["off", "shadow", "draft_only", "live_send", "legacy_passthrough"])
    }))
    .mutation(async ({ input }) => {
      const db = await getDbTyped();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      
      const existing = await db.select()
        .from(appSecretKv)
        .where(eq(appSecretKv.k, input.key))
        .limit(1);

      if (existing.length > 0) {
        await db.update(appSecretKv)
          .set({ v: input.value, updatedAt: new Date() })
          .where(eq(appSecretKv.k, input.key));
      } else {
        await db.insert(appSecretKv)
          .values({ k: input.key, v: input.value, updatedAt: new Date() });
      }

      return { success: true };
    }),
});
