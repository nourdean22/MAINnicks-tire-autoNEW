/**
 * AI Estimate Router — Public endpoint for symptom-based cost estimates
 */
import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { generateEstimate } from "../services/aiEstimateGenerator";

export const estimatesRouter = router({
  generate: publicProcedure
    .input(z.object({
      vehicleYear: z.number().min(1990).max(2030),
      vehicleMake: z.string().min(1).max(50),
      vehicleModel: z.string().min(1).max(50),
      symptomDescription: z.string().min(3).max(1000),
      mileage: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await generateEstimate(input);

      // Dispatch estimate event — every estimate is a potential customer signal
      import("../services/eventBus").then(({ emit }) =>
        emit.estimateGenerated({
          vehicle: `${input.vehicleYear} ${input.vehicleMake} ${input.vehicleModel}`,
          symptom: input.symptomDescription,
          issueCount: result.possibleIssues?.length || 0,
          source: "ai_estimate",
        })
      ).catch(() => {});

      return result;
    }),
});
