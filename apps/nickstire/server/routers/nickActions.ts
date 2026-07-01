/**
 * Nick AI Agent Actions — Quote creation, work order creation,
 * follow-up scheduling, competitor monitoring, chat-to-action dispatcher.
 *
 * Philosophy: VERIFY EVERYTHING. No assumptions. Every AI output is
 * parsed, validated, and verified before being stored or acted upon.
 *
 * This is the tRPC router. Handler logic lives in ./nick/ sub-modules.
 */
import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { IG_ARCHETYPES } from "@shared/const";
import { logAdminAction } from "../services/auditTrail";

// ─── Sub-module imports ─────────────────────────────────
import { handleGenerateQuote, handleCompetitorPriceCheck } from "./nick/quotes";
import { handleCreateWorkOrder, handleScheduleFollowUp, handleDispatchAction } from "./nick/actions";
import { handleOperatorCommand, handlePullFromStatenour, handleRunMigrations, handleImportCustomerCSV } from "./nick/intelligence";
import {
  handleSocialPost, handleSocialStatus, handleCustomerIntelligence,
  handleCameraFeed, handleCameras, handleSetCamera,
  handleShopPulse, handleShopDriverStatus, handleSchedulerStatus, handleCronHealth,
  handleTriggerPrerender, handleSyncShopDriver,
  handleRemember, handleMemories, handleSendMedia, handleReviewContent,
} from "./nick/chat";

export const nickActionsRouter = router({
  // ─── Quote Generation ─────────────────────────────────
  generateQuote: adminProcedure
    .input(z.object({
      sessionId: z.number(),
      includeTiers: z.boolean().default(true),
      includeFinancing: z.boolean().default(true),
      includeWarranty: z.boolean().default(true),
      includeHistory: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => handleGenerateQuote(input)),

  // ─── Work Order Creation ──────────────────────────────
  createWorkOrder: adminProcedure
    .input(z.object({
      sessionId: z.number(),
      customerId: z.number().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
      autoAssign: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => handleCreateWorkOrder(input)),

  // ─── Follow-Up Scheduler ──────────────────────────────
  scheduleFollowUp: adminProcedure
    .input(z.object({
      sessionId: z.number(),
      followUpType: z.enum(["call", "sms", "email"]).default("sms"),
      delayHours: z.number().min(1).max(720).default(24),
      customMessage: z.string().max(500).optional(),
      enableChain: z.boolean().default(true),
      chainDepth: z.number().min(1).max(5).default(3),
    }))
    .mutation(async ({ input }) => handleScheduleFollowUp(input)),

  // ─── Competitor Price Check ───────────────────────────
  competitorPriceCheck: adminProcedure
    .input(z.object({
      service: z.string().min(1).max(100),
      zipCode: z.string().default("44112"),
      includeSeasonalAdjustment: z.boolean().default(true),
      includeMarginAnalysis: z.boolean().default(true),
      includeChartData: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => handleCompetitorPriceCheck(input)),

  // ─── Chat-to-Action Dispatcher ────────────────────────
  dispatchAction: adminProcedure
    .input(z.object({
      sessionId: z.number(),
      autoExecute: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => handleDispatchAction(input)),

  // ─── Operator Command ─────────────────────────────────
  operatorCommand: adminProcedure
    .input(z.object({
      command: z.string().min(1).max(2000),
      context: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ input }) => handleOperatorCommand(input)),

  // ─── Social Media ─────────────────────────────────────
  socialPost: adminProcedure
    .input(z.object({
      platforms: z.array(z.enum(["facebook", "instagram"])).min(1),
      message: z.string().min(1).max(2200),
      imageUrl: z.string().url().optional(),
      link: z.string().url().optional(),
    }))
    .mutation(async ({ input }) => handleSocialPost(input)),

  socialStatus: adminProcedure.query(async () => handleSocialStatus()),

  // ─── Meta token reconnect · 2026-05-31 ────────────────
  // Mints a never-expiring Page token from a freshly-generated User
  // token (Graph API Explorer), server-side (graph.facebook.com is
  // blocked on the operator's machine but reachable from Railway).
  // Caches it in-process so socialPost works immediately. `reveal`
  // returns the token once so it can be persisted to the
  // META_PAGE_ACCESS_TOKEN env var for cross-restart durability.
  metaReconnect: adminProcedure
    .input(z.object({
      userToken: z.string().min(20).max(1000),
      reveal: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const { reconnectMetaFromUserToken, getMetaSocialStatus, getPersistedTokenMeta } = await import("../services/metaSocial");
      const r = await reconnectMetaFromUserToken(input.userToken);
      if (!r.ok) return { ok: false as const, error: r.error };
      const status = await getMetaSocialStatus();
      const persisted = await getPersistedTokenMeta();
      const tok = r.pageToken || "";
      return {
        ok: true as const,
        facebookReady: status.facebookReady,
        instagramReady: status.instagramReady,
        pageId: status.pageId,
        igUserId: status.igUserId,
        tokenFingerprint: tok ? `…${tok.slice(-6)} (len ${tok.length})` : null,
        persisted,
        pageToken: input.reveal ? tok : undefined,
      };
    }),

  // ─── IG/FB Autopost · Fire Now · 2026-06-01 ───────────
  // One-off trigger for the autonomous IG+FB content brain
  // (server/services/igAutopost.ts). Generates a source-grounded,
  // eval-gated post and either posts it live or — by default
  // (IG_AUTOPOST_DRYRUN !== "false") — sends a Telegram preview without
  // posting. The button is iOS-PWA-safe (confirmDialog + toast on the
  // client). forceArchetype lets the operator steer the content angle.
  fireIgAutopostNow: adminProcedure
    .input(z.object({
      forceArchetype: z
        .enum(IG_ARCHETYPES)
        .optional(),
    }))
    .mutation(async ({ input }) => {
      // The run is durably recorded in ig_autopost_log with source:"admin"
      // (the canonical audit surface for posts); no separate audit-trail
      // entry needed.
      const { runIgAutopostOneOff } = await import("../services/igAutopost");
      const r = await runIgAutopostOneOff(input.forceArchetype);
      return {
        status: r.status,
        dryRun: r.dryRun,
        archetype: r.archetype ?? null,
        conceptKey: r.conceptKey ?? null,
        overall: r.scores?.overall ?? null,
        captionWeighted: r.scores?.captionWeighted ?? null,
        imageEvalSkipped: r.scores?.image.skipped ?? null,
        igPostId: r.igPostId ?? null,
        fbPostId: r.fbPostId ?? null,
        details: r.details,
      };
    }),

  // ─── Customer Intelligence ────────────────────────────
  customerIntelligence: adminProcedure.query(async () => handleCustomerIntelligence()),

  // ─── Camera Management ────────────────────────────────
  cameraFeed: adminProcedure
    .input(z.object({ cameraId: z.string().min(1).max(50) }))
    .query(async ({ input }) => handleCameraFeed(input)),

  cameras: adminProcedure.query(async () => handleCameras()),

  setCamera: adminProcedure
    .input(z.object({
      id: z.string().min(1).max(50),
      name: z.string().min(1).max(100),
      url: z.string().min(1),
      type: z.enum(["rtsp", "http", "mjpeg", "hls", "v380-cloud", "ring", "eufy"]).default("http"),
      location: z.string().max(100).optional(),
      v380DeviceId: z.string().max(50).optional(),
      ringDeviceId: z.string().max(50).optional(),
      eufySerial: z.string().max(50).optional(),
      tunnelUrl: z.string().optional(),
      snapshotUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => handleSetCamera(input)),

  // ─── Payment alert backlog · 2026-05-23 ───────────────
  // Reads unresolved paid-but-unfulfillable orders so the Today
  // dashboard can render a banner. Mark-resolved updates the row
  // when operator manually fulfils the order.
  paymentAlertBacklog: adminProcedure.query(async () => {
    const { db } = await import("../lib/db-helper");
    const { paymentAlertBacklog } = await import("../../drizzle/schema");
    const { isNull, desc } = await import("drizzle-orm");
    const d = await db();
    if (!d) return { count: 0, items: [] as Array<{ id: number; summary: string; amountCents: number; failureReason: string; tireOrderNumber: string | null; invoiceNumber: string | null; createdAt: string }> };
    type BacklogRow = typeof paymentAlertBacklog.$inferSelect;
    const rows = await d.select().from(paymentAlertBacklog)
      .where(isNull(paymentAlertBacklog.resolvedAt))
      .orderBy(desc(paymentAlertBacklog.createdAt))
      .limit(20) as BacklogRow[];
    return {
      count: rows.length,
      items: rows.map((r: BacklogRow) => ({
        id: r.id,
        summary: r.summary,
        amountCents: r.amountCents,
        failureReason: r.failureReason,
        tireOrderNumber: r.tireOrderNumber,
        invoiceNumber: r.invoiceNumber,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }),
  resolvePaymentAlert: adminProcedure
    .input(z.object({ id: z.number().int(), resolvedBy: z.string().max(255).optional() }))
    .mutation(async ({ input }) => {
      const { db } = await import("../lib/db-helper");
      const { paymentAlertBacklog } = await import("../../drizzle/schema");
      const { eq, sql } = await import("drizzle-orm");
      const d = await db();
      if (!d) throw new Error("DB unavailable");
      await d.update(paymentAlertBacklog).set({
        resolvedAt: sql`CURRENT_TIMESTAMP`,
        resolvedBy: input.resolvedBy || "admin",
      }).where(eq(paymentAlertBacklog.id, input.id));
      return { ok: true };
    }),

  // ─── Customer message previews (PREVIEW ONLY) ─────────
  // 2026-06-10 danger-zone-safe-build · renders the five customer
  // confirmation templates against a SAMPLE order so the owner can
  // review exact copy in the Ops Hub. Read-only: no DB, no provider,
  // no send path exists (sendCustomerMessage always throws — see
  // services/customerMessageTemplates.ts).
  customerMessagePreviews: adminProcedure.query(async () => {
    const { TEMPLATE_BUILDERS } = await import("../services/customerMessageTemplates");
    const sample = {
      customerName: "Sample Customer",
      orderNumber: "TO-SAMPLE-000",
      quantity: 4,
      tireBrand: "NEXEN",
      tireModel: "N'Priz AH5",
      tireSize: "215/60R16",
      totalAmount: 544.0,
    };
    return Object.entries(TEMPLATE_BUILDERS).map(([key, build]) => {
      const msg = build(sample);
      return { key, sms: msg.sms, emailSubject: msg.email.subject, emailBody: msg.email.body };
    });
  }),

  // ─── Shop Status ──────────────────────────────────────
  shopPulse: adminProcedure.query(async () => handleShopPulse()),
  shopDriverStatus: adminProcedure.query(async () => handleShopDriverStatus()),
  schedulerStatus: adminProcedure.query(async () => handleSchedulerStatus()),
  cronHealth: adminProcedure.query(async () => handleCronHealth()), // wave-149 · read-only cron_log feed for the Cron Health panel

  // ─── Admin Operations ─────────────────────────────────
  triggerPrerender: adminProcedure.mutation(async () => handleTriggerPrerender()),
  pullFromStatenour: adminProcedure.mutation(async () => handlePullFromStatenour()),
  syncShopDriver: adminProcedure.mutation(async () => handleSyncShopDriver()),
  importCustomerCSV: adminProcedure.mutation(async () => handleImportCustomerCSV()),
  runMigrations: adminProcedure.mutation(async ({ ctx }) => {
    // Raw DDL execution — the single highest-privilege operator lever, and it
    // was completely unaudited. Log who ran it + the applied/skipped/error
    // summary the handler returns. Fire-and-forget so audit never blocks the run.
    const result = await handleRunMigrations();
    logAdminAction({
      action: "migrations.ran",
      entityType: "database",
      entityId: "migrations",
      details: "Operator ran DB migrations",
      metadata: result as Record<string, unknown>,
      actor: ctx.user?.email ?? ctx.user?.name ?? "admin",
    }).catch(() => { /* audit must never break the migration run */ });
    return result;
  }),

  // ─── Nick AI Memory ───────────────────────────────────
  remember: adminProcedure
    .input(z.object({
      type: z.enum(["insight", "lesson", "preference", "pattern", "customer"]),
      content: z.string().min(3).max(500),
      source: z.string().max(100).default("manual"),
    }))
    .mutation(async ({ input }) => handleRemember(input)),

  memories: adminProcedure
    .input(z.object({
      type: z.enum(["insight", "lesson", "preference", "pattern", "customer"]).optional(),
      limit: z.number().max(50).default(20),
    }).optional())
    .query(async ({ input }) => handleMemories(input)),

  // ─── Media & Communication ────────────────────────────
  sendMedia: adminProcedure
    .input(z.object({
      type: z.enum(["photo", "video", "document", "album"]),
      url: z.string().url().optional(),
      urls: z.array(z.string().url()).optional(),
      caption: z.string().max(1024).optional(),
    }))
    .mutation(async ({ input }) => handleSendMedia(input)),

  // ─── Content Review ───────────────────────────────────
  reviewContent: adminProcedure
    .input(z.object({
      content: z.string().min(1).max(5000),
      contentType: z.enum(["social_post", "email", "estimate", "reply", "brief", "general"]),
      context: z.string().max(1000).optional(),
    }))
    .mutation(async ({ input }) => handleReviewContent(input)),
});
