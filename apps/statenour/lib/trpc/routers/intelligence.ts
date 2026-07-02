import { z } from "zod";
import { router, operatorProcedure } from "../trpc";
import { 
  getCalibrationReviews, 
  resolveCalibrationReview, 
  bulkResolveCalibrationReviews 
} from "@/lib/services/system-calibration";

export const intelligenceRouter = router({
  /**
   * Phase B: Get all pending and historical calibration reviews + scoreboard stats.
   * Replaces GET /api/system/calibration/reviews
   */
  calibrationReviews: operatorProcedure.query(async () => {
    return await getCalibrationReviews();
  }),

  /**
   * Phase B: Resolve a single calibration review item.
   * Replaces POST /api/system/calibration/reviews/[id]/resolve
   */
  resolveCalibration: operatorProcedure
    .input(
      z.object({
        id: z.string(),
        action: z.enum(["approve", "correct", "reject", "needs_more_evidence"]),
        approvedActualOutcome: z.record(z.string(), z.unknown()).optional(),
        correctionNote: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await resolveCalibrationReview(
        input.id,
        input.action,
        input.approvedActualOutcome,
        input.correctionNote
      );
      return { success: true };
    }),

  /**
   * Phase B: Bulk resolve pending calibration items (low risk / stale).
   * Replaces POST /api/system/calibration/reviews/bulk-resolve
   */
  bulkResolveCalibration: operatorProcedure
    .input(
      z.object({
        action: z.enum(["approve_low_risk", "reject_stale"]),
      })
    )
    .mutation(async ({ input }) => {
      const result = await bulkResolveCalibrationReviews(input.action);
      return { success: true, processedCount: result.processedCount };
    }),
});
