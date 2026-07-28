/**
 * Quote Quality & Profit Guard router — admin-only, evaluative,
 * read-only against business data. Never recommends prices; flags
 * quality problems and makes missing cost capture loud (unknown ≠ ok).
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { evaluateEstimateById } from "../services/quoteGuard";

export const quoteGuardRouter = router({
  /** Evaluate one ALG estimate: sanity, overlaps, captured-parts margin,
   *  live Gateway supplier-cost backing for tire-shaped quotes. */
  evaluateEstimate: adminProcedure
    .input(z.object({ estimateId: z.number().int().positive() }))
    .query(async ({ input }) => evaluateEstimateById(input.estimateId)),
});
