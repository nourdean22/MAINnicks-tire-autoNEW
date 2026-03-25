/**
 * Customer Segmentation Router — Segment analysis and targeting
 */
import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { segmentCustomer, getSegmentInfo } from "../services/customerSegmentation";

export const segmentsRouter = router({
  segmentCustomer: adminProcedure
    .input(z.object({
      totalSpend: z.number(),
      visitCount: z.number(),
      daysSinceLastVisit: z.number(),
      daysSinceFirstVisit: z.number(),
      referralCount: z.number().default(0),
      reviewCount: z.number().default(0),
      vehicleCount: z.number().default(1),
      declineRate: z.number().default(0),
    }))
    .query(({ input }) => {
      const result = segmentCustomer(input);
      const info = getSegmentInfo(result.segment);
      return { ...result, ...info };
    }),
});
