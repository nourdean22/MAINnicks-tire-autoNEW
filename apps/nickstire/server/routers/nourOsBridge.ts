/**
 * NOUR OS Bridge Router — Admin endpoints for viewing sync status and events.
 *
 * Consumers: Admin shell + Overview/Money/Revenue read `shopFloor`; Admin shell
 * reads `status`. (`recentEvents` is read by surfaces that surface the event log.)
 *
 * 2026-06-03 · `pushShopFloor` mutation removed. Its only caller was the deleted
 * CommandCenterSection page, and it pushed to a dead Vercel deployment (404
 * DEPLOYMENT_NOT_FOUND). The shop-floor snapshot is already dispatched
 * automatically on work-order status changes (workOrderService.ts), so the
 * manual push button was both broken and redundant.
 */
import { adminProcedure, router } from "../_core/trpc";
import { getSyncStatus, getRecentEvents } from "../nour-os-bridge";
import { z } from "zod";

export const nourOsBridgeRouter = router({
  /** Get sync status (events sent, last sync, errors) */
  status: adminProcedure.query(() => {
    return getSyncStatus();
  }),

  /** Get recent events dispatched to NOUR OS */
  recentEvents: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(({ input }) => {
      return getRecentEvents(input?.limit || 50);
    }),

  /** Get shop floor snapshot (work order stats for command deck) */
  shopFloor: adminProcedure.query(async () => {
    const { getWorkOrderStats } = await import("../services/workOrderService");
    return getWorkOrderStats();
  }),
});
