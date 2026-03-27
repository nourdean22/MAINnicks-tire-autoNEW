/**
 * NOUR OS Bridge Router — Admin endpoints for viewing sync status and events
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
});
