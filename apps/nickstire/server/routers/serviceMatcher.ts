/**
 * Service Matcher Router — NL description → service recommendations
 */
import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { matchService } from "../services/nlServiceMatcher";

export const serviceMatcherRouter = router({
  match: publicProcedure
    .input(z.object({ description: z.string().min(3).max(500) }))
    .query(({ input }) => {
      return matchService(input.description);
    }),
});
