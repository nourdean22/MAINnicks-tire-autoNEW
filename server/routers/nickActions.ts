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

// ─── Sub-module imports ─────────────────────────────────
import { handleGenerateQuote, handleCompetitorPriceCheck } from "./nick/quotes";
import { handleCreateWorkOrder, handleScheduleFollowUp, handleDispatchAction } from "./nick/actions";
import { handleOperatorCommand, handlePullFromStatenour, handleRunMigrations, handleImportCustomerCSV } from "./nick/intelligence";
import {
  handleSocialPost, handleSocialStatus, handleCustomerIntelligence,
  handleCameraFeed, handleCameras, handleSetCamera,
  handleShopPulse, handleShopDriverStatus, handleSchedulerStatus,
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
      customerId: z.string().optional(),
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

  // ─── Shop Status ──────────────────────────────────────
  shopPulse: adminProcedure.query(async () => handleShopPulse()),
  shopDriverStatus: adminProcedure.query(async () => handleShopDriverStatus()),
  schedulerStatus: adminProcedure.query(async () => handleSchedulerStatus()),

  // ─── Admin Operations ─────────────────────────────────
  triggerPrerender: adminProcedure.mutation(async () => handleTriggerPrerender()),
  pullFromStatenour: adminProcedure.mutation(async () => handlePullFromStatenour()),
  syncShopDriver: adminProcedure.mutation(async () => handleSyncShopDriver()),
  importCustomerCSV: adminProcedure.mutation(async () => handleImportCustomerCSV()),
  runMigrations: adminProcedure.mutation(async () => handleRunMigrations()),

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
