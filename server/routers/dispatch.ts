/**
 * Dispatch Router — Bay assignment, tech management, QC, customer messaging.
 */
import { z } from "zod";
import { router, adminProcedure, publicProcedure } from "../_core/trpc";

export const dispatchRouter = router({
  // ─── Techs + Bays ────────────────────────────────
  availableTechs: adminProcedure.query(async () => {
    const { getAvailableTechs } = await import("../services/dispatch");
    return getAvailableTechs();
  }),

  allBays: adminProcedure.query(async () => {
    const { getAvailableBays } = await import("../services/dispatch");
    return getAvailableBays();
  }),

  freeBays: adminProcedure.query(async () => {
    const { getFreeBays } = await import("../services/dispatch");
    return getFreeBays();
  }),

  load: adminProcedure.query(async () => {
    const { getDispatchLoad } = await import("../services/dispatch");
    return getDispatchLoad();
  }),

  // ─── Tech Recommendation ─────────────────────────
  recommend: adminProcedure
    .input(z.object({ workOrderId: z.string() }))
    .query(async ({ input }) => {
      const { recommendTech } = await import("../services/dispatch");
      return recommendTech(input.workOrderId);
    }),

  // ─── Assignment Flow ──────────────────────────────
  assign: adminProcedure
    .input(z.object({
      workOrderId: z.string(),
      techId: z.number(),
      bayId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const { assignWorkOrder } = await import("../services/dispatch");
      await assignWorkOrder({ ...input, changedBy: "admin" });
      return { success: true };
    }),

  startWork: adminProcedure
    .input(z.object({ workOrderId: z.string() }))
    .mutation(async ({ input }) => {
      const { startWork } = await import("../services/dispatch");
      await startWork({ workOrderId: input.workOrderId, changedBy: "admin" });
      return { success: true };
    }),

  techComplete: adminProcedure
    .input(z.object({
      workOrderId: z.string(),
      techNotes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { techComplete } = await import("../services/dispatch");
      await techComplete({ ...input, changedBy: "admin" });
      return { success: true };
    }),

  // ─── Clock In/Out ────────────────────────────────
  clockIn: adminProcedure
    .input(z.object({ techId: z.number() }))
    .mutation(async ({ input }) => {
      const { clockIn } = await import("../services/dispatch");
      await clockIn(input.techId);
      return { success: true };
    }),

  clockOut: adminProcedure
    .input(z.object({ techId: z.number() }))
    .mutation(async ({ input }) => {
      const { clockOut } = await import("../services/dispatch");
      await clockOut(input.techId);
      return { success: true };
    }),

  // ─── QC ──────────────────────────────────────────
  getQcChecklist: adminProcedure
    .input(z.object({ workOrderId: z.string() }))
    .query(async ({ input }) => {
      const { getQcChecklist } = await import("../services/qcService");
      return getQcChecklist(input.workOrderId);
    }),

  createQcChecklist: adminProcedure
    .input(z.object({ workOrderId: z.string() }))
    .mutation(async ({ input }) => {
      const { createQcChecklist } = await import("../services/qcService");
      const id = await createQcChecklist(input.workOrderId);
      return { id };
    }),

  updateQcChecklist: adminProcedure
    .input(z.object({
      checklistId: z.number(),
      items: z.array(z.object({
        id: z.string(),
        label: z.string(),
        category: z.string(),
        required: z.boolean(),
        passed: z.boolean().nullable(),
        notes: z.string().optional(),
      })),
      completedBy: z.string(),
      roadTestCompleted: z.boolean().optional(),
      roadTestNotes: z.string().optional(),
      roadTestMileage: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { updateQcChecklist } = await import("../services/qcService");
      await updateQcChecklist(input);
      return { success: true };
    }),

  passQc: adminProcedure
    .input(z.object({
      checklistId: z.number(),
      reviewedBy: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { passQc } = await import("../services/qcService");
      await passQc(input);
      return { success: true };
    }),

  failQc: adminProcedure
    .input(z.object({
      checklistId: z.number(),
      failureReasons: z.array(z.string()),
      correctiveActions: z.string(),
      reviewedBy: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { failQc } = await import("../services/qcService");
      await failQc(input);
      return { success: true };
    }),

  qcStats: adminProcedure.query(async () => {
    const { getQcStats } = await import("../services/qcService");
    return getQcStats();
  }),

  // ─── Comeback Detection ──────────────────────────
  checkComeback: adminProcedure
    .input(z.object({
      customerId: z.string(),
      vehicleVin: z.string().optional(),
      serviceDescription: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const { checkForComeback } = await import("../services/qcService");
      return checkForComeback(input);
    }),

  recordComeback: adminProcedure
    .input(z.object({
      originalWorkOrderId: z.string(),
      comebackWorkOrderId: z.string().optional(),
      customerId: z.string(),
      serviceType: z.string().optional(),
      originalTechId: z.number().optional(),
      daysSinceOriginal: z.number(),
      type: z.string(),
      severity: z.string().optional(),
      rootCause: z.string().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { recordComeback } = await import("../services/qcService");
      const id = await recordComeback(input);
      return { id };
    }),

  // ─── Customer Messaging ──────────────────────────
  generateMessage: adminProcedure
    .input(z.object({
      workOrderId: z.string(),
      newStatus: z.string(),
      overrideVars: z.record(z.string(), z.string()).optional(),
    }))
    .query(async ({ input }) => {
      const { generateStatusMessage } = await import("../services/customerMessaging");
      return generateStatusMessage(input);
    }),

  sendMessage: adminProcedure
    .input(z.object({
      workOrderId: z.string(),
      customerId: z.string().optional(),
      trigger: z.string(),
      channel: z.string().default("sms"),
      recipient: z.string(),
      message: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { logStatusMessage } = await import("../services/customerMessaging");
      const id = await logStatusMessage({ ...input, status: "sent" });
      return { id };
    }),

  messageHistory: adminProcedure
    .input(z.object({ workOrderId: z.string() }))
    .query(async ({ input }) => {
      const { getMessagesForWorkOrder } = await import("../services/customerMessaging");
      return getMessagesForWorkOrder(input.workOrderId);
    }),

  // ─── Staff Performance ────────────────────────────
  teamPerformance: adminProcedure.query(async () => {
    const { getTeamPerformance } = await import("../services/staffPerformance");
    return getTeamPerformance();
  }),

  // ─── Promise Risk ─────────────────────────────────
  promiseRisk: adminProcedure.query(async () => {
    const { getPromiseRiskSummary } = await import("../services/promiseRisk");
    return getPromiseRiskSummary();
  }),

  // ─── Declined Work Recovery ──────────────────────
  declinedLedger: adminProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      const { getDeclinedWorkLedger } = await import("../services/declinedWorkRecovery");
      return getDeclinedWorkLedger(input?.limit || 50);
    }),

  declinedStats: adminProcedure.query(async () => {
    const { getDeclinedWorkStats } = await import("../services/declinedWorkRecovery");
    return getDeclinedWorkStats();
  }),

  markRecovered: adminProcedure
    .input(z.object({
      workOrderId: z.string(),
      itemId: z.string(),
      method: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { markItemRecovered } = await import("../services/declinedWorkRecovery");
      await markItemRecovered(input);
      return { success: true };
    }),

  // ─── Invoice Reconciliation ───────────────────────
  reconcileWorkOrder: adminProcedure
    .input(z.object({ workOrderId: z.string() }))
    .query(async ({ input }) => {
      const { reconcileWorkOrder } = await import("../services/invoiceReconciliation");
      return reconcileWorkOrder(input.workOrderId);
    }),

  dailyRevenue: adminProcedure
    .input(z.object({ date: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const { getDailyRevenueTruth } = await import("../services/invoiceReconciliation");
      return getDailyRevenueTruth(input?.date);
    }),

  recentReconciliations: adminProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      const { getRecentReconciliations } = await import("../services/invoiceReconciliation");
      return getRecentReconciliations(input?.limit || 20);
    }),

  // ─── Customer Job Tracker (public) ────────────────
  track: publicProcedure
    .input(z.object({
      orderNumber: z.string(),
      phone: z.string(),
    }))
    .query(async ({ input }) => {
      const { getTrackingInfo } = await import("../services/customerMessaging");
      return getTrackingInfo(input.orderNumber, input.phone);
    }),
});
